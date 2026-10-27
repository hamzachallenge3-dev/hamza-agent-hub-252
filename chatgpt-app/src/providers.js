// Free-tier model providers only. Keys come from Worker secrets / env.
// Paid providers (OpenAI, Anthropic, and any other billed API) are not called.

const PAID_RE = /(^|\/)(gpt-4|gpt-4o|gpt-4\.1|gpt-5|gpt-3\.5|chatgpt-4|o1|o3|o4|dall-e|text-davinci|whisper-1|tts-1|claude)([-./]|$)|anthropic\/|gemini-[0-9.]+-(pro|ultra)/i;

export const PROVIDER_ORDER = ['groq', 'gemini', 'cloudflare', 'openrouter', 'huggingface'];

const GROQ_MODELS = [
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-safeguard-20b',
  'allam-2-7b',
];
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];
const CLOUDFLARE_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.2-1b-instruct',
];

const PROVIDERS = {
  groq: {
    id: 'groq',
    label: 'Groq free tier',
    secrets: ['GROQ_API_KEY'],
    defaultModel: GROQ_MODELS[0],
    models: GROQ_MODELS,
    note: 'Open-weight models on Groq\'s free tier (not the paid OpenAI API).',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini free tier',
    secrets: ['GEMINI_API_KEY'],
    defaultModel: GEMINI_MODELS[0],
    models: GEMINI_MODELS,
    note: 'AI Studio free-tier Flash models only. Pro and Ultra are blocked.',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI free allocation',
    secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    binding: 'AI',
    defaultModel: CLOUDFLARE_MODELS[0],
    models: CLOUDFLARE_MODELS,
    note: 'Uses the Workers AI binding named AI, or CLOUDFLARE_API_TOKEN plus CLOUDFLARE_ACCOUNT_ID. Small instruct models only.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter free models',
    secrets: ['OPENROUTER_API_KEY'],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-3-12b-it:free',
      'qwen/qwen-2.5-7b-instruct:free',
    ],
    note: 'Any model id that ends in :free is accepted. Ids without that suffix are blocked.',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face free inference',
    secrets: ['HF_TOKEN'],
    aliases: ['HUGGINGFACE_API_KEY'],
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct:hf-inference',
    models: [
      'Qwen/Qwen2.5-7B-Instruct:hf-inference',
      'meta-llama/Llama-3.2-3B-Instruct:hf-inference',
    ],
    note: 'Router calls are limited to the hf-inference provider (model ids ending in :hf-inference). HF_TOKEN is the secret to set; HUGGINGFACE_API_KEY is accepted as an alias.',
  },
};

const BANNED = new Set([
  'openai', 'anthropic', 'azure', 'azure-openai', 'bedrock', 'vertex', 'cohere',
  'mistral', 'together', 'fireworks', 'deepseek', 'perplexity', 'xai', 'grok',
]);

export function secretNames() {
  return ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'HF_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
}

function envValue(env, name) {
  const v = env && env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function configured(id, env) {
  if (id === 'cloudflare') {
    const binding = env && env.AI && typeof env.AI.run === 'function';
    return binding || (Boolean(envValue(env, 'CLOUDFLARE_API_TOKEN')) && Boolean(envValue(env, 'CLOUDFLARE_ACCOUNT_ID')));
  }
  if (id === 'huggingface') return Boolean(envValue(env, 'HF_TOKEN') || envValue(env, 'HUGGINGFACE_API_KEY'));
  const spec = PROVIDERS[id];
  return Boolean(spec && envValue(env, spec.secrets[0]));
}

export function isExplicitlyPaid(model) {
  return PAID_RE.test(String(model || '').trim());
}

function openRouterFree(model) {
  return /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+:free$/.test(model) && !isExplicitlyPaid(model);
}

function hfFree(model) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+:hf-inference$/.test(model) && !isExplicitlyPaid(model);
}

export function modelAllowed(providerId, model) {
  const spec = PROVIDERS[providerId];
  if (!spec || !model || isExplicitlyPaid(model)) return false;
  if (spec.models.includes(model)) return true;
  if (providerId === 'openrouter') return openRouterFree(model);
  if (providerId === 'huggingface') return hfFree(model);
  return false;
}

