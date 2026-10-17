import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  appendEvent,
  claimNextQueued,
  findByIdempotency,
  getTask,
  insertTask,
  requeueInterrupted,
  updateTask,
  taskQueueSummary,
  getDb,
  type TaskRow,
} from '../storage/db.js';
import { getAgent } from './registry.js';
import { ensureWorkspace } from '../security/workspace.js';
import { redactSecrets } from '../security/redact.js';
import { executeTask } from './executor.js';

const abortControllers = new Map<string, AbortController>();
const active = new Set<Promise<void>>();
let running = 0;
let pumpTimer: NodeJS.Timeout | null = null;
let started = false;

export function startQueue(): void {
  if (started) return;
  started = true;
  requeueInterrupted();
  pumpTimer = setInterval(() => void pump(), 200);
  void pump();
}

export async function stopQueue(): Promise<void> {
  if (pumpTimer) clearInterval(pumpTimer);
  pumpTimer = null;
  started = false;
  for (const ac of abortControllers.values()) ac.abort();
  await Promise.allSettled([...active]);
}

/**
 * Queue one subtask of a Boss mission.
 *
 * Identical to a single-agent task apart from the mission wiring, so a mission
 * runs through the same queue, concurrency limit, retry policy and executor as
 * everything else rather than a parallel code path of its own.
 */
export function enqueueSubtask(input: {
  agent_id: string;
  task: string;
  workspace_id: string;
  idempotency_key: string;
  mission_id: string;
  depends_on: string[];
  role: string;
  capability: string | null;
}): { task_id: string; reused: boolean; task: TaskRow } {
  return enqueueAgentTask(input);
}

export function enqueueAgentTask(input: {
  agent_id: string;
  task: string;
  workspace_id: string;
  idempotency_key: string;
  mission_id?: string;
  depends_on?: string[];
  role?: string;
  capability?: string | null;
}): { task_id: string; reused: boolean; task: TaskRow } {
  const agent = getAgent(input.agent_id);
  if (!agent) throw new Error(`invalid agent_id: ${input.agent_id}`);
  if (input.task.length > 100_000) throw new Error('task too large / المهمة طويلة جداً');
  if (!input.task?.trim()) throw new Error('task must be a non-empty string');
  if (!input.idempotency_key || input.idempotency_key.length < 4) {
    throw new Error('idempotency_key must be at least 4 characters');
  }
  ensureWorkspace(input.workspace_id);
  const existing = findByIdempotency(input.agent_id, input.workspace_id, input.idempotency_key);
  if (existing) {
    if (existing.task !== input.task) throw new Error('idempotency key already used for another task');
    return { task_id: existing.id, reused: true, task: existing };
  }

  const pending = getDb().prepare("SELECT count(*) AS count FROM tasks WHERE status IN ('queued','running')").get() as {count:number};
  if (pending.count >= config.maxPending) throw new Error('queue full / قائمة الانتظار ممتلئة');
  const id = randomUUID();
  const now = Date.now();
  const waiting = (input.depends_on ?? []).length > 0;
  const task = insertTask({
    id,
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    idempotency_key: input.idempotency_key,
    task: input.task,
    mission_id: input.mission_id ?? null,
    depends_on: input.depends_on?.length ? JSON.stringify(input.depends_on) : null,
    role: input.role ?? null,
    capability: input.capability ?? null,
    status: 'queued',
    // `status` stays queued so the row remains claimable; the richer state says
    // why it is not running yet.
    state: waiting ? 'WAITING_FOR_DEPENDENCY' : 'QUEUED',
    verified: 0,
    progress: 0,
    progress_message: waiting ? 'waiting for a dependency' : 'queued',
    output: null,
    error: null,
    evidence: null,
    tool_log: null,
    artifacts: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  });
  appendEvent(id, 'queued', { agent_id: input.agent_id, pack: agent.pack });
  void pump();
  return { task_id: id, reused: false, task };
}

export function cancelTask(taskId: string): TaskRow {
  const task = getTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (['completed', 'failed', 'cancelled', 'dead_letter'].includes(task.status)) return task;
  abortControllers.get(taskId)?.abort();
  const updated = updateTask(taskId, {
    status: 'cancelled',
    state: 'CANCELLED',
    progress_message: 'cancelled',
    finished_at: Date.now(),
  });
  appendEvent(taskId, 'cancel_requested', {});
  return updated;
}

async function pump(): Promise<void> {
  while (started && running < config.concurrency) {
    const next = claimNextQueued();
    if (!next) return;
    running += 1;
    const ac = new AbortController();
    abortControllers.set(next.id, ac);
    const timeout = setTimeout(() => ac.abort(new Error('task timeout')), config.taskTimeoutMs);
    const job = executeTask(next.id, ac.signal)
      .catch((err) => {
        if (getTask(next.id)?.status === 'cancelled') return;
        const retry = (!ac.signal.aborted || !started) && (next.attempts ?? 0) < config.maxAttempts;
        updateTask(next.id, {
          status: retry ? 'queued' : 'dead_letter',
          state: retry ? 'QUEUED' : 'FAILED',
          error: redactSecrets(err instanceof Error ? err.message : String(err)),
          progress_message: retry ? 'retry scheduled' : 'dead letter: attempts exhausted or timeout',
          available_at: Date.now() + Math.min(30_000, 500 * 2 ** (next.attempts ?? 1)),
          finished_at: retry ? null : Date.now(),
          progress: retry ? 0 : 1,
        });
        appendEvent(next.id, retry ? 'retry' : 'dead_letter', { attempts: next.attempts });
      })
      .finally(() => {
        clearTimeout(timeout);
        abortControllers.delete(next.id);
        running -= 1;
        active.delete(job);
        void pump();
      });
    active.add(job);
  }
}

export function queueStats() {
  return { running, concurrency: config.concurrency, max_attempts: config.maxAttempts, statuses: taskQueueSummary() };
}
