// Hamza Agent Hub MCP core: stateless JSON-RPC over MCP streamable HTTP.
// Read-only. No secrets, no network calls. Works in Cloudflare Workers and Node 18+.
const SERVER = { name: 'hamza-agent-hub', title: 'Hamza Agent Hub', version: '1.0.0' };
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };

const TOOLS = [
  { name: 'list_categories', title: 'List agent categories',
    description: 'Use this to show the 13 categories of the 243 expert agents and how many agents are in each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
  { name: 'search_agents', title: 'Search agents',
    description: 'Use this to find the best expert agent for a task. Searches agent ids, descriptions and instructions. Returns ids to pass to get_agent.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'What the user needs, e.g. "security review of a Node API" or "write unit tests"' },
      category: { type: 'string', description: 'Optional category id from list_categories, e.g. "security", "test", "planning"' },
      limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Max results (default 8)' } },
      required: ['query'], additionalProperties: false }, annotations: RO },
  { name: 'get_agent', title: 'Get agent instructions',
    description: 'Use this to load one agent\'s full expert instructions. After calling it, adopt that role and follow the instructions for the rest of the task.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Agent id from search_agents, e.g. "code-analyzer"' } },
      required: ['id'], additionalProperties: false }, annotations: RO },
  { name: 'run_agent_prompt', title: 'Compose agent prompt for a task',
    description: 'Use this when the user gives a concrete task for a specific agent. Returns the agent instructions combined with the task, ready to follow (or to copy into any AI chat).',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Agent id' }, task: { type: 'string', description: 'The user task to perform in that role' } },
      required: ['id', 'task'], additionalProperties: false }, annotations: RO },
];

