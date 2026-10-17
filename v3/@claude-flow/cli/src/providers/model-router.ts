/**
 * Dispatch one completion across the providers in ruflo.settings.json.
 * The array order is the fallback order. A named provider is tried first
 * when the caller asks for one, then the rest of the list when fallbacks
 * are enabled.
 */

import {
  anthropicMessagesUrl,
  chatCompletionsUrl,
  geminiGenerateUrl,
  redactSecrets,
  type ProviderConfig,
  type RufloSettings,
} from './model-settings.js';

export interface CompletionRequest {
  prompt: string;
  systemPrompt?: string;
  /** Concrete model id. Logical Claude tiers stay on the provider's model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  providerId?: string;
}

export interface ProviderAttempt {
  providerId: string;
  error: string;
}

export interface CompletionResult {
  success: boolean;
  providerId?: string;
  model?: string;
  output?: string;
  messageId?: string;
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs?: number;
  error?: string;
  fallbackHistory?: ProviderAttempt[];
  skipped?: ProviderAttempt[];
}

const LOGICAL_MODELS = new Set([
  'haiku',
  'sonnet',
  'opus',
  'opus-4.7',
  'sonnet-4.6',
  'inherit',
]);

export async function completeWithSettings(
  settings: RufloSettings,
  request: CompletionRequest,
): Promise<CompletionResult> {
  const startedAt = Date.now();
  const preferred = request.providerId?.trim().toLowerCase();
  if (preferred && !settings.providers.some(provider => provider.id.toLowerCase() === preferred)) {
    return {
      success: false,
      error: `Provider "${preferred}" is not in ${settings.sourcePath}. Configured: ${settings.providers.map(provider => provider.id).join(', ') || '(none)'}.`,
      durationMs: Date.now() - startedAt,
    };
  }

  const ordered = orderProviders(settings.providers, preferred);
  const queue = settings.fallbacks ? ordered : ordered.slice(0, 1);
  const skipped: ProviderAttempt[] = [];
  const fallbackHistory: ProviderAttempt[] = [];
  let lastError = '';

  for (const provider of queue) {
    if (!provider.enabled) {
      skipped.push({ providerId: provider.id, error: provider.skipReason || 'disabled' });
      if (!settings.fallbacks) break;
      continue;
    }
    const result = await callProvider(provider, request);
    if (result.success) {
      return {
        ...result,
        durationMs: Date.now() - startedAt,
        ...(fallbackHistory.length ? { fallbackHistory } : {}),
        ...(skipped.length ? { skipped } : {}),
      };
    }
    lastError = result.error || `${provider.id} failed`;
    fallbackHistory.push({ providerId: provider.id, error: lastError });
    if (!settings.fallbacks || !isFallbackError(lastError)) break;
  }

  const skipNote = skipped.length
    ? ` Skipped: ${skipped.map(item => `${item.providerId} (${item.error})`).join('; ')}.`
    : '';
  const failNote = fallbackHistory.length
    ? ` ${fallbackHistory.map(item => `${item.providerId}: ${item.error}`).join(' | ')}`
    : '';
  const stoppedOnCallerError = !!lastError && !isFallbackError(lastError);
  const error = !fallbackHistory.length
    ? `No configured provider could be called.${skipNote}`
    : stoppedOnCallerError
      ? `${lastError}${skipNote}`
      : `All configured providers failed.${skipNote}${failNote}`;
  return {
    success: false,
    error: error.trim(),
    fallbackHistory,
    skipped,
    durationMs: Date.now() - startedAt,
  };
}

function orderProviders(providers: ProviderConfig[], preferred: string | undefined): ProviderConfig[] {
  if (!preferred) return providers;
  const index = providers.findIndex(provider => provider.id.toLowerCase() === preferred);
  if (index < 0) return providers;
  return [providers[index], ...providers.slice(0, index), ...providers.slice(index + 1)];
}

function isFallbackError(error: string): boolean {
  const status = error.match(/API error (\d{3})\b/);
  if (!status) return true;
  const code = Number(status[1]);
  if (code === 400 && !/model|not found|does not exist|unknown|unsupported/i.test(error)) return false;
  return true;
}

const SAMPLING_REJECTED = /^claude-(fable-5|opus-4-8|opus-4-7|sonnet-5)/;

export function resolveProviderModel(provider: ProviderConfig, requested: string | undefined): string {
  if (!requested) return provider.model;
  const bare = requested.startsWith('ollama:') ? requested.slice('ollama:'.length) : requested;
  if (LOGICAL_MODELS.has(bare)) return provider.model;
  if (bare.startsWith('anthropic:')) {
    const id = bare.slice('anthropic:'.length);
    return provider.protocol === 'anthropic' ? id : provider.model;
  }
  if (/^claude-/i.test(bare) && provider.protocol !== 'anthropic') return provider.model;
  if (/^anthropic\//i.test(bare) && provider.protocol === 'openai') {
    const openRouter = provider.id === 'openrouter' || provider.baseUrl.includes('openrouter.ai');
    return openRouter ? bare : provider.model;
  }
  return bare;
}

async function callProvider(provider: ProviderConfig, request: CompletionRequest): Promise<CompletionResult> {
  const model = resolveProviderModel(provider, request.model);
  const timeoutMs = request.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const secrets = [provider.apiKey];
  try {
    const { url, init } = buildRequest(provider, request, model);
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    const safeBody = redactSecrets(body, secrets);
    if (urlIncludesSecret(url, provider.apiKey)) {
      return { success: false, providerId: provider.id, model, error: `${provider.id} refused to put the API key in the request URL` };
    }
    if (!response.ok) {
      return {
        success: false,
        providerId: provider.id,
        model,
        error: `${provider.id} API error ${response.status}: ${safeBody.slice(0, 400)}`,
      };
    }
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { success: false, providerId: provider.id, model, error: `${provider.id} returned a non-JSON response` };
    }
    return normalizeResponse(provider, model, data);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted
      ? `timeout after ${timeoutMs}ms`
      : (err instanceof Error ? err.message : String(err));
    return {
      success: false,
      providerId: provider.id,
      model,
      error: redactSecrets(`${provider.id}: ${message}`, secrets),
    };
  } finally {
    clearTimeout(timer);
  }
}

function urlIncludesSecret(url: string, secret: string | undefined): boolean {
  return !!secret && secret.length >= 4 && url.includes(secret);
}

function buildRequest(
  provider: ProviderConfig,
  request: CompletionRequest,
  model: string,
): { url: string; init: RequestInit } {
  const temperature = typeof request.temperature === 'number' ? request.temperature : 0.7;
  const maxTokens = request.maxTokens || 1024;
  if (provider.protocol === 'anthropic') {
    const omitSampling = SAMPLING_REJECTED.test(model);
    return {
      url: anthropicMessagesUrl(provider.baseUrl),
      init: {
        method: 'POST',
        headers: {
          ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(omitSampling ? {} : { temperature }),
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          messages: [{ role: 'user', content: request.prompt }],
        }),
      },
    };
  }
  if (provider.protocol === 'gemini') {
    return {
      url: geminiGenerateUrl(provider.baseUrl, model),
      init: {
        method: 'POST',
        headers: {
          ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          ...(request.systemPrompt
            ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
            : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
      },
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/ruvnet/ruflo';
    headers['X-Title'] = 'Ruflo';
  }
  const messages: Array<{ role: string; content: string }> = [];
  if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
  messages.push({ role: 'user', content: request.prompt });
  return {
    url: chatCompletionsUrl(provider.baseUrl),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
    },
  };
}

function normalizeResponse(provider: ProviderConfig, model: string, data: unknown): CompletionResult {
  if (!data || typeof data !== 'object') {
    return { success: false, providerId: provider.id, model, error: `${provider.id} returned an unexpected response` };
  }
  const record = data as Record<string, unknown>;
  if (provider.protocol === 'anthropic') {
    const content = Array.isArray(record.content) ? record.content : [];
    const output = content
      .map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('');
    if (!content.length) {
      return { success: false, providerId: provider.id, model, error: `${provider.id} returned no content` };
    }
    const usage = record.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      success: true,
      providerId: provider.id,
      model: typeof record.model === 'string' ? record.model : model,
      messageId: typeof record.id === 'string' ? record.id : undefined,
      stopReason: typeof record.stop_reason === 'string' ? record.stop_reason : undefined,
      output,
      usage: usage ? {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      } : undefined,
    };
  }
  if (provider.protocol === 'gemini') {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> }; finishReason?: string } | undefined;
    const parts = first?.content?.parts ?? [];
    if (!first) {
      return { success: false, providerId: provider.id, model, error: `${provider.id} returned no candidates` };
    }
    const output = parts.map(part => part.text ?? '').join('');
    const usage = record.usageMetadata as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    } | undefined;
    return {
      success: true,
      providerId: provider.id,
      model,
      stopReason: first.finishReason,
      output,
      usage: usage ? {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      } : undefined,
    };
  }
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0] as {
    message?: { content?: unknown };
    finish_reason?: string;
  } | undefined;
  if (!choice) {
    return { success: false, providerId: provider.id, model, error: `${provider.id} returned no choices` };
  }
  const usage = record.usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | undefined;
  return {
    success: true,
    providerId: provider.id,
    model: typeof record.model === 'string' ? record.model : model,
    messageId: typeof record.id === 'string' ? record.id : undefined,
    stopReason: choice.finish_reason,
    output: messageText(choice.message?.content),
    usage: usage ? {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    } : undefined,
  };
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text;
    }
    return '';
  }).join('');
}
