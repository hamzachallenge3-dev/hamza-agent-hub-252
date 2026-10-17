/**
 * Single-file model configuration for Ruflo.
 *
 * Lookup order:
 *   1. RUFLO_SETTINGS (absolute or cwd-relative path)
 *   2. ./ruflo.settings.json
 *   3. ./.ruflo/settings.json
 *
 * Secrets belong in the environment. A settings value of "env:NAME" or
 * "${NAME}" is resolved at load time and is never included in summaries
 * or error text by this module's helpers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini';

export interface ProviderPreset {
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
}

/** Known endpoints. Any other OpenAI-compatible server is a custom baseUrl. */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  groq: {
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
  },
  ollama: {
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
  },
  together: {
    protocol: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  },
  deepseek: {
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  mistral: {
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
  },
  gemini: {
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
  },
  anthropic: {
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
  },
};

export interface ProviderConfig {
  id: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  /** Resolved secret. Callers must not log or persist this value. */
  apiKey?: string;
  enabled: boolean;
  skipReason?: string;
}

export interface RufloSettings {
  version: 1;
  fallbacks: boolean;
  providers: ProviderConfig[];
  sourcePath: string;
}

const SETTINGS_NAMES = ['ruflo.settings.json', join('.ruflo', 'settings.json')];

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * OpenAI-compatible chat URL. A base that already ends in /v1 or
 * /chat/completions is not given a second /v1.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function anthropicMessagesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/v1\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function geminiGenerateUrl(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/models\/[^/]+:generateContent$/i.test(base)) return base;
  return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function resolveSecret(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { value?: string; missingEnv?: string } {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') {
    throw new Error('apiKey must be a string (use "env:VAR" or "${VAR}")');
  }
  const trimmed = raw.trim();
  const match = trimmed.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    || trimmed.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { value: trimmed };
  const value = env[match[1]];
  if (!value) return { missingEnv: match[1] };
  return { value };
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  const unique = [...new Set(secrets.filter((secret): secret is string => !!secret && secret.length >= 4))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) out = out.split(secret).join('[redacted]');
  out = out.replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, '[redacted]');
  out = out.replace(/\b(gsk_[A-Za-z0-9_\-]{8,})\b/g, '[redacted]');
  out = out.replace(/\b(AIza[0-9A-Za-z\-_]{20,})\b/g, '[redacted]');
  return out;
}

export function loadRufloSettings(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): RufloSettings | null {
  const explicit = env.RUFLO_SETTINGS?.trim();
  const candidates = explicit
    ? [isAbsolute(explicit) ? explicit : join(cwd, explicit)]
    : SETTINGS_NAMES.map(name => join(cwd, name));
  const sourcePath = candidates.find(candidate => existsSync(candidate));
  if (!sourcePath) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`ruflo settings file is not valid JSON (${sourcePath}): ${detail}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`ruflo settings file must be a JSON object (${sourcePath})`);
  }
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.providers)) {
    throw new Error(`ruflo settings file must contain a providers array (${sourcePath})`);
  }
  return {
    version: 1,
    fallbacks: root.fallbacks !== false,
    providers: root.providers.map((entry, index) => normalizeProvider(entry, index, env)),
    sourcePath,
  };
}

export function summarizeSettings(settings: RufloSettings): {
  sourcePath: string;
  fallbacks: boolean;
  providers: Array<{
    id: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    model: string;
    enabled: boolean;
    skipReason?: string;
    apiKey: 'set' | 'unset';
  }>;
} {
  return {
    sourcePath: settings.sourcePath,
    fallbacks: settings.fallbacks,
    providers: settings.providers.map(provider => ({
      id: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
      enabled: provider.enabled,
      skipReason: provider.skipReason,
      apiKey: provider.apiKey ? 'set' : 'unset',
    })),
  };
}

function normalizeProvider(entry: unknown, index: number, env: NodeJS.ProcessEnv): ProviderConfig {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`providers[${index}] must be an object`);
  }
  const raw = entry as Record<string, unknown>;
  const presetName = typeof raw.preset === 'string' ? raw.preset.trim() : '';
  if (presetName && !(presetName in PROVIDER_PRESETS)) {
    throw new Error(
      `providers[${index}] has unknown preset "${presetName}". Known presets: ${Object.keys(PROVIDER_PRESETS).sort().join(', ')}`,
    );
  }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : presetName;
  if (!id) throw new Error(`providers[${index}] needs an id`);
  const preset = presetName
    ? PROVIDER_PRESETS[presetName]
    : (id in PROVIDER_PRESETS ? PROVIDER_PRESETS[id] : undefined);
  const protocol = (typeof raw.protocol === 'string' ? raw.protocol : preset?.protocol) as ProviderProtocol | undefined;
  if (protocol !== 'openai' && protocol !== 'anthropic' && protocol !== 'gemini') {
    throw new Error(`providers[${index}] (${id}) needs protocol "openai", "anthropic", or "gemini", or a known preset`);
  }
  const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim() : preset?.baseUrl;
  if (!baseUrl) throw new Error(`providers[${index}] (${id}) needs a baseUrl`);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`providers[${index}] (${id}) baseUrl must be an absolute http(s) URL`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`providers[${index}] (${id}) baseUrl must use http or https`);
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error(`providers[${index}] (${id}) baseUrl must not contain credentials`);
  }
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : preset?.defaultModel;
  if (!model) throw new Error(`providers[${index}] (${id}) needs a model`);

  if (raw.enabled === false) {
    return { id, protocol, baseUrl, model, enabled: false, skipReason: 'disabled' };
  }

  let secret: { value?: string; missingEnv?: string };
  try {
    secret = resolveSecret(raw.apiKey, env);
  } catch (err) {
    throw new Error(`providers[${index}] (${id}) ${err instanceof Error ? err.message : String(err)}`);
  }
  if (secret.missingEnv) {
    return {
      id,
      protocol,
      baseUrl,
      model,
      enabled: false,
      skipReason: `environment variable ${secret.missingEnv} is not set`,
    };
  }
  const keyOptional = protocol === 'openai' && isLoopbackBaseUrl(baseUrl) && secret.value === undefined;
  if (!secret.value && !keyOptional) {
    return { id, protocol, baseUrl, model, enabled: false, skipReason: 'apiKey is not set' };
  }
  return { id, protocol, baseUrl, model, apiKey: secret.value, enabled: true };
}
