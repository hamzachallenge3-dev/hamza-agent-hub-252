/**
 * FreeLLMAPI — open-source free LLM gateway (OpenAI-compatible).
 * https://github.com/tashfeenahmed/freellmapi
 *
 * Default local endpoint: http://127.0.0.1:3001/v1
 * Default model: auto (router picks a free healthy model)
 *
 * Enable with:
 *   HAH_MODEL_PROVIDER=freellmapi
 *   HAH_FREELLMAPI_KEY=freellmapi-…
 * or HAH_USE_FREELLMAPI=1
 */

import { modelTool } from './schemas.js';
import { config } from '../config.js';

export const FREELLMAPI_DEFAULT_URL = 'http://127.0.0.1:3001/v1';
export const FREELLMAPI_DEFAULT_MODEL = 'auto';
export const FREELLMAPI_UPSTREAM = 'https://github.com/tashfeenahmed/freellmapi';

export function freellmapiBaseUrl(): string {
  const raw =
    process.env.HAH_FREELLMAPI_URL ||
    process.env.HAH_MODEL_URL ||
    FREELLMAPI_DEFAULT_URL;
  return raw.replace(/\/$/, '');
}

export function freellmapiApiKey(): string {
  return process.env.HAH_FREELLMAPI_KEY || process.env.HAH_MODEL_API_KEY || '';
}

export function freellmapiModel(): string {
  return (
    process.env.HAH_FREELLMAPI_MODEL ||
    process.env.HAH_MODEL_NAME ||
    FREELLMAPI_DEFAULT_MODEL
  );
}

/** Opt-in FreeLLMAPI as the live model backend. */
export function freellmapiEnabled(): boolean {
  const p = (process.env.HAH_MODEL_PROVIDER || '').toLowerCase().trim();
  if (p === 'freellmapi' || p === 'free-llm-api' || p === 'lotf') return true;
  if (process.env.HAH_USE_FREELLMAPI === '1') return true;
  if (process.env.HAH_FREELLMAPI_URL) return true;
  const url = (process.env.HAH_MODEL_URL || '').toLowerCase();
  return url.includes(':3001') || url.includes('freellmapi');
}

export interface FreellmapiProbe {
  ok: boolean;
  provider: 'freellmapi';
  base_url: string;
  model: string;
  key_configured: boolean;
  models_count?: number;
  sample_models?: string[];
  latency_ms?: number;
  error?: string;
  upstream: string;
  hint: string;
}

export async function probeFreellmapi(timeoutMs = 4000): Promise<FreellmapiProbe> {
  const base = freellmapiBaseUrl();
  const model = freellmapiModel();
  const key = freellmapiApiKey();
  const hint =
    'Start FreeLLMAPI (OSS): see scripts/connect-freellmapi.sh — then set HAH_MODEL_PROVIDER=freellmapi and HAH_FREELLMAPI_KEY';
  const started = Date.now();
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const latency = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        provider: 'freellmapi',
        base_url: '[configured endpoint]',
        model,
        key_configured: Boolean(key),
        latency_ms: latency,
        error: `HTTP ${res.status}`,
        upstream: FREELLMAPI_UPSTREAM,
        hint,
      };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data || []).map((m) => m.id || '').filter(Boolean);
    return {
      ok: true,
      provider: 'freellmapi',
      base_url: '[configured endpoint]',
      model,
      key_configured: Boolean(key),
      models_count: ids.length,
      sample_models: ids.slice(0, 12),
      latency_ms: latency,
      upstream: FREELLMAPI_UPSTREAM,
      hint: ids.length
        ? 'FreeLLMAPI reachable — use model=auto (or auto:fast / auto:smart)'
        : 'FreeLLMAPI reachable but catalog empty — add free provider keys in the dashboard',
    };
  } catch (err) {
    return {
      ok: false,
      provider: 'freellmapi',
      base_url: '[configured endpoint]',
      model,
      key_configured: Boolean(key),
      latency_ms: Date.now() - started,
      error: 'FreeLLMAPI unavailable / النموذج غير متاح',
      upstream: FREELLMAPI_UPSTREAM,
      hint,
    };
  }
}

export async function freellmapiChat(opts: {
  system: string;
  messages: Array<{ role: string; content: string; name?: string; tool_call_id?:string; tool_calls?:unknown[] }>;
  tools: string[];
  model?: string;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  provider: 'freellmapi';
  routed_via?: string | null;
  model: string;
}> {
  const base = freellmapiBaseUrl();
  const model = opts.model || freellmapiModel();
  const key = freellmapiApiKey();
  const body = {
    model,
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
    tools: opts.tools.map(modelTool),
    temperature: 0.2,
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${base}/chat/completions`, {
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `FreeLLMAPI HTTP ${res.status}`
    );
  }
  const routed = res.headers.get('x-routed-via');
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
    model?: string;
  };
  const msg = json.choices?.[0]?.message;
  return {
    provider: 'freellmapi',
    model: json.model || model,
    routed_via: routed,
    content: msg?.content || '',
    tool_calls:
      msg?.tool_calls?.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = { raw: tc.function.arguments };
        }
        return { id: tc.id, name: tc.function.name, arguments: args };
      }) ?? [],
  };
}

export function freellmapiStatusSummary() {
  return {
    provider: 'freellmapi' as const,
    enabled: freellmapiEnabled(),
    base_url: '[configured endpoint]',
    model: freellmapiModel(),
    key_configured: Boolean(freellmapiApiKey()),
    hub_model_configured: Boolean(config.modelUrl),
    upstream: FREELLMAPI_UPSTREAM,
    license: 'MIT open-source self-hosted free-tier aggregator',
  };
}
