import {expect,it,vi} from 'vitest';
// @ts-expect-error Worker is portable JavaScript, shared with Cloudflare.
import {handle} from '../deploy/cloudflare-worker/worker.js';
const env={HUB_SECRET:'test-only-path-capability-32-characters',ORIGIN_TOKEN:'test-only-origin-auth-token-32',ORIGIN_URL:'https://origin.example/',OPENAI_APPS_CHALLENGE:'challenge',ALLOWED_ORIGINS:'https://chatgpt.com',RATE_LIMITER:{limit:async()=>({success:true})}};
const req=(path:string,method='POST',body='{}',headers={})=>new Request('https://hub.example'+path,{method,headers:{'Content-Type':'application/json',...headers},...(method==='POST'?{body}:{})});
it('Worker rejects bad paths, queries, origins and oversized bodies without forwarding',async()=>{
 const proxy=vi.fn();
 for(const [request,status] of [
  [req('/wrong/mcp'),404],[req(`/${env.HUB_SECRET}/mcp?secret=x`),404],
  [req(`/${env.HUB_SECRET}/mcp`,'GET'),405],
  [req(`/${env.HUB_SECRET}/mcp`,'POST','{}',{Origin:'https://chatgpt.com.evil'}),403],
  [req(`/${env.HUB_SECRET}/mcp`,'POST','x'.repeat(1_048_577)),413],
 ] as const) expect((await handle(request,env,proxy)).status).toBe(status);
 expect(proxy).not.toHaveBeenCalled();
});
it('Worker forwards JSON/SSE safely with origin auth, never capability paths',async()=>{
 const proxy=vi.fn(async(url:URL,init:any)=>{
  expect(url.href).toBe('https://origin.example/mcp');expect(init.headers.get('Authorization')).toBe(`Bearer ${env.ORIGIN_TOKEN}`);
  expect(init.headers.get('Cookie')).toBeNull();expect(init.redirect).toBe('error');
  return new Response('event: message\ndata: {}\n\n',{headers:{'Content-Type':'text/event-stream','Set-Cookie':'unsafe','Location':env.ORIGIN_URL}});
 });
 const res=await handle(req(`/${env.HUB_SECRET}/mcp`,'POST','{}',{Cookie:'private'}),env,proxy);
 expect(await res.text()).toContain('event: message');expect(res.headers.get('Set-Cookie')).toBeNull();expect(res.headers.get('Location')).toBeNull();
});
it('Worker health/challenge and failures never return secret values',async()=>{
 const health=await handle(req('/healthz','GET'),env,async()=>Response.json({ok:true,private:env.HUB_SECRET}));
 expect(health.status).toBe(200);expect(await health.text()).not.toContain(env.HUB_SECRET);
 expect(await (await handle(req('/.well-known/openai-apps-challenge','GET'),env)).text()).toBe('challenge');
 const error=await handle(req(`/${env.HUB_SECRET}/mcp`),env,async()=>{throw new Error(env.ORIGIN_TOKEN);});
 expect(error.status).toBe(502);expect(await error.text()).not.toContain(env.ORIGIN_TOKEN);
 const limited=await handle(req(`/${env.HUB_SECRET}/mcp`),{...env,RATE_LIMITER:{limit:async()=>({success:false})}});
 expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('60');
});
it('Worker accepts live HUB_ORIGIN alias when ORIGIN_URL is unset',async()=>{
 const live={...env,ORIGIN_URL:undefined,HUB_ORIGIN:'https://tunnel.example/'};
 const proxy=vi.fn(async(url:URL)=> {
  expect(url.href).toBe('https://tunnel.example/mcp');
  return Response.json({ok:true});
 });
 const res=await handle(req(`/${env.HUB_SECRET}/mcp`,'POST','{}'),live,proxy);
 expect(res.status).toBe(200);
 expect(proxy).toHaveBeenCalledOnce();
 const health=await handle(req('/healthz','GET'),live,async(url:URL)=>{
  expect(url.href).toBe('https://tunnel.example/healthz');
  return Response.json({ok:true});
 });
 expect(health.status).toBe(200);
});
