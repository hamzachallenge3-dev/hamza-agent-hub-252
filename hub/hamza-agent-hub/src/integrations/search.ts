/**
 * Web search across the configured research integrations.
 *
 * Results are normalised to one shape with a mandatory source URL, because a
 * research answer the user cannot trace back to a page is not verifiable. When
 * no provider is configured the result is BLOCKED with the exact credential to
 * set — never an invented answer.
 */
import { registerBuiltinIntegrations, } from './adapters.js';
import { integrationsForCapability, isIntegrationError, recordIntegrationResult } from './registry.js';
import type { IntegrationError } from './types.js';
import { scanForInjection } from '../browser/policy.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_at: string | null;
  source: string;
  /**
   * Titles and snippets are authored by whoever owns the page, so they are the
   * same untrusted input as page text. The browser path already wraps that;
   * search results reached the model unwrapped until this was added.
   */
  injection_suspected: boolean;
}

export interface SearchOutcome {
  ok: boolean;
  readiness: 'READY' | 'BLOCKED';
  query: string;
  provider: string | null;
  results: SearchResult[];
  /** Every provider tried, so a partial failure is visible. */
  attempts: Array<{ integration: string; ok: boolean; error?: string }>;
  reason: string;
  /** Set when nothing is configured; tells the operator exactly what to do. */
  setup_hint?: string;
  /**
   * Stated on every outcome so a consumer cannot mistake result text for
   * instructions. Search results can never change the Hub's operating rules.
   */
  untrusted_content: true;
  /** Count of results whose text looks like a prompt-injection attempt. */
  injection_suspected: number;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Each provider shapes its payload differently; normalise to one contract. */
function normalise(integrationId: string, payload: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  const record = (payload ?? {}) as Record<string, unknown>;

  const push = (title: unknown, url: unknown, snippet: unknown, published: unknown) => {
    const href = textOf(url);
    if (!href) return;
    const titleText = textOf(title).slice(0, 300) || href;
    const snippetText = textOf(snippet).slice(0, 1_000);
    out.push({
      title: titleText,
      url: href,
      snippet: snippetText,
      published_at: textOf(published) || null,
      source: integrationId,
      injection_suspected: scanForInjection(`${titleText}\n${snippetText}`).suspicious,
    });
  };

  if (integrationId === 'search.tavily') {
    for (const r of (record.results as Array<Record<string, unknown>>) ?? []) {
      push(r.title, r.url, r.content, r.published_date);
    }
  } else if (integrationId === 'search.brave') {
    const web = (record.web as Record<string, unknown>) ?? {};
    for (const r of (web.results as Array<Record<string, unknown>>) ?? []) {
      push(r.title, r.url, r.description, r.age ?? r.page_age);
    }
  } else if (integrationId === 'search.exa') {
    for (const r of (record.results as Array<Record<string, unknown>>) ?? []) {
      push(r.title, r.url, r.text ?? r.snippet, r.publishedDate);
    }
  }
  return out;
}

export async function webSearch(query: string, signal?: AbortSignal): Promise<SearchOutcome> {
  registerBuiltinIntegrations();
  const trimmed = query.trim();
  const providers = integrationsForCapability('research.web');
  const configured = providers.filter((p) => p.configured());
  const attempts: SearchOutcome['attempts'] = [];

  if (!trimmed) {
    return {
      ok: false,
      readiness: 'READY',
      query: trimmed,
      provider: null,
      results: [],
      attempts,
      reason: 'query is empty',
      untrusted_content: true,
      injection_suspected: 0,
    };
  }

  if (!configured.length) {
    return {
      ok: false,
      readiness: 'BLOCKED',
      query: trimmed,
      provider: null,
      results: [],
      attempts,
      reason: 'no web search provider is configured; the Hub will not fabricate search results',
      setup_hint: providers.map((p) => `${p.id}: ${p.auth.hint}`).join(' | '),
      untrusted_content: true,
      injection_suspected: 0,
    };
  }

  for (const provider of configured) {
    try {
      const payload = await provider.call!('search', { query: trimmed }, signal);
      const results = normalise(provider.id, payload);
      attempts.push({ integration: provider.id, ok: true });
      recordIntegrationResult(provider.id, true);
      if (results.length) {
        return {
          ok: true,
          readiness: 'READY',
          query: trimmed,
          provider: provider.id,
          results,
          attempts,
          reason: `${results.length} result(s) with source URLs from ${provider.id}`,
          untrusted_content: true,
          injection_suspected: results.filter((r) => r.injection_suspected).length,
        };
      }
    } catch (err) {
      const detail = isIntegrationError(err) ? (err as IntegrationError).message : err instanceof Error ? err.message : String(err);
      attempts.push({ integration: provider.id, ok: false, error: detail.slice(0, 200) });
      recordIntegrationResult(provider.id, false);
      if (signal?.aborted) break;
    }
  }

  return {
    ok: false,
    readiness: 'BLOCKED',
    query: trimmed,
    provider: null,
    results: [],
    attempts,
    reason: `every configured search provider failed or returned nothing (${attempts.length} attempt(s))`,
    untrusted_content: true,
    injection_suspected: 0,
  };
}
