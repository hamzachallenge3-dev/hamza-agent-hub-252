/**
 * AI engine initialisation.
 *
 * The engine used to report a generic "not ready" and keep going, so a caller
 * could not tell a missing endpoint from a missing key. Initialisation never
 * throws: a missing piece is named (config or key env vars only — never the
 * values) and a configured provider that cannot be reached is reported as
 * unreachable without echoing its URL or credential.
 */
import { allProviders, providerHealthReport } from './providers.js';

export interface EngineGap {
  configured: boolean;
  missing_config: string[];
  missing_keys: string[];
  error: string | null;
}

export interface EngineStatus {
  component: 'ai-engine';
  state: 'ready' | 'not_ready';
  ready: boolean;
  configured: boolean;
  missing_config: string[];
  missing_keys: string[];
  /** Names of missing config or keys, or a reachability failure. No values. */
  error: string | null;
}

const PROVIDER_ALIAS: Record<string, string> = {
  freellmapi: 'freellmapi',
  lotf: 'freellmapi',
  'free-llm-api': 'freellmapi',
  ollama: 'ollama',
  openrouter: 'openrouter_free',
  openrouter_free: 'openrouter_free',
  huggingface: 'huggingface',
  hf: 'huggingface',
  openai: 'openai_compatible',
  openai_compatible: 'openai_compatible',
};

const ANY_ENDPOINT = ['HAH_MODEL_URL', 'HAH_FREELLMAPI_URL', 'HAH_OLLAMA_URL', 'HAH_OPENROUTER_URL', 'HAH_HF_URL'];

/** What the engine still needs before a provider can be selected. Sync, no network. */
export function engineGap(): EngineGap {
  const rows = allProviders().map((provider) => ({
    id: provider.id,
    configured: provider.configured(),
    ...provider.requirements(),
  }));
  if (rows.some((row) => row.configured)) {
    return { configured: true, missing_config: [], missing_keys: [], error: null };
  }

  const selected = PROVIDER_ALIAS[(process.env.HAH_MODEL_PROVIDER || '').toLowerCase().trim()];
  const chosen = rows.find((row) => row.id === selected)
    ?? rows.find((row) => row.endpoint_env_set || (row.requires_key && row.key_env_set));

  if (chosen) {
    if (chosen.requires_key && !chosen.key_env_set) {
      return {
        configured: false,
        missing_config: [],
        missing_keys: chosen.key_env,
        error: `AI engine not ready: missing key ${chosen.key_env.join(', ')}`,
      };
    }
    return {
      configured: false,
      missing_config: chosen.config_env,
      missing_keys: [],
      error: `AI engine not ready: missing config ${chosen.config_env.join(', ')}`,
    };
  }

  return {
    configured: false,
    missing_config: ANY_ENDPOINT,
    missing_keys: [],
    error: `AI engine not ready: missing config ${ANY_ENDPOINT.join(', ')}`,
  };
}

let cached: { at: number; value: EngineStatus } | null = null;

export function resetEngineCache(): void {
  cached = null;
}

/**
 * Probe configured providers and remember the result. Safe to call at startup:
 * a failure is stored on the status, it does not reject.
 */
export async function initializeEngine(timeoutMs = 1500, force = false): Promise<EngineStatus> {
  if (!force && cached && Date.now() - cached.at < 5_000) return cached.value;
  const gap = engineGap();
  let ready = false;
  let error = gap.error;
  if (gap.configured) {
    try {
      const report = await providerHealthReport(timeoutMs);
      ready = report.any_live;
      if (!ready) {
        const failed = report.providers.filter((row) => row.configured && !row.ok).map((row) => row.id);
        error = `AI engine not ready: configured provider unreachable${failed.length ? ` (${failed.join(', ')})` : ''}`;
      } else {
        error = null;
      }
    } catch {
      ready = false;
      error = 'AI engine not ready: configured provider unreachable';
    }
  }
  const value: EngineStatus = {
    component: 'ai-engine',
    state: ready ? 'ready' : 'not_ready',
    ready,
    configured: gap.configured,
    missing_config: gap.missing_config,
    missing_keys: gap.missing_keys,
    error,
  };
  cached = { at: Date.now(), value };
  return value;
}