export function createMcp(catalog) {
  const byId = new Map(catalog.agents.map(a => [a.id.toLowerCase(), a]));
  const brief = a => ({ id: a.id, category: a.category, description: a.description });
  const find = id => byId.get(String(id || '').trim().toLowerCase());
  const suggest = id => {
    const q = String(id || '').toLowerCase();
    return catalog.agents.filter(a => a.id.includes(q) || q.includes(a.id)).slice(0, 5).map(a => a.id);
  };
  const ok = (text, structured) => ({ content: [{ type: 'text', text }], structuredContent: structured, isError: false });
  const err = text => ({ content: [{ type: 'text', text }], isError: true });

  const STOP = new Set(['a','an','the','to','of','for','and','or','in','on','my','me','i','is','it','with','write','make','do','help','need','want','please','some','this','that','agent','expert']);
  const stem = w => w.replace(/(ing|ers|er|ed|es|s)$/, '') || w;
  const words = t => String(t || '').toLowerCase().replace(/source: \S+|tested: \S+/g, ' ')
    .split(/[^a-z0-9\u0600-\u06ff]+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
  const index = catalog.agents.map(a => {
    const body = new Map();
    for (const w of words(a.instructions.slice(0, 6000))) body.set(w, (body.get(w) || 0) + 1);
    return { a, id: new Set(words(a.id.replace(/-/g, ' '))), desc: new Set(words(a.description)), cat: new Set(words(a.category + ' ' + a.categoryLabel)), body };
  });
  function search(query, category, limit) {
    const terms = [...new Set(words(query))];
    let pool = index;
    if (category) pool = pool.filter(x => x.a.category === String(category).toLowerCase());
    const scored = pool.map(x => {
      let s = 0;
      for (const t of terms) {
        if (x.id.has(t)) s += 6; if (x.desc.has(t)) s += 3; if (x.cat.has(t)) s += 2;
        const n = x.body.get(t) || 0; if (n) s += Math.min(3, 1 + Math.log2(n));
      }
      return [Math.round(s * 10) / 10, x.a];
    }).filter(([s]) => s > 0 || !terms.length).sort((p, q) => q[0] - p[0]);
    return scored.slice(0, Math.min(Math.max(parseInt(limit) || 8, 1), 25)).map(([s, a]) => ({ ...brief(a), score: s }));
  }

  function callTool(name, args = {}) {
    switch (name) {
      case 'list_categories':
        return ok(catalog.categories.map(c => `${c.id}: ${c.label} (${c.count})`).join('\n') + `\nTotal: ${catalog.count} agents`,
          { total: catalog.count, categories: catalog.categories });
      case 'search_agents': {
        if (!args.query || typeof args.query !== 'string') return err('query is required');
        if (args.category && !catalog.categories.some(c => c.id === String(args.category).toLowerCase()))
          return err(`Unknown category "${args.category}". Valid: ${catalog.categories.map(c => c.id).join(', ')}`);
        const results = search(args.query, args.category, args.limit);
        const text = results.length ? results.map(r => `${r.id} [${r.category}] - ${r.description}`).join('\n') + '\nNext: call get_agent with the best id.'
          : 'No matching agents. Try broader words or list_categories.';
        return ok(text, { query: args.query, results });
      }
      case 'get_agent': {
        const a = find(args.id);
        if (!a) return err(`No agent "${args.id}".` + (suggest(args.id).length ? ` Did you mean: ${suggest(args.id).join(', ')}?` : ' Use search_agents.'));
        const text = `ROLE: ${a.id} (${a.categoryLabel})\nAdopt this expert role for the rest of the task. Tool or CLI names inside these instructions may not exist in ChatGPT; skip those parts and do the reasoning yourself.\n\n${a.instructions}`;
        return ok(text, { id: a.id, category: a.category, description: a.description, source: a.source, truncated: a.truncated });
      }
      case 'run_agent_prompt': {
        const a = find(args.id);
        if (!a) return err(`No agent "${args.id}". Use search_agents.`);
        if (!args.task || typeof args.task !== 'string') return err('task is required');
        const prompt = `# System role: ${a.id}\n${a.instructions}\n\n---\n# Task\n${args.task.slice(0, 8000)}\n\nWork as ${a.id}. Ask for any missing input, and say what you could not verify.`;
        return ok(prompt, { id: a.id, task: args.task.slice(0, 8000) });
      }
      default: return null;
    }
  }

  function handleMessage(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
      return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
    const isNote = msg.id === undefined || msg.id === null;
    const reply = result => isNote ? null : { jsonrpc: '2.0', id: msg.id, result };
    const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };
    const p = msg.params || {};
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[1],
          capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
          instructions: 'Hamza Agent Hub: 243 expert agent roles. Use search_agents to pick a role, then get_agent and follow its instructions.' });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const r = callTool(p.name, p.arguments || {});
        return r ? reply(r) : fail(-32602, `Unknown tool: ${p.name}`);
      }
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: [] });
      default:
        if (msg.method.startsWith('notifications/')) return null;
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  // Generic HTTP handler (Fetch API Request -> Response)
  async function handleHttp(request) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version' };
    const json = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body),
      { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/healthz') return json(200, { ok: true, service: 'hamza-agent-hub-mcp', agents: catalog.count });
    if (url.pathname === '/' && request.method === 'GET')
      return new Response(`Hamza Agent Hub MCP server: ${catalog.count} agents. MCP endpoint: ${url.origin}/mcp (streamable HTTP, no auth).\nSource: https://github.com/hamzachallenge3-dev/hamza-agent-hub-252/tree/main/chatgpt-app\n`,
        { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    if (url.pathname !== '/mcp') return json(404, { error: 'not found' });
    if (request.method === 'GET' || request.method === 'DELETE') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } });
    const raw = await request.text();
    if (raw.length > 262144) return json(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const out = Array.isArray(body) ? body.map(handleMessage).filter(Boolean) : handleMessage(body);
    if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: cors });
    return json(200, out);
  }
  return { handleMessage, handleHttp, callTool, TOOLS };
}
