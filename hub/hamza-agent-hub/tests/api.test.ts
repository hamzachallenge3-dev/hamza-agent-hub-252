/**
 * REST surface contract.
 *
 * Covers authentication, filter validation, idempotency, pagination, artifact
 * sandboxing, and the integration/model/browser readiness endpoints.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHttpApp } from '../src/mcp/http.js';
import { stopQueue } from '../src/runtime/queue.js';
import { closeDb } from '../src/storage/db.js';
import { listAgents, PACKS } from '../src/runtime/registry.js';
import { CAPABILITIES } from '../src/runtime/capabilities.js';
import { MCP_SURFACE_TOOLS } from '../src/runtime/browse.js';
import { resetQuotas, resetIntegrationBreakers } from '../src/integrations/registry.js';

const TOKEN = 'test-only-authentication-token-32';
let base: string;
let listener: ReturnType<ReturnType<typeof createHttpApp>['listen']> | undefined;
let url: string;

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-api-'));
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_DATA_DIR', path.join(base, 'data'));
  vi.stubEnv('HAH_AUTH_TOKEN', TOKEN);
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  vi.stubEnv('HAH_FREELLMAPI_URL', '');
  vi.stubEnv('HAH_AGENT_REACH', '');
  vi.stubEnv('HAH_AGENT_REACH_PUBLIC_WEB', '1');
  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
  resetQuotas();
  resetIntegrationBreakers();
  listener = createHttpApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener!.once('listening', resolve);
    listener!.once('error', reject);
  });
  url = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;
});

afterEach(async () => {
  if (listener) await new Promise<void>((resolve) => listener!.close(() => resolve()));
  listener = undefined;
  await stopQueue();
  closeDb();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}` };

async function get(route: string, headers: Record<string, string> = auth) {
  const res = await fetch(url + route, { headers });
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null, res };
}

async function post(route: string, body: unknown, headers: Record<string, string> = auth) {
  const res = await fetch(url + route, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null };
}

it('serves unauthenticated liveness and readiness probes', async () => {
  const live = await get('/health/live', {});
  expect(live.status).toBe(200);
  expect(live.body?.service).toBe('hamza-agent-hub');

  const ready = await get('/health/ready', {});
  expect(ready.status).toBe(200);
  expect(ready.body?.ready).toBe(true);
  const checks = ready.body?.checks as Record<string, { ok: boolean; readiness?: string }>;
  expect(checks.catalog.ok).toBe(true);
  // No model is configured here; readiness must say so rather than claim one.
  expect(checks.model.ok).toBe(false);
  expect(checks.model.readiness).toBe('blocked');
});

it('rejects every /v1 route without a valid bearer token', async () => {
  for (const route of ['/v1/agents', '/v1/tools', '/v1/integrations', '/v1/diagnostics']) {
    const anon = await get(route, {});
    expect(anon.status).toBe(401);
    expect((anon.body?.error as { code: string }).code).toBe('unauthorized');
  }
  const wrong = await get('/v1/agents', { Authorization: 'Bearer wrong-token-that-is-long-enough' });
  expect(wrong.status).toBe(401);
});

it('accepts its own origin but still refuses a foreign one', async () => {
  // A browser omits Origin on same-origin GETs and sends it on same-origin
  // POSTs, so checking only the configured list broke every write from the
  // Hub's own console: the default list carries no port and the served port
  // is not known in advance.
  const host = `127.0.0.1:${(listener!.address() as { port: number }).port}`;
  const same = await post('/v1/missions/plan', { task: 'Review the checkout module.' }, {
    ...auth,
    Origin: `http://${host}`,
  });
  expect(same.status).toBe(200);

  const foreign = await post('/v1/missions/plan', { task: 'Review the checkout module.' }, {
    ...auth,
    Origin: 'http://evil.example',
  });
  expect(foreign.status).toBe(403);
  expect((foreign.body?.error as { code: string }).code).toBe('forbidden_origin');
});

it('lists agents with capabilities, readiness and pagination', async () => {
  const first = await get('/v1/agents?limit=10');
  expect(first.status).toBe(200);
  expect(first.body?.total).toBe(listAgents().length);
  expect((first.body?.agents as unknown[]).length).toBe(10);
  expect(first.body?.has_more).toBe(true);

  const second = await get('/v1/agents?limit=10&offset=10');
  const firstIds = (first.body?.agents as Array<{ id: string }>).map((a) => a.id);
  const secondIds = (second.body?.agents as Array<{ id: string }>).map((a) => a.id);
  expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);

  const agent = (first.body?.agents as Array<Record<string, unknown>>)[0];
  expect(['READY', 'LIMITED', 'BLOCKED', 'UNTESTED']).toContain(agent.readiness);
  expect(Array.isArray(agent.capabilities)).toBe(true);
});

it('validates agent filters instead of silently returning everything', async () => {
  const badPack = await get('/v1/agents?pack=nope');
  expect(badPack.status).toBe(400);
  expect((badPack.body?.error as { code: string }).code).toBe('unknown_pack');
  expect((badPack.body?.error as { recovery: string }).recovery).toContain(PACKS[0].id);

  const badCapability = await get('/v1/agents?capability=teleport');
  expect(badCapability.status).toBe(400);
  expect((badCapability.body?.error as { code: string }).code).toBe('unknown_capability');

  const good = await get('/v1/agents?pack=ecc68&limit=200');
  expect(good.status).toBe(200);
  expect(good.body?.total).toBe(68);
});

it('filters agents by capability and readiness', async () => {
  const browser = await get('/v1/agents?capability=browser.automate');
  expect(browser.status).toBe(200);
  expect((browser.body?.agents as Array<{ id: string }>).map((a) => a.id)).toContain('hub-web-browser');

  const blocked = await get('/v1/agents?readiness=BLOCKED&limit=200');
  for (const agent of blocked.body?.agents as Array<{ readiness: string }>) {
    expect(agent.readiness).toBe('BLOCKED');
  }
});

it('returns agent detail with dependencies, and 404 for an unknown id', async () => {
  const detail = await get('/v1/agents/tool13-kimi-k3');
  expect(detail.status).toBe(200);
  expect(detail.body?.readiness).toBe('BLOCKED');
  expect((detail.body?.dependencies as Array<{ status: string }>)[0].status).toBe('BLOCKED');

  const missing = await get('/v1/agents/not-an-agent');
  expect(missing.status).toBe(404);
  expect((missing.body?.error as { code: string }).code).toBe('agent_not_found');
});

it('reports capability coverage including genuine gaps', async () => {
  const coverage = await get('/v1/capabilities');
  expect(coverage.status).toBe(200);
  const rows = coverage.body?.capabilities as Array<{ capability: string; gap: boolean; executable_agents: number }>;
  expect(rows).toHaveLength(CAPABILITIES.length);
  for (const row of rows) {
    if (row.gap) expect(row.executable_agents).toBe(0);
  }
});

it('publishes an OpenAPI document that matches the live routes', async () => {
  const doc = await get('/v1/openapi.json');
  expect(doc.status).toBe(200);
  const paths = Object.keys(doc.body?.paths as Record<string, unknown>);
  for (const expected of [
    '/health/live',
    '/health/status',
    '/health/ready',
    '/v1/agents',
    '/v1/agents/{id}',
    '/v1/tools',
    '/v1/missions',
    '/v1/missions/{id}',
    '/v1/missions/{id}/events',
    '/v1/missions/{id}/cancel',
    '/v1/artifacts/{taskId}',
    '/v1/browser/sessions',
    '/v1/integrations',
  ]) {
    expect(paths, `${expected} must be documented`).toContain(expected);
  }
});

it('discovers the MCP tool surface', async () => {
  const tools = await get('/v1/tools');
  expect(tools.status).toBe(200);
  expect(tools.body?.count).toBe(MCP_SURFACE_TOOLS.length);
  const names = (tools.body?.tools as Array<{ name: string }>).map((t) => t.name);
  expect(names).toContain('browser_navigate');
  expect(names).toContain('hub_agent_browse');
});

it('requires an idempotency key and reuses the mission on a retry', async () => {
  const noKey = await post('/v1/missions', { task: 'clean a@example.com' });
  expect(noKey.status).toBe(400);
  expect((noKey.body?.error as { code: string }).code).toBe('missing_idempotency_key');

  const body = { task: 'clean a@example.com and a@example.com', agent_id: 'desk-lead-cleaner', workspace_id: 'api-mission' };
  const headers = { ...auth, 'Idempotency-Key': 'api-mission-1' };
  const created = await fetch(url + '/v1/missions', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(created.status).toBe(201);
  const first = (await created.json()) as { task_id: string; reused: boolean; state: string };
  expect(first.reused).toBe(false);
  expect(first.state).toBe('QUEUED');

  const retry = await fetch(url + '/v1/missions', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(retry.status).toBe(200);
  const second = (await retry.json()) as { task_id: string; reused: boolean };
  expect(second.task_id).toBe(first.task_id);
  expect(second.reused).toBe(true);
});

it('refuses to queue a BLOCKED agent and names the dependency', async () => {
  const blocked = await fetch(url + '/v1/missions', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'blocked-agent' },
    body: JSON.stringify({ task: 'infer something', agent_id: 'tool13-kimi-k3' }),
  });
  expect(blocked.status).toBe(409);
  const payload = (await blocked.json()) as { error: { code: string; message: string } };
  expect(payload.error.code).toBe('agent_blocked');
  expect(payload.error.message).toMatch(/BLOCKED/);
});

it('plans a mission without queuing it, keeping constraints attached', async () => {
  const plan = await post('/v1/missions/plan', {
    task: 'Clean the lead list then review the python code. Do not execute or use paid services.',
  });
  expect(plan.status).toBe(200);
  const decomposition = plan.body?.decomposition as Array<{ subtask: string; agent_id: string }>;
  expect(decomposition.length).toBeGreaterThan(1);
  for (const subtask of decomposition) {
    expect(subtask.subtask).toContain('MANDATORY CONSTRAINTS');
  }
  expect((plan.body?.constraints as unknown[]).length).toBeGreaterThanOrEqual(2);
});

it('runs a mission end to end and serves only its recorded artifacts', async () => {
  const created = await fetch(url + '/v1/missions', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'artifact-mission' },
    body: JSON.stringify({ task: 'clean a@example.com and a@example.com', agent_id: 'desk-lead-cleaner', workspace_id: 'api-artifacts' }),
  });
  const { task_id } = (await created.json()) as { task_id: string };

  let state = '';
  for (let i = 0; i < 200; i++) {
    const current = await get(`/v1/missions/${task_id}`);
    state = String(current.body?.state);
    if (state.startsWith('COMPLETED') || ['BLOCKED', 'FAILED'].includes(state)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(state.startsWith('COMPLETED')).toBe(true);

  const result = await get(`/v1/missions/${task_id}/result`);
  expect(result.status).toBe(200);
  expect(result.body?.output).toBeTruthy();

  const events = await get(`/v1/missions/${task_id}/events`);
  expect((events.body?.events as unknown[]).length).toBeGreaterThan(0);

  const listed = await get(`/v1/artifacts/${task_id}`);
  const artifacts = listed.body?.artifacts as string[];
  expect(artifacts.length).toBeGreaterThan(0);

  const file = await fetch(url + `/v1/artifacts/${task_id}?path=${encodeURIComponent(artifacts[0])}`, { headers: auth });
  expect(file.status).toBe(200);
  expect((await file.text()).length).toBeGreaterThan(0);

  // A path the mission never recorded is not downloadable, even inside the workspace.
  const forged = await get(`/v1/artifacts/${task_id}?path=${encodeURIComponent('../../../etc/passwd')}`);
  expect(forged.status).toBe(404);
  expect((forged.body?.error as { code: string }).code).toBe('artifact_not_found');
});

it('returns 404 for unknown missions rather than an empty success', async () => {
  for (const route of ['/v1/missions/nope', '/v1/missions/nope/result', '/v1/missions/nope/events', '/v1/artifacts/nope']) {
    const res = await get(route);
    expect(res.status).toBe(404);
    expect((res.body?.error as { code: string }).code).toBe('mission_not_found');
  }
});

it('reports every integration with auth requirements and no credential values', async () => {
  const report = await get('/v1/integrations');
  expect(report.status).toBe(200);
  expect(report.body?.count).toBeGreaterThan(5);
  const integrations = report.body?.integrations as Array<Record<string, Record<string, unknown>>>;
  for (const integration of integrations) {
    expect(integration.cost.paid).toBe(false);
    expect(Array.isArray(integration.auth.env)).toBe(true);
    expect(integration.auth.credential_source).toBe('absent');
    // A status report must never carry a secret, so no value field exists at all.
    expect(JSON.stringify(integration)).not.toMatch(/"(value|secret|api_key|token)"\s*:/);
    expect(integration.limits).toBeTruthy();
  }
});

it('serves one integration and 404s an unknown id', async () => {
  const github = await get('/v1/integrations/dev.github');
  expect(github.status).toBe(200);
  expect(github.body?.category).toBe('development');
  // Read-only by design: no operation on a third-party repo may mutate it.
  for (const op of github.body?.operations as Array<{ mutating: boolean }>) {
    expect(op.mutating).toBe(false);
  }

  const missing = await get('/v1/integrations/nope');
  expect(missing.status).toBe(404);
});

it('reports model and browser readiness honestly', async () => {
  const model = await get('/v1/model/health');
  expect(model.status).toBe(200);
  expect(model.body?.readiness).toBe('blocked');
  expect(model.body?.configured_providers).toEqual([]);

  const browser = await get('/v1/browser/sessions');
  expect(browser.status).toBe(200);
  expect((browser.body?.sessions as unknown[]).length).toBe(0);
  expect(['READY', 'BLOCKED']).toContain((browser.body?.availability as { readiness: string }).readiness);
});

it('refuses a browser session without an allow list', async () => {
  const open = await post('/v1/browser/sessions', {});
  expect(open.status).toBe(400);
  expect((open.body?.error as { code: string }).code).toBe('missing_allow_domains');
});

it('reports diagnostics that separate registered from executable capability', async () => {
  const diag = await get('/v1/diagnostics');
  expect(diag.status).toBe(200);
  const agents = diag.body?.agents as Record<string, number>;
  expect(agents.registered).toBe(listAgents().length);
  expect(agents.ready + agents.limited + agents.blocked + agents.untested).toBe(agents.registered);
  const tools13 = diag.body?.tools13 as Record<string, number>;
  expect(tools13.catalog_entries).toBe(13);
  expect(tools13.blocked).toBe(7);
  expect(tools13.local_alternative).toBe(5);
  expect(tools13.enabled).toBe(1);
  expect(tools13.not_enabled).toBe(0);
});

it('reports hub, engine, Agent Reach and Browser-Box without authentication', async () => {
  const res = await fetch(`${url}/health/status`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    service: string;
    components: {
      hub: { state: string; agents: number };
      ai_engine: { state: string; error: string | null; missing_config: string[] };
      agent_reach: { state: string; enabled: boolean };
      browser_box: { state: string; connected: boolean; reason: string };
    };
  };
  expect(body.service).toBe('hamza-agent-hub');
  expect(body.ok).toBe(false);
  expect(body.components.hub.state).toBe('connected');
  expect(body.components.hub.agents).toBe(listAgents().length);
  expect(body.components.ai_engine.state).toBe('not_ready');
  expect(body.components.ai_engine.error).toMatch(/missing config/);
  expect(body.components.ai_engine.missing_config).toContain('HAH_MODEL_URL');
  expect(body.components.agent_reach.enabled).toBe(true);
  expect(body.components.browser_box.connected).toBe(false);
  expect(body.components.browser_box.reason).toMatch(/connection stopped|reconnecting/);
  expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
});

it('audits agents with measured evidence and filters by readiness', async () => {
  const all = await get('/v1/audit?limit=200');
  expect(all.status).toBe(200);
  const summary = all.body?.summary as Record<string, number | boolean>;
  expect(summary.total).toBe(listAgents().length);
  expect(
    (summary.ready as number) + (summary.limited as number) + (summary.blocked as number) + (summary.untested as number)
  ).toBe(summary.total);

  const rows = all.body?.agents as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(listAgents().length);
  for (const row of rows) {
    // A verified tool list longer than the tool list would mean the audit is
    // crediting work the agent is not even permitted to do.
    expect((row.verified_tools as string[]).length).toBeLessThanOrEqual((row.tools as string[]).length);
    if (row.evidence === 'all_tools_executed') expect(row.unverified_tools).toEqual([]);
  }

  const blocked = await get('/v1/audit?readiness=BLOCKED&limit=200');
  expect(blocked.status).toBe(200);
  const blockedRows = blocked.body?.agents as Array<Record<string, unknown>>;
  expect(blockedRows.length).toBe(summary.blocked);
  // Every blocked agent must name the dependency that blocks it.
  for (const row of blockedRows) expect((row.limitations as string[]).join(' ')).toMatch(/unavailable|install|configure/i);

  const bogus = await get('/v1/audit?readiness=PROBABLY_FINE');
  expect(bogus.status).toBe(400);
  expect((bogus.body?.error as { code: string }).code).toBe('invalid_readiness');
});

it('audits one agent and names what it cannot do', async () => {
  const row = await get('/v1/audit/ecc-python-reviewer');
  expect(row.status).toBe(200);
  expect(row.body?.responsibility).toBeTruthy();
  expect(row.body?.capabilities).toContain('code.review');
  // No model is configured, so the honest answer is a stated limitation rather
  // than a claim that a reviewer is ready to reason about code.
  expect(row.body?.readiness).toBe('LIMITED');
  expect((row.body?.api_requirements as string[]).join(' ')).toMatch(/model provider/);
  expect((row.body?.limitations as string[]).join(' ')).toMatch(/live model/);

  const unknown = await get('/v1/audit/not-an-agent');
  expect(unknown.status).toBe(404);
});

it('exposes the human approval checkpoint and demands an accountable actor', async () => {
  const created = await post('/v1/missions', { agent_id: 'desk-lead-cleaner', task: 'clean these leads' }, { ...auth, 'Idempotency-Key': 'approval-contract-1' });
  expect(created.status).toBe(201);
  const taskId = created.body?.task_id as string;

  const none = await get(`/v1/missions/${taskId}/approval`);
  expect(none.status).toBe(200);
  expect(none.body?.awaiting_approval).toBe(false);

  // Nothing is pending, so a decision is a conflict rather than a silent no-op.
  const early = await post(`/v1/missions/${taskId}/approval`, { approve: true, actor: 'hamza' });
  expect(early.status).toBe(409);
  expect((early.body?.error as { code: string }).code).toBe('not_awaiting_approval');

  const noActor = await post(`/v1/missions/${taskId}/approval`, { approve: true });
  expect(noActor.status).toBe(400);
  expect((noActor.body?.error as { code: string }).code).toBe('actor_required');

  const noDecision = await post(`/v1/missions/${taskId}/approval`, { actor: 'hamza' });
  expect(noDecision.status).toBe(400);
  expect((noDecision.body?.error as { code: string }).code).toBe('approve_required');

  expect((await get('/v1/missions/not-a-task/approval')).status).toBe(404);
});

it('enforces a rate limit on the API window', async () => {
  vi.stubEnv('HAH_RATE_LIMIT', '2');
  if (listener) await new Promise<void>((resolve) => listener!.close(() => resolve()));
  listener = createHttpApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => listener!.once('listening', resolve));
  url = `http://127.0.0.1:${(listener.address() as { port: number }).port}`;

  await get('/v1/tools');
  await get('/v1/tools');
  const limited = await fetch(url + '/v1/tools', { headers: auth });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('60');
});
