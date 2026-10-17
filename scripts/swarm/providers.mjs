/**
 * Call OpenAI-compatible chat completions in list order.
 * A network error, timeout, 408, 429, or 5xx tries the next provider.
 * A 400 does not. No provider here is assumed to be free or paid;
 * the caller supplies the endpoints.
 */

export async function completeWithProviders(providers, { system, prompt, timeoutMs = 15000 }) {
  if (!providers?.length) throw new Error('No providers configured');
  const attempts = [];
  for (const provider of providers) {
    try {
      const content = await callOne(provider, { system, prompt, timeoutMs });
      return { content, providerId: provider.id, attempts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ providerId: provider.id, error: message });
      if (!isFallback(message)) break;
    }
  }
  const detail = attempts.map(item => `${item.providerId}: ${item.error}`).join(' | ');
  throw new Error(`All providers failed. ${detail}`);
}

function isFallback(message) {
  const status = message.match(/HTTP (\d{3})/);
  if (!status) return true;
  const code = Number(status[1]);
  if (code === 400) return false;
  return code === 408 || code === 429 || code >= 500;
}

async function callOne(provider, { system, prompt, timeoutMs }) {
  const base = String(provider.baseUrl || '').replace(/\/$/, '');
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'content-type': 'application/json' };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model || 'local',
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${provider.id} HTTP ${response.status}: ${body.slice(0, 180)}`);
    const parsed = JSON.parse(body);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error(`${provider.id} returned no message content`);
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`${provider.id} timeout`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
