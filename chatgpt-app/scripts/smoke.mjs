// Local smoke test: node scripts/smoke.mjs [baseUrl]
const base = process.argv[2] || 'http://127.0.0.1:8791';
const rpc = async (method, params, id = 1) => {
  const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const body = await r.json();
  if (!r.ok && !body.result && !body.error) throw new Error(`${method} HTTP ${r.status}`);
  return body;
};
const health = await fetch(base + '/health').then(r => r.json());
console.log('health', health.agents, health.categories, (health.providers || []).map(p => `${p.id}:${p.configured}`).join(','));
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log('init', init.result.serverInfo, init.result.protocolVersion);
const list = await rpc('tools/list', {}); console.log('tools', list.result.tools.map(t => t.name));
const cats = await rpc('tools/call', { name: 'list_categories', arguments: {} });
console.log(cats.result.content[0].text.split('\n').slice(-3).join('\n'));
const s = await rpc('tools/call', { name: 'search_agents', arguments: { query: 'security audit', limit: 3 } });
console.log(s.result.content[0].text);
const g = await rpc('tools/call', { name: 'get_agent', arguments: { id: s.result.structuredContent.results[0].id } });
console.log(g.result.content[0].text.slice(0, 300));
const bad = await rpc('tools/call', { name: 'get_agent', arguments: { id: 'nope' } }); console.log('missing ->', bad.result.isError, bad.result.content[0].text.slice(0, 180));
const providers = await rpc('tools/call', { name: 'list_model_providers', arguments: {} });
console.log(providers.result.content[0].text);
const run = await rpc('tools/call', { name: 'run_agent_prompt', arguments: { id: 'trading-predictor', task: 'Reply with the single word pong.', max_tokens: 64 } });
console.log('run mode', run.result.structuredContent.mode, run.result.structuredContent.provider, run.result.structuredContent.model);
console.log(run.result.content[0].text.slice(0, 500));
