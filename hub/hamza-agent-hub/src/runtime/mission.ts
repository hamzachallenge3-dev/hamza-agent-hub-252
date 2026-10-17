/**
 * Multi-agent mission execution (Part 2, requirements 4–13).
 *
 * The Boss already produced a decomposition with owners, capabilities and
 * dependencies, but nothing ever ran it: `POST /v1/missions` queued the primary
 * agent alone and the other subtasks existed only on paper. A mission now
 * becomes one queued task per subtask, wired to the dependencies the plan
 * declared, executed with the same bounded concurrency as everything else, and
 * assembled into a single report when the last subtask reaches a terminal
 * state.
 *
 * Assembly is deterministic on purpose. Summarising the mission with the model
 * would make the final report a model output — exactly the kind of unverifiable
 * completion the rest of this work exists to remove.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendEvent,
  getDb,
  getMissionTasks,
  getTask,
  taskState,
  type TaskRow,
} from '../storage/db.js';
import { ensureWorkspace, resolveSafePath } from '../security/workspace.js';
import { redactSecrets } from '../security/redact.js';
import { planWithBoss, type HubPlan } from './boss.js';
import { profileFor } from './capabilities.js';
import { enqueueSubtask, startQueue } from './queue.js';
import { TASK_STATES, type TaskState } from './states.js';

export interface MissionRow {
  id: string;
  task: string;
  workspace_id: string;
  idempotency_key: string;
  plan: string;
  state: string;
  report: string | null;
  created_at: number;
  finished_at: number | null;
}

function ensureMissionTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL,
      state TEXT NOT NULL,
      report TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
}

export function getMission(id: string): MissionRow | null {
  ensureMissionTable();
  return (getDb().prepare('SELECT * FROM missions WHERE id=?').get(id) as MissionRow | undefined) ?? null;
}

function missionByKey(key: string): MissionRow | null {
  ensureMissionTable();
  return (getDb().prepare('SELECT * FROM missions WHERE idempotency_key=?').get(key) as MissionRow | undefined) ?? null;
}

export interface MissionStart {
  mission_id: string;
  reused: boolean;
  plan: HubPlan;
  task_ids: string[];
}

/**
 * Plan a mission and queue every subtask in it.
 *
 * A subtask whose owner is BLOCKED is not queued: assigning work to an agent
 * that cannot run it is the false-completion problem in another costume. It is
 * recorded on the mission as an unassigned subtask instead.
 */