function providerForModel(model) {
  for (const id of PROVIDER_ORDER) {
    if (modelAllowed(id, model)) return id;
  }
  return null;
}

function redact(text, secrets, limit = 0) {
  let s = String(text || '');
  for (const secret of secrets) {
    if (secret && secret.length > 6) s = s.split(secret).join('[redacted]');
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]{6,}/gi, 'Bearer [redacted]');
  s = s.replace(/\b(sk|pk|rk|gsk|hf)_[A-Za-z0-9_\-]{8,}/g, '[redacted]');
  s = s.replace(/\bAIza[0-9A-Za-z_\-]{10,}/g, '[redacted]');
  return limit ? s.slice(0, limit) : s;
}

function knownSecrets(env) {
  const names = [...secretNames(), 'HUGGINGFACE_API_KEY'];
  return names.map(n => envValue(env, n)).filter(Boolean);
}

export function listProviders(env = {}) {
  const providers = PROVIDER_ORDER.map(id => {
    const spec = PROVIDERS[id];
    return {
      id,
      label: spec.label,
      free: true,
      configured: configured(id, env),
      secrets: spec.secrets,
      binding: spec.binding || null,
      defaultModel: spec.defaultModel,
      models: spec.models,
      note: spec.note,
    };
  });
  return {
    freeOnly: true,
    paidProviders: 'disabled',
    defaultOrder: providers.filter(p => p.configured).map(p => p.id),
    secretsToSet: secretNames().filter(n => !envValue(env, n) && !(n === 'HF_TOKEN' && envValue(env, 'HUGGINGFACE_API_KEY'))),
    providers,
  };
}

function clampTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 384;
  return Math.max(16, Math.min(512, Math.floor(n)));
}

async function readBody(res) {
  return res.text();
}

function messageText(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = data.choices && data.choices[0] && data.choices[0].message;
  if (choice && typeof choice.content === 'string' && choice.content.trim()) return choice.content.trim();
  if (typeof data.response === 'string' && data.response.trim()) return data.response.trim();
  if (data.result && typeof data.result.response === 'string' && data.result.response.trim()) return data.result.response.trim();
  return '';
}

async function callOpenAI({ url, key, model, messages, maxTokens, headers, fetchImpl, secrets }) {
  const res = await fetchImpl(url, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await readBody(res);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.detail = redact(body, secrets, 300);
    throw err;
  }
  let data;
  try { data = JSON.parse(body); }
  catch {
    const err = new Error('unreadable provider response');
    err.status = 502;
    throw err;
  }
  const text = redact(messageText(data), secrets);
  if (!text) {
    const err = new Error('empty completion');
    err.status = 502;
    throw err;
  }
  return text;
}

async function callCloudflare({ env, model, messages, maxTokens, fetchImpl, secrets }) {
  if (env.AI && typeof env.AI.run === 'function') {
    const out = await env.AI.run(model, { messages, max_tokens: maxTokens });
    const text = redact(messageText(out) || (typeof out === 'string' ? out.trim() : ''), secrets);
    if (!text) {
      const err = new Error('empty completion');
      err.status = 502;
      throw err;
    }
    return text;
  }
  const account = envValue(env, 'CLOUDFLARE_ACCOUNT_ID');
  const token = envValue(env, 'CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await readBody(res);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.detail = redact(body, secrets, 300);
    throw err;
  }
  let data;
  try { data = JSON.parse(body); } catch { data = null; }
  const text = data && redact(messageText(data), secrets);
  if (!text) {
    const err = new Error('empty completion');
    err.status = 502;
    throw err;
  }
  return text;
}

function shouldLeaveProvider(status) {
  return status === 401 || status === 402 || status === 403 || status === 429;
}

