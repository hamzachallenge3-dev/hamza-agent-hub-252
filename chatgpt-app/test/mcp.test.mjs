import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMcp } from '../src/core.js';
import { isExplicitlyPaid, modelAllowed } from '../src/providers.js';

const catalog = JSON.parse(readFileSync(new URL('../data/agents.json', import.meta.url), 'utf8'));
const RESTORED = ['agentic-payments', 'backtest-engineer', 'browser-agent', 'data-engineer', 'hub-web-browser', 'market-analyst', 'risk-analyst', 'trading-predictor', 'trading-strategist'];

function fixture() {
  return {
    count: 2,
    categories: [
      { id: 'review', label: 'Code review', count: 1 },
      { id: 'trading', label: 'Trading', count: 1 },
    ],
    agents: [
      { id: 'code-analyzer', category: 'review', categoryLabel: 'Code review', description: 'Reviews code for bugs and security', instructions: 'Review the code carefully and list defects.', source: 'x', truncated: false },
      { id: 'trading-predictor', category: 'trading', categoryLabel: 'Trading', description: 'Explains backtests', instructions: 'Do not predict a price.', source: 'y', truncated: false },
      { id: 'agentic-payments', category: 'review', categoryLabel: 'Code review', description: 'Payment mandates', instructions: 'Explain a mandate.', source: 'z', truncated: false },
    ],
  };
}

function mcpOf(cat = fixture(), fetchImpl) {
  return createMcp({ ...cat, count: cat.agents.length, categories: cat.categories }, fetchImpl ? { fetch: fetchImpl } : {});
}

async function rpc(mcp, method, params, { id = 1, env = {}, path = '/mcp' } = {}) {
  const res = await mcp.handleHttp(new Request('http://hub.local' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  }), env);
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null, headers: res.headers };
}