export function startMission(input: {
  task: string;
  workspace_id: string;
  idempotency_key: string;
}): MissionStart {
  ensureMissionTable();
  const existing = missionByKey(input.idempotency_key);
  if (existing) {
    if (existing.task !== input.task) throw new Error('idempotency key already used for another mission');
    return {
      mission_id: existing.id,
      reused: true,
      plan: JSON.parse(existing.plan) as HubPlan,
      task_ids: getMissionTasks(existing.id).map((t) => t.id),
    };
  }

  const plan = planWithBoss(input.task);
  const missionId = randomUUID();
  const now = Date.now();
  ensureWorkspace(input.workspace_id);

  getDb()
    .prepare(
      'INSERT INTO missions (id,task,workspace_id,idempotency_key,plan,state,report,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(missionId, input.task, input.workspace_id, input.idempotency_key, redactSecrets(plan), 'QUEUED', null, now, null);

  startQueue();
  // Plan ids (t1, t2, …) have to become real task ids before a dependant can
  // reference them, which is why subtasks are created in planned order.
  const idMap = new Map<string, string>();
  const taskIds: string[] = [];
  for (const subtask of plan.decomposition) {
    if (profileFor(subtask.agent_id)?.readiness === 'BLOCKED') {
      appendEvent(missionId, 'subtask_unassigned', {
        role: subtask.role,
        agent_id: subtask.agent_id,
        reason: profileFor(subtask.agent_id)?.readiness_reason ?? 'agent is BLOCKED',
      });
      continue;
    }
    const dependsOn = subtask.depends_on.map((planId) => idMap.get(planId)).filter((id): id is string => Boolean(id));
    const queued = enqueueSubtask({
      agent_id: subtask.agent_id,
      task: subtask.subtask,
      workspace_id: input.workspace_id,
      idempotency_key: `${input.idempotency_key}:${subtask.id}`,
      mission_id: missionId,
      depends_on: dependsOn,
      role: subtask.role,
      capability: subtask.capability,
    });
    idMap.set(subtask.id, queued.task_id);
    taskIds.push(queued.task_id);
  }

  appendEvent(missionId, 'mission_started', {
    primary: plan.primary,
    subtasks: taskIds.length,
    planned: plan.decomposition.length,
    constraints: plan.constraints.length,
  });

  return { mission_id: missionId, reused: false, plan, task_ids: taskIds };
}

export interface MissionStatus {
  mission_id: string;
  task: string;
  state: TaskState;
  verified: boolean;
  progress: number;
  /** The subtask currently executing, so the console can name the worker. */
  active_agent: string | null;
  subtasks: Array<{
    task_id: string;
    role: string;
    capability: string | null;
    agent_id: string;
    state: TaskState;
    verified: boolean;
    depends_on: string[];
    progress_message: string;
    error: string | null;
    artifacts: string[];
  }>;
  constraints: HubPlan['constraints'];
  capability_gaps: HubPlan['capability_gaps'];
  /** Subtasks the plan produced but which no assignable agent could take. */
  unassigned: number;
  artifacts: string[];
  report: string | null;
}

/**
 * Aggregate a mission from its subtasks.
 *
 * The rules are deliberately pessimistic: a mission is only verified when every
 * subtask is, and one blocked subtask blocks the mission. Reporting the best
 * subtask's state as the mission's would recreate the false completions this
 * whole effort is about.
 */
export function missionStatus(missionId: string): MissionStatus | null {
  const mission = getMission(missionId);
  if (!mission) return null;
  const rows = getMissionTasks(missionId);
  const plan = JSON.parse(mission.plan) as HubPlan;

  const subtasks = rows.map((row) => ({
    task_id: row.id,
    role: row.role ?? 'worker',
    capability: row.capability ?? null,
    agent_id: row.agent_id,
    state: taskState(row),
    verified: row.verified === 1,
    depends_on: row.depends_on ? (JSON.parse(row.depends_on) as string[]) : [],
    progress_message: row.progress_message,
    error: row.error,
    artifacts: parseArtifacts(row),
  }));

  const states = subtasks.map((s) => s.state);
  const state = aggregate(states);
  const terminal = isTerminal(state);

  if (terminal && mission.state !== state) finalise(mission, state, subtasks);
  const stored = getMission(missionId)!;

  return {
    mission_id: missionId,
    task: mission.task,
    state,
    verified: subtasks.length > 0 && subtasks.every((s) => s.verified),
    progress: subtasks.length ? states.filter((s) => isTerminal(s)).length / subtasks.length : 0,
    active_agent: subtasks.find((s) => s.state === 'RUNNING')?.agent_id ?? null,
    subtasks,
    constraints: plan.constraints,
    capability_gaps: plan.capability_gaps,
    unassigned: plan.decomposition.length - rows.length,
    artifacts: subtasks.flatMap((s) => s.artifacts),
    report: stored.report,
  };
}

function parseArtifacts(row: TaskRow): string[] {
  if (!row.artifacts) return [];
  try {
    const parsed = JSON.parse(row.artifacts) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isTerminal(state: TaskState): boolean {
  return ['COMPLETED_VERIFIED', 'COMPLETED_LIMITED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(state);
}

function aggregate(states: TaskState[]): TaskState {
  if (!states.length) return 'BLOCKED';
  if (states.includes('WAITING_FOR_APPROVAL')) return 'WAITING_FOR_APPROVAL';
  if (states.includes('RUNNING')) return 'RUNNING';
  if (states.some((s) => !isTerminal(s))) {
    return states.every((s) => s === 'WAITING_FOR_DEPENDENCY') ? 'WAITING_FOR_DEPENDENCY' : 'QUEUED';
  }
  if (states.includes('CANCELLED')) return 'CANCELLED';
  if (states.includes('FAILED')) return 'FAILED';
  if (states.includes('BLOCKED')) return 'BLOCKED';
  return states.every((s) => s === 'COMPLETED_VERIFIED') ? 'COMPLETED_VERIFIED' : 'COMPLETED_LIMITED';
}

/** Write the assembled report once, on the transition into a terminal state. */
function finalise(mission: MissionRow, state: TaskState, subtasks: MissionStatus['subtasks']): void {
  const report = assemble(mission, state, subtasks);
  let artifact: string | null = null;
  try {
    const root = ensureWorkspace(mission.workspace_id);
    const rel = path.posix.join('artifacts', `mission-${mission.id}.md`);
    const abs = resolveSafePath(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, report);
    artifact = rel;
  } catch {
    // The report still lives on the mission row; losing the file copy must not
    // leave the mission stuck in a non-terminal state.
  }
  getDb()
    .prepare('UPDATE missions SET state=?, report=?, finished_at=? WHERE id=?')
    .run(state, report, Date.now(), mission.id);
  appendEvent(mission.id, 'mission_finished', { state, subtasks: subtasks.length, artifact });
}

function assemble(mission: MissionRow, state: TaskState, subtasks: MissionStatus['subtasks']): string {
  const plan = JSON.parse(mission.plan) as HubPlan;
  const lines = [
    `# Mission ${mission.id}`,
    '',
    `**Request:** ${mission.task}`,
    `**Outcome:** ${state}`,
    `**Verified:** ${subtasks.length > 0 && subtasks.every((s) => s.verified) ? 'yes' : 'no'}`,
    '',
    '## Constraints applied to every subtask',
    ...(plan.constraints.length
      ? plan.constraints.map((c) => `- [${c.kind}] ${c.text}`)
      : ['- none extracted from the request']),
    '',
    '## Subtasks',
  ];
  for (const s of subtasks) {
    lines.push(
      '',
      `### ${s.role} — ${s.agent_id}`,
      `- capability: ${s.capability ?? 'unclassified'}`,
      `- state: ${s.state}${s.verified ? ' (verified)' : ''}`,
      ...(s.error ? [`- error: ${s.error}`] : []),
      ...(s.artifacts.length ? [`- artifacts: ${s.artifacts.join(', ')}`] : ['- artifacts: none']),
    );
    const output = getTask(s.task_id)?.output;
    if (output) lines.push('', '```', output.slice(0, 4_000), '```');
  }
  if (plan.capability_gaps.length) {
    lines.push('', '## Capability gaps', ...plan.capability_gaps.map((g) => `- ${g.capability}: ${g.reason}`));
  }
  const unassigned = plan.decomposition.length - subtasks.length;
  if (unassigned > 0) {
    lines.push('', `## Unassigned subtasks`, `- ${unassigned} planned subtask(s) had no assignable agent and were not run.`);
  }
  return redactSecrets(lines.join('\n'));
}

/** Mission ids are UUIDs, as are task ids, so callers disambiguate by lookup. */
export function isMissionId(id: string): boolean {
  return getMission(id) !== null;
}

export function missionLegacyState(state: string): boolean {
  return (TASK_STATES as readonly string[]).includes(state);
}