export async function completeFree({ env = {}, fetchImpl = globalThis.fetch, provider, model, maxTokens, messages }) {
  const secrets = knownSecrets(env);
  const requestedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  const attempts = [];
  const fail = (mode, error) => ({
    mode, text: null, provider: null, model: null, attempts, error,
    secretsToSet: listProviders(env).secretsToSet,
  });

  if (requestedProvider && (BANNED.has(requestedProvider) || !PROVIDERS[requestedProvider])) {
    return fail('blocked', `Provider "${requestedProvider}" is not available. This server calls free models only (${PROVIDER_ORDER.join(', ')}). Paid providers are disabled.`);
  }
  if (requestedModel && isExplicitlyPaid(requestedModel)) {
    return fail('blocked', `Model "${requestedModel}" is not free. No request was sent, and there is no paid fallback.`);
  }
  if (requestedProvider && requestedModel && !modelAllowed(requestedProvider, requestedModel)) {
    return fail('blocked', `Model "${requestedModel}" is not on the free allowlist for ${requestedProvider}. No request was sent.`);
  }
  if (requestedModel && !requestedProvider && !providerForModel(requestedModel)) {
    return fail('blocked', `Model "${requestedModel}" is not on a free allowlist. No request was sent.`);
  }

  const configuredIds = PROVIDER_ORDER.filter(id => configured(id, env));
  if (!configuredIds.length) {
    return {
      mode: 'prompt-only', text: null, provider: null, model: null, attempts,
      secretsToSet: secretNames(),
      error: null,
    };
  }

  let chain = configuredIds;
  const pinned = requestedProvider || (requestedModel ? providerForModel(requestedModel) : '');
  if (pinned) {
    if (!configured(pinned, env)) {
      attempts.push({ provider: pinned, model: requestedModel || PROVIDERS[pinned].defaultModel, ok: false, status: 0, error: `not configured; set ${PROVIDERS[pinned].secrets.join(' and ')}` });
    }
    chain = [pinned, ...configuredIds.filter(id => id !== pinned)].filter(id => configured(id, env));
  }

  const tokens = clampTokens(maxTokens);
  let calls = 0;
  for (const id of chain) {
    if (calls >= 5) break;
    const spec = PROVIDERS[id];
    const models = requestedModel && (id === pinned || modelAllowed(id, requestedModel))
      ? [requestedModel]
      : [spec.defaultModel, ...spec.models.filter(m => m !== spec.defaultModel)].slice(0, 2);
    for (const mid of models) {
      if (!modelAllowed(id, mid)) {
        attempts.push({ provider: id, model: mid, ok: false, status: 0, error: 'not on the free allowlist' });
        continue;
      }
      if (calls >= 5) break;
      calls += 1;
      try {
        const text = id === 'cloudflare'
          ? await callCloudflare({ env, model: mid, messages, maxTokens: tokens, fetchImpl, secrets })
          : await callOpenAI({
            url: endpoint(id),
            key: id === 'huggingface' ? (envValue(env, 'HF_TOKEN') || envValue(env, 'HUGGINGFACE_API_KEY')) : envValue(env, spec.secrets[0]),
            model: mid,
            messages,
            maxTokens: tokens,
            headers: id === 'openrouter' ? { 'X-Title': 'Hamza Agent Hub' } : {},
            fetchImpl,
            secrets,
          });
        attempts.push({ provider: id, model: mid, ok: true, status: 200 });
        return { mode: 'completion', text, provider: id, model: mid, attempts, secretsToSet: listProviders(env).secretsToSet, error: null };
      } catch (e) {
        const status = e && e.status || 0;
        attempts.push({ provider: id, model: mid, ok: false, status, error: redact(e && (e.detail || e.message) || 'request failed', secrets) });
        if (shouldLeaveProvider(status)) break;
      }
    }
  }
  return {
    mode: 'providers-failed', text: null, provider: null, model: null, attempts,
    secretsToSet: listProviders(env).secretsToSet,
    error: 'Every configured free provider failed.',
  };
}

function endpoint(id) {
  if (id === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
  if (id === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  if (id === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
  if (id === 'huggingface') return 'https://router.huggingface.co/v1/chat/completions';
  throw new Error('no endpoint');
}
