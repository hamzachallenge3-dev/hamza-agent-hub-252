/**
 * Versioned REST surface.
 *
 * The Hub previously exposed only `/mcp` plus `/healthz`, so anything that was
 * not an MCP client had no contract at all. Every route here is authenticated,
 * rate-limited, paginated where it returns a list, idempotent where it creates
 * work, and returns the same structured error envelope.
 *
 * `/health/live` and `/health/ready` are deliberately unauthenticated: a load
 * balancer must be able to probe them, and they expose no detail.
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, originAllowed } from '../config.js';
import { assertCatalog, listAgents, getAgent, PACKS } from '../runtime/registry.js';
import { capabilityIndex, profileFor, CAPABILITIES, type Capability } from '../runtime/capabilities.js';
import { browseEverything, browseAgentDetail, MCP_SURFACE_TOOLS, SANDBOX_MCP_TOOLS } from '../runtime/browse.js';
import { planWithBoss } from '../runtime/boss.js';
import { auditAgent, auditAgents, auditSummary } from '../runtime/audit.js';
import { pendingApproval, resolveApproval } from '../runtime/approvals.js';
import { cancelTask, enqueueAgentTask, queueStats, startQueue } from '../runtime/queue.js';
import { missionStatus, startMission } from '../runtime/mission.js';
import { STATE_TO_LEGACY } from '../runtime/states.js';
import { getTask, listEvents, taskState } from '../storage/db.js';
import { modelHealth, modelStatus } from '../model/client.js';
import { integrationStatusReport, getIntegration, listIntegrations } from '../integrations/registry.js';
import { registerBuiltinIntegrations } from '../integrations/adapters.js';
import { browserAvailability, listSessions, createSession, closeSession, maxSessions } from '../browser/session.js';
import { tools13Capabilities } from '../packs/tools13/offline.js';
import { ensureWorkspace, resolveSafePath } from '../security/workspace.js';
import { redactSecrets } from '../security/redact.js';
import { sandboxToolsEnabled } from '../tools/sandbox.js';
import { openApiDocument } from './openapi.js';

/** One error envelope for the whole API. */
function fail(res: express.Response, status: number, code: string, message: string, recovery?: string) {
  res.status(status).json({ error: { code, message, recovery: recovery ?? null, status } });
}

interface AuditEntry {
  at: number;
  method: string;
  route: string;
  status: number;
  ms: number;
}

const auditLog: AuditEntry[] = [];

export function apiAuditLog(): AuditEntry[] {
  return [...auditLog];
}

function paginate<T>(items: T[], req: express.Request): { page: T[]; meta: Record<string, number | boolean> } {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const page = items.slice(offset, offset + limit);
  return {
    page,
    meta: { total: items.length, offset, limit, returned: page.length, has_more: offset + page.length < items.length },
  };
}

function taskView(id: string) {
  const task = getTask(id);
  if (!task) return null;
  return {
    task_id: task.id,
    agent_id: task.agent_id,
    workspace_id: task.workspace_id,
    /** Explicit nine-value state. */
    state: taskState(task),
    /** Legacy status, kept so existing consumers keep working. */
    status: task.status,
    verified: Boolean(task.verified),
    progress: task.progress,
    progress_message: task.progress_message,
    attempts: task.attempts,
    created_at: task.created_at,
    finished_at: task.finished_at,
    error: task.error,
    artifacts: safeJson(task.artifacts) ?? [],
  };
}

function safeJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createApiRouter(): express.Router {
  registerBuiltinIntegrations();
  const router = express.Router();

  // Liveness and readiness are open on purpose: they leak nothing and a probe
  // cannot carry a bearer token.
  router.get('/health/live', (_req, res) => {
    res.json({ ok: true, service: 'hamza-agent-hub', version: '1.2.1' });
  });

  router.get('/health/ready', async (_req, res) => {
    let catalogOk = false;
    let catalogError: string | null = null;
    try {
      assertCatalog();
      catalogOk = true;
    } catch (err) {
      catalogError = err instanceof Error ? err.message : String(err);
    }
    const [model, browser] = await Promise.all([modelHealth(1_500), browserAvailability()]);
    const dbOk = fs.existsSync(path.dirname(config.dbPath));
    // Ready means the Hub can accept and run deterministic work. A missing live
    // model degrades results to COMPLETED_LIMITED; it does not make the Hub
    // unready, and saying otherwise would be the opposite kind of dishonesty.
    const ready = catalogOk && dbOk;
    res.status(ready ? 200 : 503).json({
      ready,
      checks: {
        catalog: { ok: catalogOk, detail: catalogError ?? `${listAgents().length} agents` },
        storage: { ok: dbOk, detail: dbOk ? 'data directory present' : 'data directory missing' },
        model: { ok: model.any_live, readiness: model.readiness, detail: model.degraded_mode ?? 'live provider available' },
        browser: { ok: browser.available, readiness: browser.readiness, detail: browser.reason },
        queue: queueStats(),
      },
    });
  });

  router.get('/v1/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });

  router.get('/v1/agents', (req, res) => {
    const index = capabilityIndex();
    let agents = listAgents();
    const pack = req.query.pack ? String(req.query.pack) : '';
    const capability = req.query.capability ? String(req.query.capability) : '';
    const readiness = req.query.readiness ? String(req.query.readiness).toUpperCase() : '';

    if (pack && !PACKS.some((p) => p.id === pack)) {
      return fail(res, 400, 'unknown_pack', `unknown pack: ${pack}`, `Valid packs: ${PACKS.map((p) => p.id).join(', ')}`);
    }
    if (capability && !CAPABILITIES.includes(capability as Capability)) {
      return fail(res, 400, 'unknown_capability', `unknown capability: ${capability}`, `Valid capabilities: ${CAPABILITIES.join(', ')}`);
    }
    if (readiness && !['READY', 'LIMITED', 'BLOCKED', 'UNTESTED'].includes(readiness)) {
      return fail(res, 400, 'unknown_readiness', `unknown readiness: ${readiness}`, 'Valid: READY, LIMITED, BLOCKED, UNTESTED');
    }

    if (pack) agents = agents.filter((a) => a.pack === pack);
    if (capability) agents = agents.filter((a) => index.get(a.id)?.capabilities.includes(capability as Capability));
    if (readiness) agents = agents.filter((a) => index.get(a.id)?.readiness === readiness);

    const rows = agents.map((a) => {
      const profile = index.get(a.id);
      return {
        id: a.id,
        pack: a.pack,
        category: a.category,
        description: a.description,
        capabilities: profile?.capabilities ?? [],
        readiness: profile?.readiness ?? 'UNTESTED',
        readiness_reason: profile?.readiness_reason ?? '',
        requires_model: profile?.requires_model ?? false,
        tested: a.tested,
      };
    });
    const { page, meta } = paginate(rows, req);
    res.json({ agents: page, ...meta });
  });

  router.get('/v1/agents/:id', (req, res) => {
    const detail = browseAgentDetail(req.params.id);
    if (!detail.agent) {
      return fail(res, 404, 'agent_not_found', `unknown agent: ${req.params.id}`, 'List agents at GET /v1/agents.');
    }
    res.json(detail);
  });

  router.get('/v1/capabilities', (_req, res) => {
    const index = capabilityIndex();
    res.json({
      capabilities: CAPABILITIES.map((capability) => {
        const holders = [...index.values()].filter((p) => p.capabilities.includes(capability));
        const executable = holders.filter((p) => p.readiness !== 'BLOCKED');
        return {
          capability,
          agents: holders.length,
          executable_agents: executable.length,
          ready_agents: holders.filter((p) => p.readiness === 'READY').length,
          // A capability with holders but none executable is a gap, not a skill.
          gap: executable.length === 0,
          integrations: listIntegrations().filter((i) => i.capabilities.includes(capability)).map((i) => i.id),
        };
      }),
    });
  });

  router.get('/v1/tools', (_req, res) => {
    const tools = [
      ...MCP_SURFACE_TOOLS.map((name) => ({ name, surface: 'mcp', requires_auth: true })),
      ...(sandboxToolsEnabled() ? SANDBOX_MCP_TOOLS.map((name) => ({ name, surface: 'sandbox', requires_auth: true })) : []),
    ];
    res.json({ count: tools.length, tools, sandbox_enabled: sandboxToolsEnabled() });
  });

  router.get('/v1/catalog', (req, res) => {
    const result = browseEverything({
      query: req.query.query ? String(req.query.query) : undefined,
      pack: req.query.pack ? String(req.query.pack) : undefined,
      capability: req.query.capability ? String(req.query.capability) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      executable_only: req.query.executable_only === 'true',
    });
    if (result.error) return fail(res, 400, 'invalid_filter', result.error, result.message);
    res.json(result);
  });

  router.post('/v1/missions', express.json({ limit: '1mb' }), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const task = String(body.task ?? '').trim();
    // The idempotency key is required, not optional: a retried POST must never
    // queue the same mission twice.
    const idempotencyKey = String(req.header('Idempotency-Key') ?? body.idempotency_key ?? '').trim();
    if (!task) return fail(res, 400, 'missing_task', 'task is required', 'Send {"task": "..."} in the body.');
    if (!idempotencyKey) {
      return fail(res, 400, 'missing_idempotency_key', 'an Idempotency-Key header or idempotency_key field is required', 'Generate a stable key per mission and resend.');
    }

    const explicitAgent = body.agent_id !== undefined;
    const agentId = String(body.agent_id ?? 'hub-boss');
    if (!getAgent(agentId)) {
      return fail(res, 404, 'agent_not_found', `unknown agent: ${agentId}`, 'List agents at GET /v1/agents.');
    }
    const profile = profileFor(agentId);
    if (profile?.readiness === 'BLOCKED') {
      return fail(res, 409, 'agent_blocked', `${agentId} is BLOCKED: ${profile.readiness_reason}`, 'Pick a READY or LIMITED agent, or resolve the dependency.');
    }

    const workspaceId = String(body.workspace_id ?? `mission-${idempotencyKey}`).replace(/[^\w-]/g, '-').slice(0, 64);

    // Naming an agent means "run this agent". Naming none means "run the
    // mission", which queues the whole decomposition instead of the primary
    // alone — the plan's other subtasks used to exist only on paper.
    if (!explicitAgent) {
      try {
        const started = startMission({ task, workspace_id: workspaceId, idempotency_key: idempotencyKey });
        const status = missionStatus(started.mission_id)!;
        return res.status(started.reused ? 200 : 201).json({
          mission_id: started.mission_id,
          // Kept so existing consumers that read task_id still have an id that
          // resolves at GET /v1/missions/{id}.
          task_id: started.mission_id,
          reused: started.reused,
          state: status.state,
          status: STATE_TO_LEGACY[status.state],
          subtask_ids: started.task_ids,
          plan: started.plan,
          links: {
            status: `/v1/missions/${started.mission_id}`,
            events: `/v1/missions/${started.mission_id}/events`,
            cancel: `/v1/missions/${started.mission_id}/cancel`,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(res, /idempotency/.test(message) ? 409 : 400, 'mission_rejected', message, 'Use a new idempotency key for different task text.');
      }
    }

    try {
      startQueue();
      const result = enqueueAgentTask({ agent_id: agentId, task, workspace_id: workspaceId, idempotency_key: idempotencyKey });
      res.status(result.reused ? 200 : 201).json({
        task_id: result.task_id,
        reused: result.reused,
        state: taskState(result.task),
        status: result.task.status,
        plan: agentId === 'hub-boss' ? planWithBoss(task) : null,
        links: {
          status: `/v1/missions/${result.task_id}`,
          events: `/v1/missions/${result.task_id}/events`,
          cancel: `/v1/missions/${result.task_id}/cancel`,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /queue full/.test(message) ? 503 : /idempotency/.test(message) ? 409 : 400;
      fail(res, status, status === 503 ? 'queue_full' : 'enqueue_rejected', message, status === 503 ? 'Retry after in-flight work drains.' : 'Use a new idempotency key for different task text.');
    }
  });

  router.post('/v1/missions/plan', express.json({ limit: '1mb' }), (req, res) => {
    const task = String((req.body as Record<string, unknown>)?.task ?? '').trim();
    if (!task) return fail(res, 400, 'missing_task', 'task is required', 'Send {"task": "..."} in the body.');
    res.json(planWithBoss(task));
  });

  router.get('/v1/missions/:id', (req, res) => {
    const mission = missionStatus(req.params.id);
    if (mission) return res.json(mission);
    const view = taskView(req.params.id);
    if (!view) return fail(res, 404, 'mission_not_found', `unknown mission: ${req.params.id}`, 'Check the task_id returned by POST /v1/missions.');
    res.json(view);
  });

  router.get('/v1/missions/:id/result', (req, res) => {
    const mission = missionStatus(req.params.id);
    if (mission) {
      // The assembled report is the mission's output; it exists only once every
      // subtask is terminal, so an in-flight mission says so rather than
      // returning a partial answer that reads like a result.
      return res.json({ ...mission, output: mission.report });
    }
    const task = getTask(req.params.id);
    if (!task) return fail(res, 404, 'mission_not_found', `unknown mission: ${req.params.id}`, 'Check the task_id returned by POST /v1/missions.');
    res.json({
      ...taskView(req.params.id),
      output: task.output,
      evidence: safeJson(task.evidence),
      tool_log: safeJson(task.tool_log),
    });
  });

  router.get('/v1/missions/:id/events', (req, res) => {
    const task = getTask(req.params.id);
    const mission = task ? null : missionStatus(req.params.id);
    if (!task && !mission) return fail(res, 404, 'mission_not_found', `unknown mission: ${req.params.id}`, 'Check the task_id returned by POST /v1/missions.');
    // A mission's own events plus those of every subtask, so one stream shows
    // the whole run rather than only the coordination.
    const events = mission
      ? [...listEvents(req.params.id), ...mission.subtasks.flatMap((s) => listEvents(s.task_id))].sort((a, b) => a.created_at - b.created_at)
      : listEvents(req.params.id);

    if (req.query.stream === 'true') {
      // Streaming status for long missions; the client gets state changes as
      // they happen instead of polling.
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.flushHeaders();
      let sent = 0;
      const push = () => {
        const status = mission ? missionStatus(req.params.id) : null;
        const current = status
          ? [...listEvents(req.params.id), ...status.subtasks.flatMap((s) => listEvents(s.task_id))].sort((a, b) => a.created_at - b.created_at)
          : listEvents(req.params.id);
        for (const event of current.slice(sent)) {
          res.write(`event: ${event.kind}\ndata: ${redactSecrets(event)}\n\n`);
        }
        sent = current.length;
        const done = status
          ? ['COMPLETED_VERIFIED', 'COMPLETED_LIMITED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(status.state)
          : ['completed', 'failed', 'cancelled', 'dead_letter'].includes(getTask(req.params.id)?.status ?? '');
        if (done) {
          res.write(`event: final\ndata: ${redactSecrets(status ?? taskView(req.params.id))}\n\n`);
          clearInterval(timer);
          res.end();
        }
      };
      const timer = setInterval(push, 500);
      req.on('close', () => clearInterval(timer));
      push();
      return;
    }

    const { page, meta } = paginate(events, req);
    res.json({ events: page, ...meta });
  });

  // Human approval checkpoint. A parked mission exposes exactly which action is
  // waiting, and only an explicit decision releases it.
  router.get('/v1/missions/:id/approval', (req, res) => {
    const id = String(req.params.id);
    // A mission parks on whichever subtask hit the checkpoint, so the decision
    // is reported against that subtask rather than the mission as a whole.
    const mission = getTask(id) ? null : missionStatus(id);
    if (mission) {
      const parked = mission.subtasks.map((s) => ({ task_id: s.task_id, pending: pendingApproval(s.task_id) })).find((s) => s.pending);
      if (!parked) return res.json({ task_id: id, awaiting_approval: false, pending: null, state: mission.state });
      return res.json({ task_id: parked.task_id, mission_id: id, awaiting_approval: true, pending: parked.pending });
    }
    if (!getTask(id)) return fail(res, 404, 'mission_not_found', `unknown mission: ${id}`);
    const pending = pendingApproval(id);
    if (!pending) {
      return res.json({ task_id: id, awaiting_approval: false, pending: null, state: taskView(id)?.state });
    }
    res.json({ task_id: id, awaiting_approval: true, pending });
  });

  router.post('/v1/missions/:id/approval', express.json({ limit: '64kb' }), (req, res) => {
    const id = String(req.params.id);
    if (!getTask(id)) return fail(res, 404, 'mission_not_found', `unknown mission: ${id}`);
    const body = (req.body ?? {}) as { approve?: unknown; actor?: unknown; note?: unknown };
    if (typeof body.approve !== 'boolean') {
      return fail(res, 400, 'approve_required', 'approve must be true or false', 'Send {"approve": true, "actor": "name"}.');
    }
    // An approval with no accountable actor is not an approval.
    const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (!actor) {
      return fail(res, 400, 'actor_required', 'actor must name who authorised this', 'Send the approving human or system identity.');
    }
    try {
      const result = resolveApproval(id, {
        approved: body.approve,
        actor: actor.slice(0, 200),
        note: typeof body.note === 'string' ? body.note.slice(0, 1_000) : undefined,
      });
      res.json({ task_id: id, approved: body.approve, state: result.state, action: result.pending });
    } catch (err) {
      return fail(
        res,
        409,
        'not_awaiting_approval',
        err instanceof Error ? err.message : String(err),
        'Check GET /v1/missions/{id}/approval first.'
      );
    }
  });

  router.post('/v1/missions/:id/cancel', (req, res) => {
    // Cancelling a mission cancels every subtask: leaving siblings running
    // after the operator stopped the mission is how unapproved work continues.
    const mission = missionStatus(req.params.id);
    if (mission) {
      for (const subtask of mission.subtasks) cancelTask(subtask.task_id);
      return res.json(missionStatus(req.params.id));
    }
    try {
      res.json(cancelTask(req.params.id));
    } catch (err) {
      fail(res, 404, 'mission_not_found', err instanceof Error ? err.message : String(err), 'Check the task_id.');
    }
  });

  router.get('/v1/artifacts/:taskId', (req, res) => {
    const task = getTask(req.params.taskId);
    if (!task) return fail(res, 404, 'mission_not_found', `unknown mission: ${req.params.taskId}`, 'Check the task_id.');
    const artifacts = (safeJson(task.artifacts) as string[] | null) ?? [];
    const wanted = req.query.path ? String(req.query.path) : '';

    if (!wanted) {
      return res.json({ task_id: task.id, artifacts, download: artifacts.map((a) => `/v1/artifacts/${task.id}?path=${encodeURIComponent(a)}`) });
    }
    // Only paths the task itself recorded are served, and only through the
    // workspace resolver, so a crafted `path` cannot escape.
    if (!artifacts.includes(wanted)) {
      return fail(res, 404, 'artifact_not_found', `this mission did not record "${wanted}"`, `Recorded artifacts: ${artifacts.join(', ') || 'none'}`);
    }
    try {
      const root = ensureWorkspace(task.workspace_id);
      const abs = resolveSafePath(root, wanted);
      if (!fs.existsSync(abs)) return fail(res, 410, 'artifact_missing', `${wanted} is recorded but no longer on disk`, 'Re-run the mission.');
      res.type(path.extname(abs) || 'text/plain').send(fs.readFileSync(abs));
    } catch (err) {
      fail(res, 400, 'artifact_unreadable', err instanceof Error ? err.message : String(err), 'Artifact paths must stay inside the workspace.');
    }
  });

  router.get('/v1/integrations', async (_req, res) => {
    res.json(await integrationStatusReport(2_500));
  });

  router.get('/v1/integrations/:id', async (req, res) => {
    const integration = getIntegration(req.params.id);
    if (!integration) return fail(res, 404, 'integration_not_found', `unknown integration: ${req.params.id}`, 'List them at GET /v1/integrations.');
    res.json({
      id: integration.id,
      label: integration.label,
      category: integration.category,
      provider: integration.provider,
      auth: { kind: integration.auth.kind, env: integration.auth.env, hint: integration.auth.hint },
      capabilities: integration.capabilities,
      operations: integration.operations,
      limits: integration.limits,
      cost: integration.cost,
      configured: integration.configured(),
      health: await integration.health(2_500),
    });
  });

  router.get('/v1/model/health', async (_req, res) => {
    res.json({ ...(await modelHealth(2_500)), status: modelStatus() });
  });

  router.get('/v1/browser/sessions', async (_req, res) => {
    res.json({
      availability: await browserAvailability(),
      max_sessions: maxSessions(),
      sessions: listSessions(),
    });
  });

  router.post('/v1/browser/sessions', express.json({ limit: '256kb' }), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const allowDomains = Array.isArray(body.allow_domains) ? body.allow_domains.map(String) : [];
    if (!allowDomains.length) {
      return fail(res, 400, 'missing_allow_domains', 'allow_domains is required', 'A session with no allow list can reach nothing. Name the authorised domains.');
    }
    try {
      const session = await createSession({
        profile: body.profile ? String(body.profile) : undefined,
        policy: {
          allowDomains,
          denyDomains: Array.isArray(body.deny_domains) ? body.deny_domains.map(String) : undefined,
          allowActions: Array.isArray(body.allow_actions) ? (body.allow_actions.map(String) as never) : undefined,
          allowDownloads: typeof body.allow_downloads === 'boolean' ? body.allow_downloads : undefined,
          allowUploads: typeof body.allow_uploads === 'boolean' ? body.allow_uploads : undefined,
        },
      });
      res.status(201).json({ session_id: session.id, policy: session.policy });
    } catch (err) {
      fail(res, 503, 'browser_unavailable', err instanceof Error ? err.message : String(err), 'Install Chromium with: npx playwright install chromium');
    }
  });

  router.delete('/v1/browser/sessions/:id', async (req, res) => {
    const closed = await closeSession(req.params.id);
    if (!closed) return fail(res, 404, 'session_not_found', `unknown session: ${req.params.id}`, 'List sessions at GET /v1/browser/sessions.');
    res.json({ closed: true });
  });

  // The full per-agent audit: responsibility, tools, verified tools, inputs,
  // outputs, model and API requirements, runtime dependencies, readiness and
  // limitations. Running the smoke checks takes a moment, so it is its own
  // route rather than part of the agent list.
  router.get('/v1/audit', async (req, res) => {
    const rows = await auditAgents();
    const readiness = typeof req.query.readiness === 'string' ? req.query.readiness.toUpperCase() : null;
    if (readiness && !['READY', 'LIMITED', 'BLOCKED', 'UNTESTED'].includes(readiness)) {
      return fail(res, 400, 'invalid_readiness', `unknown readiness: ${readiness}`, 'Use READY, LIMITED, BLOCKED or UNTESTED.');
    }
    const filtered = readiness ? rows.filter((r) => r.readiness === readiness) : rows;
    const { page, meta } = paginate(filtered, req);
    res.json({ summary: await auditSummary(), agents: page, ...meta });
  });

  router.get('/v1/audit/:id', async (req, res) => {
    const row = await auditAgent(String(req.params.id));
    if (!row) return fail(res, 404, 'agent_not_found', `unknown agent: ${req.params.id}`, 'List agents with GET /v1/agents.');
    res.json(row);
  });

  router.get('/v1/diagnostics', async (_req, res) => {
    const profiles = [...capabilityIndex().values()];
    const t13 = tools13Capabilities();
    const [model, browser, audit] = await Promise.all([modelHealth(2_000), browserAvailability(), auditSummary()]);
    res.json({
      service: 'hamza-agent-hub',
      version: '1.2.1',
      // Measured from executed tool checks, so this matches GET /v1/audit and
      // the readiness the Boss routes on.
      agents: {
        registered: audit.total,
        ready: audit.ready,
        limited: audit.limited,
        blocked: audit.blocked,
        untested: audit.untested,
        /** What each readiness rests on, so a claim is never mistaken for proof. */
        evidence: {
          all_tools_executed: audit.all_tools_executed,
          some_tools_executed: audit.some_tools_executed,
          declared_only: audit.declared_only,
          declared_tested_in_catalog: audit.declared_tested,
        },
      },
      capabilities_indexed: profiles.length,
      tools13: {
        catalog_entries: t13.length,
        local_alternative: t13.filter((c) => c.status === 'LOCAL_ALTERNATIVE').length,
        blocked: t13.filter((c) => c.status === 'BLOCKED').length,
      },
      model,
      browser,
      queue: queueStats(),
      integrations: { registered: listIntegrations().length, configured: listIntegrations().filter((i) => i.configured()).length },
      api_requests_recorded: auditLog.length,
    });
  });

  return router;
}

/**
 * Bearer auth for everything under `/v1`. Comparison is constant-time and the
 * middleware runs before body parsing, so an unauthenticated request never
 * reaches application code.
 */
export function apiAuth(): express.RequestHandler {
  return (req, res, next) => {
    const expected = Buffer.from(`Bearer ${config.authToken}`);
    const supplied = Buffer.from(req.headers.authorization || '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      fail(res, 401, 'unauthorized', 'a valid bearer token is required', 'Send Authorization: Bearer <HAH_AUTH_TOKEN>.');
      return;
    }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      fail(res, 403, 'forbidden_origin', 'origin is not allowed', 'Add the origin to HAH_ALLOW_ORIGINS.');
      return;
    }
    next();
  };
}

/** Request audit trail. Records route shape and outcome, never bodies or headers. */
export function apiAudit(): express.RequestHandler {
  return (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      auditLog.push({
        at: started,
        method: req.method,
        // The route pattern, so an artifact path or task id is never logged.
        route: (req.route?.path as string) ?? req.path.replace(/\/[0-9a-f-]{8,}/gi, '/:id'),
        status: res.statusCode,
        ms: Date.now() - started,
      });
      if (auditLog.length > 1_000) auditLog.splice(0, auditLog.length - 1_000);
    });
    next();
  };
}
