/** Secret bindings: HUB_SECRET, ORIGIN_URL (or live alias HUB_ORIGIN), ORIGIN_TOKEN, OPENAI_APPS_CHALLENGE.
 * Never log URLs: the public MCP path is a bearer capability.
 */
export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const json = (status, data) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
  if (url.pathname === '/.well-known/openai-apps-challenge') {
    if (request.method !== 'GET' || !env.OPENAI_APPS_CHALLENGE) return json(404, {error:'not found'});
    return new Response(env.OPENAI_APPS_CHALLENGE, {headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  }
  if (url.pathname === '/healthz') {
    if (request.method !== 'GET') return json(405, {error:'method not allowed'});
    try {
      const origin = originUrl(resolveOrigin(env));
      const res = await fetcher(new URL('/healthz', origin), {redirect:'error', signal:AbortSignal.timeout(3000)});
      const data = res.ok ? await res.json() : {};
      return json(res.ok && data.ok === true ? 200 : 503, {ok:res.ok && data.ok === true, service:'hamza-agent-hub-edge'});
    } catch { return json(503, {ok:false, service:'hamza-agent-hub-edge'}); }
  }
  if (!env.HUB_SECRET || env.HUB_SECRET.length < 32 || !/^[A-Za-z0-9_-]+$/.test(env.HUB_SECRET) ||
      !env.ORIGIN_TOKEN || env.ORIGIN_TOKEN.length < 24) return json(503, {error:'edge not configured'});
  const expected = `/${env.HUB_SECRET}/mcp`;
  // Compare digests without leaking the secret in errors or responses.
  const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([hash(url.pathname),hash(expected)]);
  let diff = 0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i];
  if (diff !== 0 || url.search) return json(404, {error:'not found'});
  if (request.method !== 'POST') return new Response(null, {status:405, headers:{Allow:'POST'}});
  const originHeader = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  if (originHeader && !allowed.includes(originHeader)) return json(403, {error:'forbidden origin'});
  if (!env.RATE_LIMITER) return json(503, {error:'rate limiter not configured'});
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await env.RATE_LIMITER.limit({key})).success) {
    return new Response('rate limited', {status:429, headers:{'Retry-After':'60'}});
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json(415, {error:'JSON required'});
  // Read with a hard cap, including requests without Content-Length.
  const reader = request.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) {
    while (true) {
      const {done,value} = await reader.read(); if(done) break;
      size += value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); return json(413, {error:'request too large'}); }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(size); let offset = 0;
  for(const chunk of chunks) {body.set(chunk,offset); offset += chunk.length;}
  try {
    const origin = originUrl(resolveOrigin(env));
    const headers = new Headers({'Content-Type':'application/json','Authorization':`Bearer ${env.ORIGIN_TOKEN}`});
    for(const h of ['Accept','MCP-Protocol-Version','Last-Event-ID']) {
      const value=request.headers.get(h); if(value) headers.set(h,value);
    }
    const res = await fetcher(new URL('/mcp', origin), {
      method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(35_000)
    });
    if (res.status >= 500) return json(502, {error:'origin unavailable'});
    const responseHeaders = new Headers({'Cache-Control':'no-store'});
    for(const h of ['Content-Type','MCP-Protocol-Version','Retry-After']) {
      const value=res.headers.get(h); if(value) responseHeaders.set(h,value);
    }
    return new Response(res.body, {status:res.status,headers:responseHeaders});
  } catch { return json(502, {error:'origin unavailable'}); }
}
/** Prefer ORIGIN_URL; accept live Worker alias HUB_ORIGIN for the tunnel HTTPS origin. */
function resolveOrigin(env) {
  return env.ORIGIN_URL || env.HUB_ORIGIN || '';
}
function originUrl(raw) {
  const url = new URL(raw);
  if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid origin');
  return url;
}
export default {fetch:handle};
