/**
 * Multi-agent mission execution.
 *
 * The Boss produced a decomposition with owners and dependencies long before
 * anything ran it: `POST /v1/missions` queued the primary agent and the other
 * subtasks existed only in the plan. These tests hold the orchestrator to the
 * behaviour Part 2 asks for — every subtask owned and queued, dependencies
 * respected, constraints on all of them, and a mission that is only as
 * complete as its least complete subtask.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getMission, missionStatus, startMission } from '../src/runtime/mission.js';
import { startQueue, stopQueue } from '../src/runtime/queue.js';
import { closeDb, getMissionTasks, getTask, requeueInterrupted, taskState, updateTask } from '../src/storage/db.js';

let base: string;
let seq = 0;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-mission-'));
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_DATA_DIR', path.join(base, 'data'));
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
});

afterEach(async () => {
  await stopQueue();
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

function start(task: string) {
  seq += 1;
  return startMission({ task, workspace_id: `mission-${seq}`, idempotency_key: `mission-key-${seq}` });
}

async function settle(missionId: string, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const status = missionStatus(missionId)!;
    if (['COMPLETED_VERIFIED', 'COMPLETED_LIMITED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(status.state)) return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return missionStatus(missionId)!;
}

it('queues one task per planned subtask, not the primary alone', async () => {
  const started = start('Clean the lead list then audit the SEO of the site then review the python code.');
  expect(started.plan.decomposition.length).toBeGreaterThan(2);
  expect(started.task_ids.length).toBe(started.plan.decomposition.length);

  const rows = getMissionTasks(started.mission_id);
  expect(rows.length).toBe(started.task_ids.length);
  // Distinct owners: a mission that hands every subtask to one agent is not a
  // multi-agent mission.
  expect(new Set(rows.map((r) => r.agent_id)).size).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.mission_id).toBe(started.mission_id);
    expect(row.role).toBeTruthy();
  }
});

it('carries the user constraints into every queued subtask', async () => {
  const started = start('Review the checkout module and write tests for it. Do not execute anything or use paid services.');
  const rows = getMissionTasks(started.mission_id);
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.task).toContain('MANDATORY CONSTRAINTS');
    expect(row.task).toContain('no_execution');
    expect(row.task).toContain('no_spend');
  }
});

it('holds a dependent subtask in WAITING_FOR_DEPENDENCY until its upstream finishes', async () => {
  const started = start('Plan the architecture then implement it then review the code.');
  const rows = getMissionTasks(started.mission_id);
  const dependent = rows.find((r) => r.depends_on);
  expect(dependent, 'the plan should declare at least one dependency').toBeTruthy();
  expect(taskState(dependent!)).toBe('WAITING_FOR_DEPENDENCY');
  // Its dependency is a real sibling task of the same mission, not a plan id.
  const deps = JSON.parse(dependent!.depends_on!) as string[];
  expect(deps.length).toBeGreaterThan(0);
  for (const id of deps) expect(getTask(id)?.mission_id).toBe(started.mission_id);

  const status = await settle(started.mission_id);
  for (const subtask of status.subtasks) {
    expect(['COMPLETED_VERIFIED', 'COMPLETED_LIMITED', 'BLOCKED', 'FAILED']).toContain(subtask.state);
  }
});

it('reports a mission as no more complete than its least complete subtask', async () => {
  const started = start('Clean the lead list then review the python code.');
  const status = await settle(started.mission_id);
  // No live model is configured here, so every reasoning subtask is limited and
  // the mission must say so rather than claiming a verified completion.
  expect(status.state).toBe('COMPLETED_LIMITED');
  expect(status.verified).toBe(false);
  expect(status.progress).toBe(1);
});

it('assembles one report naming every subtask and the constraints applied', async () => {
  const started = start('Clean the lead list then review the python code. Do not use paid services.');
  const status = await settle(started.mission_id);
  expect(status.report).toBeTruthy();
  const report = status.report!;
  for (const subtask of status.subtasks) expect(report).toContain(subtask.agent_id);
  expect(report).toContain('no_spend');
  expect(report).toContain(status.state);

  // The report is also on disk as a retrievable artifact.
  const mission = getMission(started.mission_id)!;
  const file = path.join(base, 'workspaces', mission.workspace_id, 'artifacts', `mission-${started.mission_id}.md`);
  expect(fs.existsSync(file)).toBe(true);
});

it('resumes a mission interrupted mid-flight instead of stranding it', async () => {
  const started = start('Clean the lead list then review the python code.');
  const rows = getMissionTasks(started.mission_id);

  // Simulate a crash during the first subtask: the row is left `running` with
  // no worker behind it, which is exactly the state a killed process leaves.
  await stopQueue();
  updateTask(rows[0].id, { status: 'running', state: 'RUNNING', progress_message: 'interrupted' });

  const recovered = requeueInterrupted();
  expect(recovered).toBeGreaterThan(0);
  expect(getTask(rows[0].id)?.status).toBe('queued');

  startQueue();
  const status = await settle(started.mission_id);
  expect(['COMPLETED_VERIFIED', 'COMPLETED_LIMITED']).toContain(status.state);
  // The mission's wiring survived the restart, not just the individual rows.
  for (const subtask of status.subtasks) expect(subtask.state.startsWith('COMPLETED')).toBe(true);
});

it('reuses a mission on a retried idempotency key instead of queuing it twice', () => {
  const first = startMission({ task: 'Review the python code.', workspace_id: 'mission-retry', idempotency_key: 'retry-key-1' });
  const second = startMission({ task: 'Review the python code.', workspace_id: 'mission-retry', idempotency_key: 'retry-key-1' });
  expect(second.mission_id).toBe(first.mission_id);
  expect(second.reused).toBe(true);
  expect(getMissionTasks(first.mission_id).length).toBe(first.task_ids.length);

  expect(() =>
    startMission({ task: 'A different mission entirely.', workspace_id: 'mission-retry', idempotency_key: 'retry-key-1' })
  ).toThrow(/idempotency/i);
});
