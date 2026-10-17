/**
 * Groq free-tier chat client for agent evaluation.
 *
 * Confirmed free-tier chat model: openai/gpt-oss-120b
 * (largest chat id on the free plan). Published limits:
 *   30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD.
 * Calls are sequential. This module paces under those limits and
 * backs off on HTTP 429. It never logs the API key.
 */

const FREE_CHAT_MODELS = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
]);

export const GROQ_FREE_LIMITS = {
  model: 'openai/gpt-oss-120b',
  rpm: 30,
  rpd: 1000,
  tpm: 8000,
  tpd: 200000,
};

const PACE_CAPS = { rpm: 20, tpm: 6800, windowMs: 60_000 };

export class DailyLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DailyLimitError';
  }
}

export class FatalGroqError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalGroqError';
  }
}

export function redact(text, secret = process.env.GROQ_API_KEY || '') {
  let out = String(text ?? '');
  if (secret) out = out.split(secret).join('[redacted]');
  return out
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/gsk_[A-Za-z0-9]+/g, '[redacted]');
}

export function parseDuration(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  let ms = 0;
  let rest = text;
  const take = (pattern, mult) => {
    const match = rest.match(pattern);
    if (!match) return;
    ms += Number(match[1]) * mult;
    rest = rest.replace(match[0], '');
  };
  take(/(\d+(?:\.\d+)?)h/i, 3_600_000);
  take(/(\d+(?:\.\d+)?)ms/i, 1);
  take(/(\d+(?:\.\d+)?)m(?!s)/i, 60_000);
  take(/(\d+(?:\.\d+)?)s/i, 1000);
  if (!ms && /^\d+(\.\d+)?$/.test(text)) ms = Number(text) * 1000;
  return ms;
}

export function classifyGroqStatus(status, body) {
  const text = String(body || '');
  if (status === 429) {
    if (/per day|\bTPD\b|\bRPD\b/i.test(text)) return 'daily';
    return 'minute';
  }
  if (status === 403 || status === 408 || status === 409 || status === 500 || status === 502 || status === 503 || status === 504) {
    return 'retry';
  }
  if (status >= 200 && status < 300) return 'ok';
  return 'fatal';
}

export function paceWaitMs(state, estimate, now, caps = PACE_CAPS) {
  const windowMs = caps.windowMs;
  const requests = (state.requests || []).filter(stamp => now - stamp < windowMs);
  const tokens = (state.tokens || []).filter(item => now - item.at < windowMs);
  const used = tokens.reduce((sum, item) => sum + item.tokens, 0);
  let wait = 0;
  if (requests.length >= caps.rpm && requests.length) {
    wait = Math.max(wait, requests[0] + windowMs - now);
  }
  if (used + estimate > caps.tpm && tokens.length) {
    wait = Math.max(wait, tokens[0].at + windowMs - now);
  }
  if (state.remainingTokens != null && state.remainingTokens < estimate && state.tokenResetAt > now) {
    wait = Math.max(wait, state.tokenResetAt - now);
  }
  return { wait: Math.max(0, wait), requests, tokens, used };
}

function estimateTokens(messages, maxTokens) {
  const chars = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
  return Math.ceil(chars / 4) + maxTokens + 16;
}

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

