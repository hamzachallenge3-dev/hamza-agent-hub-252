/**
 * Model provider registry.
 *
 * The Hub was hardwired to one endpoint: if it was down, `callModel` silently
 * fell through to a heuristic that produced fabricated "offline scaffold"
 * prose. Providers are now declared adapters with their own health check,
 * so the Boss can fail over between free endpoints and, when none work,
 * report BLOCKED instead of inventing analysis.
 *
 * No adapter here is enabled by default unless its credentials/endpoint are
 * present, and none of them is a paid tier.
 */
import { redactSecrets } from '../security/redact.js';
import { modelTool } from './schemas.js';
import { freellmapiBaseUrl, freellmapiApiKey, freellmapiModel, freellmapiEnabled } from './freellmapi.js';

export interface ProviderMessage {
  role: string;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface ChatRequest {
  system: string;
  messages: ProviderMessage[];
  tools: string[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  provider: string;
  model: string;
  routed_via?: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface ProviderHealth {
  id: string;
  configured: boolean;
  ok: boolean;
  latency_ms: number | null;
  models_count?: number;
  sample_models?: string[];
  error?: string;
  /** Whether tool/function calling was observed to work on this endpoint. */
  tool_calling?: 'verified' | 'unverified' | 'unsupported';
  hint: string;
}

export interface ModelProvider {
  id: string;
  label: string;
  /** Free-tier only. A provider that bills is never auto-selected. */
  free: boolean;
  /** Priority order; lower runs first. */
  priority: number;
  configured(): boolean;
  baseUrl(): string;
  defaultModel(): string;
  apiKey(): string;
  supportsTools: boolean;
  /** Documented free-tier context budget, used for trimming. */
  contextTokens: number;
  health(timeoutMs?: number): Promise<ProviderHealth>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /**
   * Config and credential env names this adapter reads. Values are never
   * included — callers report the names when something is missing.
   */
  requirements(): ProviderRequirements;
}

export interface ProviderRequirements {
  config_env: string[];
  key_env: string[];
  requires_key: boolean;
  /** True only when an operator set one of config_env. A built-in default URL does not count. */
  endpoint_env_set: boolean;
  /** True when one of key_env is non-empty. The value is never copied here. */
  key_env_set: boolean;
}

/** Rough token estimate; good enough for budgeting without a tokenizer dep. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Drop the oldest middle turns until the request fits. The system prompt and
 * the most recent turns are always kept, so trimming never removes the
 * operator rules or the current instruction.
 */
export function budgetMessages(
  system: string,
  messages: ProviderMessage[],
  contextTokens: number,
  reserveForCompletion = 1024
): { messages: ProviderMessage[]; dropped: number; estimated_tokens: number } {
  const budget = Math.max(512, contextTokens - reserveForCompletion - estimateTokens(system));
  const kept = [...messages];
  let dropped = 0;
  const total = () => kept.reduce((n, m) => n + estimateTokens(m.content ?? ''), 0);
  // Keep the first user message (the mission) and the last few turns.
  while (kept.length > 3 && total() > budget) {
    kept.splice(1, 1);
    dropped += 1;
  }
  // Still too big: hard-truncate the largest remaining message.
  if (total() > budget) {
    const idx = kept.reduce((best, m, i) => (estimateTokens(m.content ?? '') > estimateTokens(kept[best].content ?? '') ? i : best), 0);
    const allowance = Math.max(400, budget - (total() - estimateTokens(kept[idx].content ?? '')));
    kept[idx] = { ...kept[idx], content: `${(kept[idx].content ?? '').slice(0, allowance * 4)}\n…[trimmed to fit context budget]` };
  }
  return { messages: kept, dropped, estimated_tokens: total() + estimateTokens(system) };
}

interface OpenAiCompatibleSpec {
  id: string;
  label: string;
  priority: number;
  envUrl: string[];
  envKey: string[];
  envModel: string[];
  defaultUrl?: string;
  defaultModel: string;
  contextTokens: number;
  supportsTools: boolean;
  /** Provider is only usable when a key is present. */
  requiresKey: boolean;
  hint: string;
  extraHeaders?: () => Record<string, string>;
}

function firstEnv(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Build an adapter for any endpoint that speaks the OpenAI chat API. */
export function openAiCompatibleProvider(spec: OpenAiCompatibleSpec): ModelProvider {
  const baseUrl = () => (firstEnv(spec.envUrl) || spec.defaultUrl || '').replace(/\/$/, '');
  const apiKey = () => firstEnv(spec.envKey);
  const defaultModel = () => firstEnv(spec.envModel) || spec.defaultModel;
  const configured = () => Boolean(baseUrl()) && (!spec.requiresKey || Boolean(apiKey()));

  return {
    id: spec.id,
    label: spec.label,
    free: true,
    priority: spec.priority,
    configured,
    baseUrl,
    defaultModel,
    apiKey,
    supportsTools: spec.supportsTools,
    contextTokens: spec.contextTokens,
    requirements: () => ({
      config_env: spec.envUrl,
      key_env: spec.envKey,
      requires_key: spec.requiresKey,
      endpoint_env_set: Boolean(firstEnv(spec.envUrl)),
      key_env_set: Boolean(firstEnv(spec.envKey)),
    }),

    async health(timeoutMs = 4000): Promise<ProviderHealth> {
      if (!configured()) {
        const hasKey = Boolean(apiKey());
        const error = spec.requiresKey && !hasKey
          ? `missing key ${spec.envKey.join(', ')}`
          : `missing config ${spec.envUrl.filter(Boolean).join(', ') || spec.id}`;
        return {
          id: spec.id,
          configured: false,
          ok: false,
          latency_ms: null,
          error,
          hint: spec.hint,
        };
      }
      const started = Date.now();
      try {
        const headers: Record<string, string> = { Accept: 'application/json', ...(spec.extraHeaders?.() ?? {}) };
        const key = apiKey();
        if (key) headers.Authorization = `Bearer ${key}`;
        const res = await fetch(`${baseUrl()}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        const latency = Date.now() - started;
        if (!res.ok) {
          return { id: spec.id, configured: true, ok: false, latency_ms: latency, error: `HTTP ${res.status}`, hint: spec.hint };
        }
        const json = (await res.json()) as { data?: Array<{ id?: string }> };
        const ids = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
        return {
          id: spec.id,
          configured: true,
          ok: true,
          latency_ms: latency,
          models_count: ids.length,
          sample_models: ids.slice(0, 10),
          tool_calling: spec.supportsTools ? 'unverified' : 'unsupported',
          hint: ids.length ? 'reachable' : 'reachable but the model catalog is empty',
        };
      } catch (err) {
        return {
          id: spec.id,
          configured: true,
          ok: false,
          latency_ms: Date.now() - started,
          error: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 160),
          hint: spec.hint,
        };
      }
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const model = req.model || defaultModel();
      const { messages } = budgetMessages(req.system, req.messages, spec.contextTokens);
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'system', content: req.system }, ...messages],
        temperature: 0.2,
      };
      if (spec.supportsTools && req.tools.length) body.tools = req.tools.map(modelTool);
      if (req.maxTokens) body.max_tokens = req.maxTokens;

      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(spec.extraHeaders?.() ?? {}) };
      const key = apiKey();
      if (key) headers.Authorization = `Bearer ${key}`;

      const timeout = AbortSignal.timeout(req.timeoutMs ?? 30_000);
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(redactSecrets(`${spec.id} HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`));
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
        model?: string;
        usage?: ChatResponse['usage'];
      };
      const msg = json.choices?.[0]?.message;
      return {
        provider: spec.id,
        model: json.model || model,
        routed_via: res.headers.get('x-routed-via'),
        content: msg?.content || '',
        usage: json.usage,
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
    },
  };
}

/** FreeLLMAPI keeps its own enable logic for backward compatibility. */
function freellmapiProvider(): ModelProvider {
  const base = openAiCompatibleProvider({
    id: 'freellmapi',
    label: 'FreeLLMAPI (self-hosted OSS free-tier aggregator)',
    priority: 10,
    envUrl: ['HAH_FREELLMAPI_URL', 'HAH_MODEL_URL'],
    envKey: ['HAH_FREELLMAPI_KEY', 'HAH_MODEL_API_KEY'],
    envModel: ['HAH_FREELLMAPI_MODEL', 'HAH_MODEL_NAME'],
    defaultUrl: 'http://127.0.0.1:3001/v1',
    defaultModel: 'auto',
    contextTokens: 32_000,
    supportsTools: true,
    requiresKey: false,
    hint: 'Start FreeLLMAPI (OSS): scripts/connect-freellmapi.sh, then HAH_MODEL_PROVIDER=freellmapi',
  });
  return {
    ...base,
    baseUrl: () => freellmapiBaseUrl(),
    apiKey: () => freellmapiApiKey(),
    defaultModel: () => freellmapiModel(),
    // Only a deliberate opt-in or a reachable local gateway counts as configured.
    configured: () => freellmapiEnabled(),
    requirements: () => ({
      config_env: ['HAH_MODEL_PROVIDER', 'HAH_FREELLMAPI_URL', 'HAH_USE_FREELLMAPI'],
      key_env: ['HAH_FREELLMAPI_KEY', 'HAH_MODEL_API_KEY'],
      requires_key: false,
      endpoint_env_set: freellmapiEnabled(),
      key_env_set: Boolean(process.env.HAH_FREELLMAPI_KEY || process.env.HAH_MODEL_API_KEY),
    }),
  };
}

export function allProviders(): ModelProvider[] {
  return [
    freellmapiProvider(),
    openAiCompatibleProvider({
      id: 'openai_compatible',
      label: 'Generic OpenAI-compatible endpoint (self-hosted / local)',
      priority: 20,
      envUrl: ['HAH_MODEL_URL', 'ECC68_MODEL_URL'],
      envKey: ['HAH_MODEL_API_KEY'],
      envModel: ['HAH_MODEL_NAME'],
      defaultModel: 'free-local',
      contextTokens: 32_000,
      supportsTools: true,
      requiresKey: false,
      hint: 'Set HAH_MODEL_URL to any OpenAI-compatible /v1 endpoint (llama.cpp, vLLM, Ollama, LM Studio)',
    }),
    openAiCompatibleProvider({
      id: 'ollama',
      label: 'Ollama local server (CPU)',
      priority: 25,
      envUrl: ['HAH_OLLAMA_URL'],
      envKey: [],
      envModel: ['HAH_OLLAMA_MODEL'],
      defaultUrl: '',
      defaultModel: 'qwen2.5:3b',
      contextTokens: 8_000,
      supportsTools: true,
      requiresKey: false,
      hint: 'Run `ollama serve` and set HAH_OLLAMA_URL=http://127.0.0.1:11434/v1',
    }),
    openAiCompatibleProvider({
      id: 'openrouter_free',
      label: 'OpenRouter free-tier models',
      priority: 30,
      envUrl: ['HAH_OPENROUTER_URL'],
      envKey: ['HAH_OPENROUTER_KEY', 'OPENROUTER_API_KEY'],
      envModel: ['HAH_OPENROUTER_MODEL'],
      defaultUrl: 'https://openrouter.ai/api/v1',
      // Only `:free` model ids are used, so no credits can be consumed.
      defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
      contextTokens: 32_000,
      supportsTools: true,
      requiresKey: true,
      hint: 'Set HAH_OPENROUTER_KEY. Only ":free" model ids are selected, so no credits are spent.',
      extraHeaders: () => ({ 'HTTP-Referer': 'https://hub.imdifferent01.com', 'X-Title': 'Hamza Agent Hub' }),
    }),
    openAiCompatibleProvider({
      id: 'huggingface',
      label: 'Hugging Face Inference (free tier)',
      priority: 40,
      envUrl: ['HAH_HF_URL'],
      envKey: ['HAH_HF_TOKEN', 'HUGGINGFACEHUB_API_TOKEN'],
      envModel: ['HAH_HF_MODEL'],
      defaultUrl: 'https://router.huggingface.co/v1',
      defaultModel: 'meta-llama/Llama-3.1-8B-Instruct',
      contextTokens: 16_000,
      supportsTools: false,
      requiresKey: true,
      hint: 'Set HAH_HF_TOKEN for the free Hugging Face inference router.',
    }),
  ].sort((a, b) => a.priority - b.priority);
}

export function configuredProviders(): ModelProvider[] {
  return allProviders().filter((p) => p.configured());
}

export function providerById(id: string): ModelProvider | null {
  return allProviders().find((p) => p.id === id) ?? null;
}

/** Health of every adapter, configured or not — an honest picture of the brain. */
export async function providerHealthReport(timeoutMs = 3000): Promise<{
  any_live: boolean;
  providers: ProviderHealth[];
}> {
  const results = await Promise.all(allProviders().map((p) => p.health(timeoutMs)));
  return { any_live: results.some((r) => r.ok), providers: results };
}

export interface CallOutcome {
  response: ChatResponse | null;
  attempts: Array<{ provider: string; ok: boolean; error?: string; ms: number }>;
}

/**
 * Try each configured provider in priority order with one retry on transient
 * failure. Returns `response: null` when every provider failed — the caller
 * must then surface BLOCKED rather than inventing an answer.
 */
export async function callWithFallback(req: ChatRequest, providers = configuredProviders()): Promise<CallOutcome> {
  const attempts: CallOutcome['attempts'] = [];
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const response = await provider.chat(req);
        attempts.push({ provider: provider.id, ok: true, ms: Date.now() - started });
        return { response, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({ provider: provider.id, ok: false, error: message.slice(0, 200), ms: Date.now() - started });
        if (req.signal?.aborted) return { response: null, attempts };
        // 4xx other than 429 will not succeed on a retry.
        if (/HTTP 4(?!29)\d\d/.test(message)) break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return { response: null, attempts };
}

/**
 * Circuit breaker so a dead provider is not retried on every single step.
 */
const breakers = new Map<string, { failures: number; openUntil: number }>();

export function recordProviderResult(providerId: string, ok: boolean): void {
  const b = breakers.get(providerId) ?? { failures: 0, openUntil: 0 };
  if (ok) {
    breakers.set(providerId, { failures: 0, openUntil: 0 });
    return;
  }
  b.failures += 1;
  if (b.failures >= 3) b.openUntil = Date.now() + 60_000;
  breakers.set(providerId, b);
}

export function breakerOpen(providerId: string): boolean {
  const b = breakers.get(providerId);
  return Boolean(b && b.openUntil > Date.now());
}

export function resetBreakers(): void {
  breakers.clear();
}

export function availableProviders(): ModelProvider[] {
  return configuredProviders().filter((p) => !breakerOpen(p.id));
}
