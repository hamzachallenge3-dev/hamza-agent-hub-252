import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createHamzaHubServer} from '../src/mcp/tools.js';
import {createHttpApp} from '../src/mcp/http.js';
import {stopQueue,enqueueAgentTask,cancelTask,startQueue} from '../src/runtime/queue.js';
import {closeDb,getTask,updateTask,requeueInterrupted,claimNextQueued} from '../src/storage/db.js';
import {resolveSafePath,ensureWorkspace} from '../src/security/workspace.js';
import {redactSecrets} from '../src/security/redact.js';
import {planWithBoss} from '../src/runtime/boss.js';
import {listAgents,loadRoleInstructions} from '../src/runtime/registry.js';
import {MCP_SURFACE_TOOLS} from '../src/runtime/browse.js';
import {validateWorkflow,compactContext,extractLinks,tools13Capabilities} from '../src/packs/tools13/offline.js';
import {callModel} from '../src/model/client.js';
import {runTool} from '../src/tools/runner.js';
let base:string;
let clients:Client[]=[];
let servers:ReturnType<typeof createHamzaHubServer>[]=[];
let listener:ReturnType<ReturnType<typeof createHttpApp>['listen']>|undefined;
beforeEach(()=>{
 base=fs.mkdtempSync(path.join(os.tmpdir(),'hah-contract-'));
 vi.stubEnv('HAH_DB_PATH',path.join(base,'db.sqlite'));
 vi.stubEnv('HAH_WORKSPACES_DIR',path.join(base,'workspaces'));
 vi.stubEnv('HAH_AUTO_FREELLMAPI','0');
 vi.stubEnv('HAH_AUTH_TOKEN','test-only-authentication-token-32');
 vi.stubEnv('HAH_MODEL_URL',''); vi.stubEnv('HAH_MODEL_PROVIDER',''); vi.stubEnv('HAH_FREELLMAPI_URL','');
});
afterEach(async()=>{
 for(const c of clients) await c.close();
 for(const s of servers) await s.close();
 clients=[];servers=[];
 if(listener) {await new Promise<void>(resolve=>listener!.close(()=>resolve()));listener=undefined;}
 await stopQueue(); closeDb(); vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();
 fs.rmSync(base,{recursive:true,force:true});
});
async function client(){
 const [a,b]=InMemoryTransport.createLinkedPair();
 const server=createHamzaHubServer(), c=new Client({name:'contract',version:'1'});
 servers.push(server);clients.push(c);
 await server.connect(a);await c.connect(b);return c;
}
function text(r:any){return JSON.parse(r.content[0].text);}
async function until(id:string,status:string){
 for(let i=0;i<150;i++) {if(getTask(id)?.status===status)return;await new Promise(r=>setTimeout(r,20));}
 expect(getTask(id)?.status).toBe(status);
}
it('audits every real MCP tool annotation and catalog; resources/prompts work',async()=>{
 const c=await client();const tools=(await c.listTools()).tools;
 expect(tools.map(t=>t.name).sort()).toEqual([...MCP_SURFACE_TOOLS].sort());
 for(const t of tools) for(const h of ['readOnlyHint','openWorldHint','destructiveHint']) expect(typeof t.annotations?.[h]).toBe('boolean');
 expect((await c.listResources()).resources.map(r=>r.uri)).toContain('hub://roster');
 const roster=await c.readResource({uri:'hub://roster'});expect(JSON.parse(String(roster.contents[0].text))).toHaveLength(93);
 expect((await c.getPrompt({name:'route_mission',arguments:{task:'مراجعة أمان'}})).messages).toHaveLength(1);
});
it('executes the five positive and three negative store cases through MCP',async()=>{
 const c=await client();
 expect(text(await c.callTool({name:'hub_health',arguments:{}})).agents).toBe(93);
 expect(text(await c.callTool({name:'hub_agent_browse',arguments:{query:'SEO'}})).hits.some((h:any)=>h.id==='tool13-seo-audit')).toBe(true);
 expect(text(await c.callTool({name:'hub_boss_route',arguments:{task:'Security review login.py'}})).primary).toBe('ecc-security-reviewer');
 expect(text(await c.callTool({name:'seo_audit_html',arguments:{html:'<html lang="en"><title>Test</title><h1>Page</h1></html>'}})).ok).toBe(true);
 expect(text(await c.callTool({name:'clean_leads',arguments:{text:'a@example.com a@example.com'}})).count).toBe(1);
 expect((await c.callTool({name:'run_agent',arguments:{agent_id:'unknown',task:'x',workspace_id:'ok',idempotency_key:'case'}})).isError).toBe(true);
 expect((await c.callTool({name:'task_status',arguments:{task_id:'missing'}})).isError).toBe(true);
 vi.stubEnv('HAH_MODEL_PROVIDER','freellmapi');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('unavailable')));
 expect((await c.callTool({name:'hub_freellmapi_chat',arguments:{prompt:'hello'}})).isError).toBe(true);
});
it('all 92 profiles load, with a smoke mission from each pack',async()=>{
 for(const a of listAgents()) expect(loadRoleInstructions(a.id)).toContain(a.id);
 startQueue();
 for(const agent_id of ['hub-boss','desk-lead-cleaner','forge-agent-miner','tool13-seo-audit']) {
   const {task_id}=enqueueAgentTask({agent_id,task:'test offline mission',workspace_id:'smoke',idempotency_key:agent_id});
   await until(task_id,'completed');
   expect(getTask(task_id)?.evidence).toContain('heuristic');
 }
 const reviewer=enqueueAgentTask({agent_id:'ecc-security-reviewer',task:'test offline mission',workspace_id:'smoke',idempotency_key:'ecc-security-reviewer'});
 await until(reviewer.task_id,'failed');
 const reviewerTask=getTask(reviewer.task_id)!;
 expect(reviewerTask.state).toBe('BLOCKED');
 expect(reviewerTask.status).not.toBe('completed');
 expect(reviewerTask.error).toMatch(/HAH_MODEL_URL/);
});
it('rejects traversal, absolute paths and symlink escapes including artifacts',async()=>{
 const root=ensureWorkspace('safe');
 for(const p of ['../outside','/etc/passwd','C:\\file','a/../../x','bad\0path']) expect(()=>resolveSafePath(root,p)).toThrow();
 fs.symlinkSync(base,path.join(root,'escape'));
 expect(()=>resolveSafePath(root,'escape/file')).toThrow();
 fs.symlinkSync(base,path.join(root,'artifacts'));
 const result=await runTool(['workspace_write'],root,{name:'workspace_write',arguments:{path:'artifacts/secret',content:'data'}});
 expect(result.ok).toBe(false);expect(fs.existsSync(path.join(base,'secret'))).toBe(false);
 expect(()=>ensureWorkspace('../bad')).toThrow();
});
it('redacts known path secrets and keys from storage artifacts and tool output',async()=>{
 vi.stubEnv('HUB_SECRET','test-capability-which-must-never-appear');
 vi.stubEnv('HAH_MODEL_API_KEY','test-only-model-credential');
 const raw='https://hub.imdifferent01.com/test-capability-which-must-never-appear/mcp Bearer abcdef token=credential';
 const clean=redactSecrets(raw);expect(clean).not.toContain('test-capability');expect(clean).not.toContain('abcdef');
 expect(JSON.parse(redactSecrets({password:'synthetic-password',nested:{api_key:'synthetic-key'}})).nested.api_key).toBe('[REDACTED]');
 const root=ensureWorkspace('safe');
 await runTool(['workspace_write'],root,{name:'workspace_write',arguments:{path:'out.txt',content:raw}});
 expect(fs.readFileSync(path.join(root,'out.txt'),'utf8')).not.toContain('test-capability');
});
it('routes Arabic and decomposes compound work by specialist',()=>{
 expect(planWithBoss('مراجعة أمان التطبيق').primary).toBe('ecc-security-reviewer');
 const plan=planWithBoss('تنظيف البريد ثم تحسين محركات البحث ثم مراجعة أمان');
 expect(plan.decomposition.map(d=>d.agent_id)).toEqual(['desk-lead-cleaner','tool13-seo-audit','ecc-security-reviewer']);
});
it('local Tools13 alternatives do not execute remote workflows',()=>{
 expect(validateWorkflow({nodes:[{name:'A',type:'httpRequest'},{name:'A',type:'code'}],connections:{bad:[]}}).ok).toBe(false);
 expect(validateWorkflow({nodes:[],active:true}).executed).toBe(false);
 expect(compactContext('info\ninfo\nFATAL: bad',1).text).toContain('FATAL');
 expect(extractLinks('<a href="javascript:bad">bad</a><a href="https://example.com/">ok</a>').links).toEqual(['https://example.com/']);
 expect(tools13Capabilities()).toHaveLength(13);
 expect(tools13Capabilities().find(t=>t.id==='kimi-k3')?.status).toBe('BLOCKED');
});
it('HTTP rejects missing auth and lookalike origins, serves challenge, handles repeated MCP',async()=>{
 vi.stubEnv('HAH_OPENAI_APPS_CHALLENGE','test-domain-challenge');
 listener=createHttpApp().listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{listener!.once('listening',resolve);listener!.once('error',reject);});
 const address=listener.address() as {port:number};const url=`http://127.0.0.1:${address.port}`;
 expect((await fetch(url+'/mcp',{method:'POST'})).status).toBe(401);
 expect(await (await fetch(url+'/.well-known/openai-apps-challenge')).text()).toBe('test-domain-challenge');
 const headers={'Authorization':`Bearer ${process.env.HAH_AUTH_TOKEN}`,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
 expect((await fetch(url+'/mcp',{method:'POST',headers:{...headers,Origin:'http://localhost.evil.com'},body:'{}'})).status).toBe(403);
 for(let id=1;id<=3;id++) {
  const res=await fetch(url+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
  expect(res.status).toBe(200);expect((await res.json()).result.serverInfo.name).toBe('hamza-agent-hub');
 }
 expect((await fetch(url+'/mcp',{headers})).status).toBe(405);
});
it('HTTP rate limit returns retry hints',async()=>{
 vi.stubEnv('HAH_RATE_LIMIT','1');listener=createHttpApp().listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{listener!.once('listening',resolve);listener!.once('error',reject);});
 const url=`http://127.0.0.1:${(listener.address() as {port:number}).port}/mcp`;
 const headers={'Authorization':`Bearer ${process.env.HAH_AUTH_TOKEN}`};
 await fetch(url,{headers});const limited=await fetch(url,{headers});expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('60');
});
it('idempotency, queued cancellation and restart recovery preserve terminal states',async()=>{
 const input={agent_id:'ecc-planner',task:'plan',workspace_id:'test',idempotency_key:'same-key'};
 const first=enqueueAgentTask(input), reused=enqueueAgentTask(input);expect(reused.task_id).toBe(first.task_id);expect(reused.reused).toBe(true);
 cancelTask(first.task_id);updateTask(first.task_id,{status:'completed'});expect(getTask(first.task_id)?.status).toBe('cancelled');
 const other=enqueueAgentTask({...input,idempotency_key:'other-key'});expect(claimNextQueued()?.id).toBe(other.task_id);
 updateTask(other.task_id,{attempts:3});requeueInterrupted();expect(getTask(other.task_id)?.status).toBe('dead_letter');
});
it('running cancellation cannot be overwritten by a late model rejection',async()=>{
 vi.stubEnv('HAH_MODEL_URL','http://127.0.0.1:9999/v1');
 let rejectModel:(e:Error)=>void=()=>{};
 vi.stubGlobal('fetch',vi.fn(()=>new Promise((_r,reject)=>{rejectModel=reject;})));
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'ecc-planner',task:'plan',workspace_id:'test',idempotency_key:'cancel-race'});
 await until(task_id,'running');cancelTask(task_id);rejectModel(new Error('late failure'));
 await new Promise(r=>setTimeout(r,20));expect(getTask(task_id)?.status).toBe('cancelled');
});
it('retries transient model failures, then dead-letters bounded attempts',async()=>{
 vi.stubEnv('HAH_MODEL_URL','http://127.0.0.1:9999/v1');vi.stubEnv('HAH_MAX_ATTEMPTS','2');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'ecc-planner',task:'plan',workspace_id:'test',idempotency_key:'retry-dead'});
 await until(task_id,'dead_letter');expect(getTask(task_id)?.attempts).toBe(2);
});
it('model requests carry cancellation and usable argument schemas',async()=>{
 vi.stubEnv('HAH_MODEL_URL','http://127.0.0.1:9999/v1');const ac=new AbortController();
 vi.stubGlobal('fetch',vi.fn(async (_url,init)=>{
   const body=JSON.parse(init.body);expect(body.tools[0].function.parameters.properties.path.type).toBe('string');
   expect(init.signal).toBeInstanceOf(AbortSignal);
   return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}));
 }));
 expect((await callModel({system:'test',messages:[],tools:['workspace_read'],agentId:'ecc-planner',signal:ac.signal})).content).toBe('ok');
});
it('boss dispatch creates durable specialist tasks with completion evidence',async()=>{
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'hub-boss',task:'Clean leads then SEO audit',workspace_id:'delegation',idempotency_key:'delegate-proof'});
 await until(task_id,'completed');
 const log=JSON.parse(getTask(task_id)!.tool_log!);
 const dispatched=log.filter((entry:any)=>entry.tool==='dispatch_agent');expect(dispatched).toHaveLength(2);
 for(const entry of dispatched){const child=JSON.parse(entry.output);await until(child.child_task_id,'completed');expect(getTask(child.child_task_id)?.agent_id).toBe(child.agent_id);}
});
it('task deadline aborts in-flight model calls and releases queue slots',async()=>{
 vi.stubEnv('HAH_MODEL_URL','http://127.0.0.1:9999/v1');vi.stubEnv('HAH_TASK_TIMEOUT_MS','30');
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
  init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
 })));
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'ecc-planner',task:'plan',workspace_id:'timeout',idempotency_key:'timeout-proof'});
 await until(task_id,'dead_letter');expect(getTask(task_id)?.attempts).toBe(1);
});
it('auto-detects a healthy local free gateway and falls back honestly after failure',async()=>{
 vi.stubEnv('HAH_AUTO_FREELLMAPI','1');
 const mocked=vi.fn(async(url:string)=>{
   if(url.endsWith('/models'))return Response.json({data:[{id:'auto'}]});
   return Response.json({choices:[{message:{content:'live free gateway'}}]});
 });vi.stubGlobal('fetch',mocked);
 const options={system:'test',messages:[{role:'user' as const,content:'hello'}],tools:[],agentId:'ecc-planner'};
 expect((await callModel(options)).provider).toBe('freellmapi');
 mocked.mockRejectedValue(new Error('free gateway unavailable'));
 const fallback=await callModel(options);expect(fallback.provider).toBe('heuristic');expect(fallback.content).toContain('requires a live model');
});