export function createGroqClient(options = {}) {
  const model = options.model || GROQ_FREE_LIMITS.model;
  const apiKey = options.apiKey || process.env.GROQ_API_KEY || '';
  const fetchImpl = options.fetch || globalThis.fetch;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || (() => Date.now());
  const log = options.log || (() => {});
  const caps = options.caps || PACE_CAPS;
  const state = {
    requests: [],
    tokens: [],
    remainingTokens: null,
    remainingRequests: null,
    tokenResetAt: 0,
    runRequests: 0,
    runTokens: 0,
  };

  function stats() {
    return {
      requests: state.runRequests,
      tokens: state.runTokens,
      remainingRequests: state.remainingRequests,
      remainingTokens: state.remainingTokens,
    };
  }

  async function pace(estimate) {
    for (let turn = 0; turn < 8; turn++) {
      const decision = paceWaitMs(state, estimate, now(), caps);
      state.requests = decision.requests;
      state.tokens = decision.tokens;
      if (decision.wait <= 0) return;
      const bounded = Math.min(decision.wait + 200, 70_000);
      log(`pace ${Math.ceil(bounded / 1000)}s windowTokens=${decision.used} estimate=${estimate}`);
      await sleep(bounded);
    }
    throw new DailyLimitError('Groq pace window did not clear');
  }

  async function request(url, payload, attemptTokens) {
    const estimate = estimateTokens(payload.messages || [], attemptTokens);
    await pace(estimate);
    if (state.remainingRequests === 0) {
      throw new DailyLimitError('Groq daily request bucket is empty');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'user-agent': 'ruflo-eval/1.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.text();
      return { response, body, estimate };
    } finally {
      clearTimeout(timer);
    }
  }

  function note(totalTokens, headers) {
    const stamp = now();
    state.requests.push(stamp);
    state.tokens.push({ at: stamp, tokens: totalTokens });
    state.runRequests += 1;
    state.runTokens += totalTokens;
    const remTokens = header(headers, 'x-ratelimit-remaining-tokens');
    const remRequests = header(headers, 'x-ratelimit-remaining-requests');
    const resetTokens = header(headers, 'x-ratelimit-reset-tokens');
    if (remTokens != null && remTokens !== '') state.remainingTokens = Number(remTokens);
    if (remRequests != null && remRequests !== '') state.remainingRequests = Number(remRequests);
    if (resetTokens) state.tokenResetAt = stamp + parseDuration(resetTokens);
  }

  async function chat(messages, numPredict, temperature = 0.1, json = false) {
    if (!apiKey) throw new FatalGroqError('GROQ_API_KEY is unset');
    if (!FREE_CHAT_MODELS.has(model)) {
      throw new FatalGroqError(`${model} is not a confirmed free-tier chat model`);
    }
    let maxTokens = Math.max(32, numPredict);
    for (let attempt = 1; attempt <= 6; attempt++) {
      const payload = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        reasoning_effort: 'low',
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      };
      let response;
      let body;
      let estimate;
      try {
        ({ response, body, estimate } = await request(
          'https://api.groq.com/openai/v1/chat/completions',
          payload,
          maxTokens,
        ));
      } catch (err) {
        if (err.name === 'DailyLimitError' || err.name === 'FatalGroqError') throw err;
        if (err.name === 'AbortError') {
          if (attempt >= 3) throw new FatalGroqError('timeout');
          log(`timeout attempt ${attempt}`);
          await sleep(1000 * attempt);
          continue;
        }
        if (attempt >= 4) throw new FatalGroqError(redact(err.message || err, apiKey));
        log(`transient ${redact(err.message || err, apiKey).slice(0, 160)}`);
        await sleep(1000 * attempt);
        continue;
      }
      const kind = classifyGroqStatus(response.status, body);
      if (kind === 'daily') {
        throw new DailyLimitError(redact(`Groq daily limit HTTP ${response.status}: ${body.slice(0, 220)}`, apiKey));
      }
      if (kind === 'minute' || kind === 'retry') {
        const retryAfter = parseDuration(header(response.headers, 'retry-after'));
        const hinted = parseDuration((body.match(/try again in\s+([0-9hms.]+)/i) || [])[1]);
        const wait = Math.max(retryAfter || hinted || Math.min(2000 * attempt, 20_000), 250);
        state.remainingTokens = 0;
        state.tokenResetAt = now() + wait;
        log(`backoff HTTP ${response.status} attempt ${attempt} wait ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (response.status === 400 && /json_validate_failed/.test(body) && attempt < 3) {
        maxTokens = Math.min(Math.max(maxTokens * 2, 220), 700);
        log('json validation failed, retrying with a larger token cap');
        continue;
      }
      if (kind === 'fatal') {
        throw new FatalGroqError(redact(`HTTP ${response.status}: ${body.slice(0, 300)}`, apiKey));
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        if (attempt >= 3) throw new FatalGroqError('Groq returned non-JSON');
        await sleep(500 * attempt);
        continue;
      }
      const total = Number(parsed.usage?.total_tokens) || estimate;
      note(total, response.headers);
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
      if (attempt === 1) {
        maxTokens = Math.min(maxTokens * 2, 700);
        log('empty completion, retrying once with a larger token cap');
        continue;
      }
      return typeof content === 'string' ? content : '';
    }
    throw new DailyLimitError('Groq retries exhausted after rate limits');
  }

  async function confirm() {
    if (!apiKey) throw new FatalGroqError('GROQ_API_KEY is unset');
    if (!FREE_CHAT_MODELS.has(model)) {
      throw new FatalGroqError(`${model} is not a confirmed free-tier chat model`);
    }
    const response = await fetchImpl('https://api.groq.com/openai/v1/models', {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'ruflo-eval/1.0',
      },
    });
    const body = await response.text();
    const kind = classifyGroqStatus(response.status, body);
    if (kind === 'daily') throw new DailyLimitError(redact(body.slice(0, 220), apiKey));
    if (kind !== 'ok') throw new FatalGroqError(redact(`model list HTTP ${response.status}: ${body.slice(0, 200)}`, apiKey));
    const data = JSON.parse(body);
    const ids = (data.data || []).map(item => item.id);
    if (!ids.includes(model)) {
      throw new FatalGroqError(`Model ${model} is not offered on this Groq account`);
    }
    log(`groq model=${model} freeTier=yes rpm=${GROQ_FREE_LIMITS.rpm} rpd=${GROQ_FREE_LIMITS.rpd} tpm=${GROQ_FREE_LIMITS.tpm} tpd=${GROQ_FREE_LIMITS.tpd}`);
    return { model, ids, limits: GROQ_FREE_LIMITS };
  }

  return { chat, confirm, stats };
}
