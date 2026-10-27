// Hamza Agent Hub MCP core: stateless JSON-RPC over MCP streamable HTTP.
// Works in Cloudflare Workers and Node 18+. Model calls use free providers only.
import { completeFree, listProviders, secretNames } from './providers.js';

const SERVER = { name: 'hamza-agent-hub', title: 'Hamza Agent Hub', version: '1.1.0' };
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const RUN = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false };

function toolsFor(catalog) {
  const n = catalog.count;
  const c = catalog.categories.length;
  return [
    { name: 'list_categories', title: 'List agent categories',
      description: `Use this to show the ${c} categories of the ${n} expert agents and how many agents are in each.`,
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
    { name: 'list_model_providers', title: 'List free model providers',
      description: 'List the free model providers run_agent_prompt can call, the Worker secret name for each, whether it is configured, and the free models allowed. Never returns key values. Paid providers are not supported.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
    { name: 'run_agent_prompt', title: 'Run an agent on a task',
      description: 'Use this when the user gives a concrete task for a specific agent. Composes that agent\'s instructions with the task. If a free-model secret is configured, calls that model and returns the reply. If none is configured, returns the prompt and the secret names to set. Optional provider and model must be free; paid model ids are rejected and no paid fallback is attempted.',
      inputSchema: { type: 'object', properties: {
        id: { type: 'string', description: 'Agent id' },
        task: { type: 'string', description: 'The user task to perform in that role' },
        provider: { type: 'string', description: 'Optional free provider: groq, gemini, cloudflare, openrouter, huggingface' },
        model: { type: 'string', description: 'Optional free model id from list_model_providers' },
        max_tokens: { type: 'integer', minimum: 16, maximum: 512, description: 'Optional cap (default 384, max 512)' } },
        required: ['id', 'task'], additionalProperties: false }, annotations: RUN },
  ];
}

function rolePreface(a) {
  const bits = ['Adopt this expert role for the rest of the task. Tool or CLI names inside these instructions may not exist in ChatGPT; skip those parts and do the reasoning yourself.'];
  if (a.category === 'trading') bits.push('This role is a prompt, not a broker. Do not place live trades, predict a future price, or give personalized financial advice.');
  if (a.id.includes('payment')) bits.push('This role is a prompt, not a payment processor. Do not move money, charge a card, or authorize a real payment.');
  if (a.id === 'browser-agent' || a.id === 'hub-web-browser') bits.push('This server cannot browse the web. Do not collect passwords, session tokens, or API keys.');
  return bits.join(' ');
}

export function createMcp(catalog, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const byId = new Map(catalog.agents.map(a => [a.id.toLowerCase(), a]));
  const TOOLS = toolsFor(catalog);
  const brief = a => ({ id: a.id, category: a.category, description: a.description });
  const find = id => byId.get(String(id || '').trim().toLowerCase());
  const suggest = id => {
    const q = String(id || '').toLowerCase();
    return catalog.agents.filter(a => a.id.includes(q) || q.includes(a.id)).slice(0, 5).map(a => a.id);
  };
  const ok = (text, structured) => ({ content: [{ type: 'text', text }], structuredContent: structured, isError: false });
  const err = (text, structured) => ({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}), isError: true });

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
    return scored.slice(0, Math.min(Math.max(parseInt(limit, 10) || 8, 1), 25)).map(([s, a]) => ({ ...brief(a), score: s }));
  }

  function promptFor(a, task) {
    return `# System role: ${a.id}\n${rolePreface(a)}\n\n${a.instructions}\n\n---\n# Task\n${task}\n\nWork as ${a.id}. Ask for any missing input, and say what you could not verify.`;
  }

  function secretNotice(secrets) {
    return `No free model provider is configured, so this is the prompt only (no external model was called).\nSet one of these Worker secrets or env vars: ${secrets.join(', ')}.\nCLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set together. A Workers AI binding named AI also enables Cloudflare's free allocation.\nPaid providers (OpenAI, Anthropic, and others) are disabled.`;
  }

  async function callTool(name, args = {}, env = {}) {
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
        const text = `ROLE: ${a.id} (${a.categoryLabel})\n${rolePreface(a)}\n\n${a.instructions}`;
        return ok(text, { id: a.id, category: a.category, description: a.description, source: a.source, truncated: a.truncated });
      }
      case 'list_model_providers': {
        const listed = listProviders(env);
        const lines = listed.providers.map(p => `${p.id}: ${p.configured ? 'configured' : 'not configured'} — set ${p.secrets.join(' + ')} — default ${p.defaultModel}`);
        const text = lines.join('\n') + `\nConfigured order: ${listed.defaultOrder.join(', ') || '(none)'}\nSecrets still unset: ${listed.secretsToSet.join(', ') || '(none)'}\nPaid providers are disabled.`;
        return ok(text, listed);
      }
      case 'run_agent_prompt': {
        const a = find(args.id);
        if (!a) return err(`No agent "${args.id}". Use search_agents.`);
        if (!args.task || typeof args.task !== 'string') return err('task is required');
        const task = args.task.slice(0, 8000);
        const prompt = promptFor(a, task);
        const messages = [
          { role: 'system', content: `${rolePreface(a)}\n\n${a.instructions.slice(0, 12000)}` },
          { role: 'user', content: task.slice(0, 4000) },
        ];
        const ran = await completeFree({
          env, fetchImpl, provider: args.provider, model: args.model, maxTokens: args.max_tokens, messages,
        });
        const base = { id: a.id, task, prompt, mode: ran.mode, provider: ran.provider, model: ran.model, attempts: ran.attempts, secretsToSet: ran.secretsToSet };
        if (ran.mode === 'blocked') return err(`${ran.error}\n\n${prompt}`, base);
        if (ran.mode === 'prompt-only') return ok(`${secretNotice(ran.secretsToSet)}\n\n${prompt}`, base);
        if (ran.mode === 'completion') {
          const text = `Provider: ${ran.provider}\nModel: ${ran.model}\n\n${ran.text}`;
          return ok(text, { ...base, output: ran.text });
        }
        const why = (ran.attempts || []).map(x => `- ${x.provider}/${x.model}: ${x.error || 'failed'}`).join('\n');
        return ok(`Every configured free provider failed, so this is the prompt only (no paid fallback).\n${why}\nSecrets still unset: ${(ran.secretsToSet || []).join(', ') || '(none)'}\n\n${prompt}`, base);
      }
      default: return null;
    }
  }

  async function handleMessage(msg, env) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
      return { jsonrpc: '2.0', id: msg && 'id' in msg ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
    const isNote = !Object.prototype.hasOwnProperty.call(msg, 'id');
    const reply = result => isNote ? null : { jsonrpc: '2.0', id: msg.id, result };
    const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };
    const p = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
    switch (msg.method) {
      case 'initialize': {
        const requested = p.protocolVersion;
        const protocolVersion = VERSIONS.includes(requested) ? requested : VERSIONS[0];
        return reply({ protocolVersion,
          capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
          instructions: `Hamza Agent Hub: ${catalog.count} expert agent roles in ${catalog.categories.length} categories. Use search_agents to pick a role, then get_agent and follow its instructions. run_agent_prompt calls a free model when a provider secret is set; otherwise it returns the prompt and the secret name to set.` });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        if (p.arguments != null && (typeof p.arguments !== 'object' || Array.isArray(p.arguments)))
          return fail(-32602, 'arguments must be an object');
        const r = await callTool(p.name, p.arguments || {}, env);
        return r ? reply(r) : fail(-32602, `Unknown tool: ${p.name}`);
      }
      case 'resources/list': return reply({ resources: [] });
      case 'prompts/list': return reply({ prompts: [] });
      default:
        if (msg.method.startsWith('notifications/')) return null;
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  function healthBody(env) {
    const listed = listProviders(env || {});
    return {
      ok: true, service: 'hamza-agent-hub-mcp', agents: catalog.count, categories: catalog.categories.length,
      providers: listed.providers.map(p => ({ id: p.id, configured: p.configured })),
    };
  }

  async function handleHttp(request, env = {}) {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version' };
    const json = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body),
      { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (url.pathname === '/healthz' || url.pathname === '/health') return json(200, healthBody(env));
      if (url.pathname === '/' && request.method === 'GET')
        return new Response(`Hamza Agent Hub MCP server: ${catalog.count} agents. MCP endpoint: ${url.origin}/mcp (streamable HTTP, no auth).\nSource: https://github.com/hamzachallenge3-dev/hamza-agent-hub-252/tree/main/chatgpt-app\n`,
          { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
      if (url.pathname !== '/mcp') return json(404, { error: 'not found' });
      if (request.method === 'GET' || request.method === 'DELETE') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } });
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } });
      const ctype = request.headers.get('content-type') || '';
      if (ctype && !ctype.toLowerCase().includes('application/json'))
        return json(415, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Content-Type must be application/json' } });
      const raw = await request.text();
      if (raw.length > 262144) return json(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      if (Array.isArray(body) && body.length === 0)
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      const out = Array.isArray(body)
        ? (await Promise.all(body.map(m => handleMessage(m, env)))).filter(Boolean)
        : await handleMessage(body, env);
      if (out === null || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: cors });
      return json(200, out);
    } catch {
      return json(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  }
  return { handleMessage, handleHttp, callTool, TOOLS, secretNames };
}