function chat(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('catalog restores 252 agents and fixes descriptions', () => {
  assert.equal(catalog.count, 252);
  assert.equal(catalog.agents.length, 252);
  assert.equal(catalog.categories.length, 14);
  assert.equal(catalog.categories.reduce((n, c) => n + c.count, 0), 252);
  const ids = new Set(catalog.agents.map(a => a.id));
  for (const id of RESTORED) assert.equal(ids.has(id), true, id);
  assert.equal(catalog.agents.find(a => a.id === 'deep-researcher').category, 'research');
  assert.equal(catalog.agents.find(a => a.id === 'ecc-marketing-agent').category, 'general');
  assert.equal(catalog.agents.find(a => a.id === 'tool13-seo-audit').category, 'general');
  assert.equal(catalog.agents.find(a => a.id === 'tool13-seo-audit').description.includes('okara'), false);
  assert.equal(catalog.agents.some(a => !a.description || a.description === '|' || a.description === '>'), false);
  assert.match(catalog.agents.find(a => a.id === 'agentic-payments').description, /payment/i);
  const trading = catalog.categories.find(c => c.id === 'trading');
  assert.equal(trading.count, 6);
});

test('initialize, tools/list, and the four catalog tools', async () => {
  const mcp = createMcp(catalog);
  const init = await rpc(mcp, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'hamza-agent-hub');
  assert.match(init.body.result.instructions, /252/);
  const list = await rpc(mcp, 'tools/list', {});
  assert.deepEqual(list.body.result.tools.map(t => t.name), ['list_categories', 'search_agents', 'get_agent', 'list_model_providers', 'run_agent_prompt']);
  const run = list.body.result.tools.find(t => t.name === 'run_agent_prompt');
  assert.equal(run.annotations.openWorldHint, true);
  assert.equal(run.annotations.destructiveHint, false);
  const cats = await rpc(mcp, 'tools/call', { name: 'list_categories', arguments: {} });
  assert.equal(cats.body.result.isError, false);
  assert.equal(cats.body.result.structuredContent.total, 252);
  const search = await rpc(mcp, 'tools/call', { name: 'search_agents', arguments: { query: 'security audit', limit: 3 } });
  assert.equal(search.body.result.structuredContent.results.length, 3);
  const id = search.body.result.structuredContent.results[0].id;
  const got = await rpc(mcp, 'tools/call', { name: 'get_agent', arguments: { id } });
  assert.match(got.body.result.content[0].text, new RegExp(id));
  const missing = await rpc(mcp, 'tools/call', { name: 'get_agent', arguments: { id: 'nope' } });
  assert.equal(missing.body.result.isError, true);
  const badCat = await rpc(mcp, 'tools/call', { name: 'search_agents', arguments: { query: 'tests', category: 'nope' } });
  assert.equal(badCat.body.result.isError, true);
});

test('trading and payment roles carry a prompt-only preface', async () => {
  const mcp = createMcp(catalog);
  const trade = await rpc(mcp, 'tools/call', { name: 'get_agent', arguments: { id: 'trading-predictor' } });
  assert.match(trade.body.result.content[0].text, /not a broker/);
  const pay = await rpc(mcp, 'tools/call', { name: 'get_agent', arguments: { id: 'agentic-payments' } });
  assert.match(pay.body.result.content[0].text, /not a payment processor/);
});

test('protocol edges: notifications, null id, parse errors, cors, health', async () => {
  const mcp = mcpOf();
  const note = await mcp.handleHttp(new Request('http://hub.local/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }));
  assert.equal(note.status, 202);
  const nullId = await rpc(mcp, 'ping', {}, { id: null });
  assert.equal(nullId.status, 200);
  assert.equal(nullId.body.id, null);
  const bad = await mcp.handleHttp(new Request('http://hub.local/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const unknown = await rpc(mcp, 'tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknown.body.error.code, -32602);
  const args = await rpc(mcp, 'tools/call', { name: 'list_categories', arguments: ['bad'] });
  assert.equal(args.body.error.code, -32602);
  const typed = await mcp.handleHttp(new Request('http://hub.local/mcp', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  }));
  assert.equal(typed.status, 415);
  const opt = await mcp.handleHttp(new Request('http://hub.local/mcp', { method: 'OPTIONS' }));
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
  for (const path of ['/health', '/healthz']) {
    const health = await mcp.handleHttp(new Request('http://hub.local' + path));
    const body = await health.json();
    assert.equal(body.agents, 3);
    assert.equal(body.ok, true);
    assert.equal(JSON.stringify(body).includes('gsk_'), false);
  }
  const old = await rpc(mcp, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal(old.body.result.protocolVersion, '2025-11-25');
});

test('without a key, run_agent_prompt returns the prompt and secret names', async () => {
  let called = 0;
  const mcp = mcpOf(fixture(), async () => { called += 1; throw new Error('should not fetch'); });
  const res = await rpc(mcp, 'tools/call', { name: 'run_agent_prompt', arguments: { id: 'code-analyzer', task: 'Review add()' } });
  assert.equal(res.body.result.isError, false);
  assert.equal(res.body.result.structuredContent.mode, 'prompt-only');
  assert.equal(called, 0);
  assert.match(res.body.result.content[0].text, /GROQ_API_KEY/);
  assert.match(res.body.result.content[0].text, /GEMINI_API_KEY/);
  assert.match(res.body.result.content[0].text, /OPENROUTER_API_KEY/);
  assert.match(res.body.result.content[0].text, /HF_TOKEN/);
  assert.match(res.body.result.content[0].text, /CLOUDFLARE_API_TOKEN/);
  assert.match(res.body.result.content[0].text, /Review add\(\)/);
});

test('configured Groq call returns model text and hides the key', async () => {
  const key = 'gsk_test_secret_value_should_not_leak';
  const seen = [];
  const mcp = mcpOf(fixture(), async (url, init) => {
    seen.push(String(url));
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    return chat('pong from groq');
  });
  const res = await rpc(mcp, 'tools/call', {
    name: 'run_agent_prompt', arguments: { id: 'code-analyzer', task: 'Say pong' },
  }, { env: { GROQ_API_KEY: key } });
  assert.equal(res.body.result.isError, false);
  assert.equal(res.body.result.structuredContent.mode, 'completion');
  assert.equal(res.body.result.structuredContent.provider, 'groq');
  assert.equal(res.body.result.structuredContent.model, 'qwen/qwen3.8-27b');
  assert.match(res.body.result.content[0].text, /pong from groq/);
  assert.equal(JSON.stringify(res.body).includes(key), false);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /api\.groq\.com/);
});

test('rate limit falls back to the next configured free provider', async () => {
  const calls = [];
  const mcp = mcpOf(fixture(), async (url) => {
    calls.push(String(url));
    if (String(url).includes('groq')) return new Response(JSON.stringify({ error: { message: 'rate limit gsk_test_secret_value_should_not_leak' } }), { status: 429 });
    return chat('pong from gemini');
  });
  const res = await rpc(mcp, 'tools/call', {
    name: 'run_agent_prompt', arguments: { id: 'code-analyzer', task: 'Say pong' },
  }, { env: { GROQ_API_KEY: 'gsk_test_secret_value_should_not_leak', GEMINI_API_KEY: 'AIzaSyDUMMYKEY1234567890' } });
  assert.equal(res.body.result.structuredContent.provider, 'gemini');
  assert.match(res.body.result.content[0].text, /pong from gemini/);
  assert.equal(calls.some(u => u.includes('groq')), true);
  assert.equal(calls.some(u => u.includes('generativelanguage')), true);
  assert.equal(JSON.stringify(res.body).includes('gsk_test_secret_value_should_not_leak'), false);
  assert.equal(JSON.stringify(res.body).includes('AIzaSyDUMMYKEY1234567890'), false);
});

test('paid providers and paid model ids are hard-blocked', async () => {
  let called = 0;
  const mcp = mcpOf(fixture(), async () => { called += 1; return chat('nope'); });
  const env = { GROQ_API_KEY: 'gsk_test_secret_value_should_not_leak' };
  for (const args of [
    { id: 'code-analyzer', task: 'x', provider: 'openai', model: 'gpt-4o' },
    { id: 'code-analyzer', task: 'x', provider: 'anthropic', model: 'claude-3-5-sonnet' },
    { id: 'code-analyzer', task: 'x', model: 'gpt-4o' },
    { id: 'code-analyzer', task: 'x', provider: 'openrouter', model: 'openai/gpt-4o' },
    { id: 'code-analyzer', task: 'x', provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
  ]) {
    const res = await rpc(mcp, 'tools/call', { name: 'run_agent_prompt', arguments: args }, { env });
    assert.equal(res.body.result.isError, true, JSON.stringify(args));
    assert.equal(res.body.result.structuredContent.mode, 'blocked');
  }
  assert.equal(called, 0);
  assert.equal(isExplicitlyPaid('openai/gpt-oss-20b'), false);
  assert.equal(modelAllowed('groq', 'openai/gpt-oss-20b'), true);
  assert.equal(modelAllowed('openrouter', 'meta-llama/llama-3.3-70b-instruct:free'), true);
  assert.equal(modelAllowed('openrouter', 'openai/gpt-4o-mini'), false);
  assert.equal(modelAllowed('gemini', 'gemini-2.5-pro'), false);
  assert.equal(modelAllowed('huggingface', 'org/model:together'), false);
});

test('list_model_providers reports configuration without key material', async () => {
  const key = 'gsk_test_secret_value_should_not_leak';
  const mcp = mcpOf();
  const res = await rpc(mcp, 'tools/call', { name: 'list_model_providers', arguments: {} }, { env: { GROQ_API_KEY: key } });
  const groq = res.body.result.structuredContent.providers.find(p => p.id === 'groq');
  const gemini = res.body.result.structuredContent.providers.find(p => p.id === 'gemini');
  assert.equal(groq.configured, true);
  assert.equal(gemini.configured, false);
  assert.equal(groq.free, true);
  assert.deepEqual(groq.secrets, ['GROQ_API_KEY']);
  assert.equal(JSON.stringify(res.body).includes(key), false);
  assert.equal(res.body.result.structuredContent.providers.some(p => p.id === 'openai' || p.id === 'anthropic'), false);
});

test('Workers AI binding answers without an API token', async () => {
  let fetched = 0;
  const mcp = mcpOf(fixture(), async () => { fetched += 1; throw new Error('no http'); });
  const env = { AI: { async run(model) { return { response: 'cf ' + model }; } } };
  const res = await rpc(mcp, 'tools/call', {
    name: 'run_agent_prompt', arguments: { id: 'code-analyzer', task: 'hi', provider: 'cloudflare' },
  }, { env });
  assert.equal(res.body.result.structuredContent.provider, 'cloudflare');
  assert.match(res.body.result.content[0].text, /@cf\/meta\/llama-3\.1-8b-instruct/);
  assert.equal(fetched, 0);
});