// Contract change: a mission whose runtime is unavailable used to land on the
// legacy status `completed` carrying a BLOCKED payload, which is the
// false-completion bug. BLOCKED now maps to the legacy status `failed` and
// records the explicit BLOCKED state, so no consumer reads it as success.
it('unsupported Tools13 missions report BLOCKED instead of fabricated completion',async()=>{
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'tool13-kimi-k3',task:'infer this prompt',workspace_id:'blocked',idempotency_key:'blocked-proof'});
 await until(task_id,'failed');
 const task=getTask(task_id)!;
 expect(task.state).toBe('BLOCKED');
 expect(task.verified).toBe(0);
 expect(JSON.parse(task.output!).status).toBe('BLOCKED');
});

it('graceful shutdown preserves interrupted work for restart',async()=>{
 vi.stubEnv('HAH_MODEL_URL','http://127.0.0.1:9999/v1');
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
  init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
 })));
 startQueue();const {task_id}=enqueueAgentTask({agent_id:'ecc-planner',task:'plan',workspace_id:'restart',idempotency_key:'shutdown-proof'});
 await until(task_id,'running');await stopQueue();expect(getTask(task_id)?.status).toBe('queued');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{message:{content:'resumed'}}]})));
 startQueue();await until(task_id,'completed');expect(getTask(task_id)?.attempts).toBe(2);
});
it('queue capacity rejects new work but still reuses idempotent requests',()=>{
 vi.stubEnv('HAH_MAX_PENDING','1');const input={agent_id:'ecc-planner',task:'plan',workspace_id:'capacity',idempotency_key:'capacity-proof'};
 const first=enqueueAgentTask(input);expect(enqueueAgentTask(input).task_id).toBe(first.task_id);
 expect(()=>enqueueAgentTask({...input,idempotency_key:'another'})).toThrow('queue full');
 expect(()=>enqueueAgentTask({...input,task:'different'})).toThrow('idempotency');
});
