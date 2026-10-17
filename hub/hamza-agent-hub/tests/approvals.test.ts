/**
 * Human approval checkpoints and untrusted-input handling (Part 10).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consumeApproval, pendingApproval, requestApproval, resolveApproval } from '../src/runtime/approvals.js';
import { enqueueAgentTask, stopQueue } from '../src/runtime/queue.js';
import { getTask, listEvents, taskState, closeDb } from '../src/storage/db.js';
import { checkAction, policyFrom, DEFAULT_POLICY } from '../src/browser/policy.js';
import { webSearch } from '../src/integrations/search.js';

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-approve-'));
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_DATA_DIR', path.join(base, 'data'));
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  vi.stubEnv('HAH_FREELLMAPI_URL', '');
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
});

afterEach(async () => {
  await stopQueue();
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

let seq = 0;
function queued() {
  return enqueueAgentTask({
    agent_id: 'desk-lead-cleaner',
    task: 'clean these leads',
    workspace_id: 'ws-approve',
    idempotency_key: `approval-case-${++seq}`,
  });
}

it('parks a task in WAITING_FOR_APPROVAL without running the action', () => {
  const { task_id } = queued();
  const pending = requestApproval(task_id, {
    tool: 'browser_act',
    describe: 'upload passport.pdf to the portal',
    reason: 'action "upload" requires human approval',
  });

  const task = getTask(task_id)!;
  expect(taskState(task)).toBe('WAITING_FOR_APPROVAL');
  // The published state must be reachable, and the legacy status must keep
  // reading as not-yet-finished so existing consumers do not see a completion.
  expect(task.status).toBe('queued');
  expect(task.verified).toBe(0);

  const stored = pendingApproval(task_id);
  expect(stored?.tool).toBe('browser_act');
  expect(stored?.describe).toBe(pending.describe);

  // The request is on the task row, so a restart cannot lose it and resume.
  expect(task.pending_approval).toBeTruthy();
  expect(listEvents(task_id).some((e) => e.kind === 'approval_requested')).toBe(true);
});

it('requeues on approval and records who authorised it', () => {
  const { task_id } = queued();
  requestApproval(task_id, { tool: 'browser_act', describe: 'submit the order', reason: 'irreversible' });

  const result = resolveApproval(task_id, { approved: true, actor: 'hamza', note: 'checked the cart' });
  expect(result.state).toBe('QUEUED');

  const task = getTask(task_id)!;
  expect(taskState(task)).toBe('QUEUED');
  expect(task.pending_approval).toBeNull();
  expect(task.approved_action).toBeTruthy();

  const granted = listEvents(task_id).find((e) => e.kind === 'approval_granted');
  expect(granted).toBeTruthy();
  expect(granted!.payload).toMatch(/hamza/);
});

it('cancels on refusal rather than continuing past a declined action', () => {
  const { task_id } = queued();
  requestApproval(task_id, { tool: 'browser_act', describe: 'wire the payment', reason: 'irreversible' });

  resolveApproval(task_id, { approved: false, actor: 'hamza' });
  const task = getTask(task_id)!;
  expect(taskState(task)).toBe('CANCELLED');
  expect(task.verified).toBe(0);
  expect(task.error).toMatch(/declined/);
  expect(task.approved_action).toBeNull();
});

it('consumes an approval once so it cannot become a standing permission', () => {
  const { task_id } = queued();
  requestApproval(task_id, { tool: 'browser_act', describe: 'upload the file', reason: 'policy' });
  resolveApproval(task_id, { approved: true, actor: 'hamza' });

  expect(consumeApproval(task_id, 'browser_act')).toBe(true);
  expect(consumeApproval(task_id, 'browser_act')).toBe(false);
});

it('does not honour an approval granted for a different tool', () => {
  const { task_id } = queued();
  requestApproval(task_id, { tool: 'browser_act', describe: 'upload the file', reason: 'policy' });
  resolveApproval(task_id, { approved: true, actor: 'hamza' });

  expect(consumeApproval(task_id, 'run_command')).toBe(false);
  // The unrelated attempt must not burn the real authorisation either.
  expect(consumeApproval(task_id, 'browser_act')).toBe(true);
});

it('refuses to resolve a task that is not awaiting approval', () => {
  const { task_id } = queued();
  expect(() => resolveApproval(task_id, { approved: true, actor: 'hamza' })).toThrow(/not awaiting approval/);
});

it('marks approval-gated browser actions as requiring approval rather than allowed', () => {
  const readOnly = policyFrom({ allowDomains: ['example.com'] });
  // Mutating actions are not in the default allow list at all, so an upload is
  // refused outright before approval is even considered.
  expect(checkAction('upload', readOnly).allowed).toBe(false);

  const granted = policyFrom({
    allowDomains: ['example.com'],
    allowActions: [...DEFAULT_POLICY.allowActions, 'upload'],
    allowUploads: true,
  });
  const upload = checkAction('upload', granted);
  expect(upload.allowed).toBe(true);
  expect(upload.requiresApproval).toBe(true);
  // Reading is not gated, so a snapshot must not demand sign-off.
  expect(checkAction('snapshot', readOnly).requiresApproval).toBeFalsy();
});

it('labels search results as untrusted input', async () => {
  // Nothing is configured here, so the outcome is a refusal. It must still
  // carry the untrusted marker, because a consumer reads the same shape either
  // way and must never treat result text as instructions.
  const outcome = await webSearch('hamza hub injection probe');
  expect(outcome.untrusted_content).toBe(true);
  expect(outcome.injection_suspected).toBe(0);
  expect(outcome.results).toEqual([]);
  expect(outcome.readiness).toBe('BLOCKED');
  expect(outcome.setup_hint).toBeTruthy();
});
