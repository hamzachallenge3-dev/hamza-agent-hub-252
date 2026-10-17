import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { redactSecrets } from '../security/redact.js';
import { legacyToState, TASK_STATES, type TaskState } from '../runtime/states.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';

export interface TaskRow {
  attempts?: number;
  available_at?: number;
  /**
   * Richer lifecycle state (see runtime/states.ts). `status` stays as it was
   * so existing consumers are unaffected; `state` distinguishes a verified
   * completion from a limited one.
   */
  state?: string | null;
  verified?: number;
  /** Action awaiting a human decision, recorded but not executed. */
  pending_approval?: string | null;
  /** A single granted authorisation, consumed on use. */
  approved_action?: string | null;
  /** Groups the subtasks of one Boss mission. Null for a single-agent task. */
  mission_id?: string | null;
  /** JSON array of task ids that must finish before this one may be claimed. */
  depends_on?: string | null;
  /** The role the Boss assigned, kept so a mission reads as a plan. */
  role?: string | null;
  capability?: string | null;
  id: string;
  agent_id: string;
  workspace_id: string;
  idempotency_key: string;
  task: string;
  status: TaskStatus;
  progress: number;
  progress_message: string;
  output: string | null;
  error: string | null;
  evidence: string | null;
  tool_log: string | null;
  artifacts: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      progress_message TEXT NOT NULL DEFAULT '',
      output TEXT, error TEXT, evidence TEXT, tool_log TEXT, artifacts TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, finished_at INTEGER,
      UNIQUE(agent_id, workspace_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  const columns = new Set((db.prepare('PRAGMA table_info(tasks)').all() as Array<{name: string}>).map(c => c.name));
  if (!columns.has('attempts')) db.exec('ALTER TABLE tasks ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('available_at')) db.exec('ALTER TABLE tasks ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0');
  // Additive migration: existing rows keep their status and get a derived state.
  if (!columns.has('state')) db.exec("ALTER TABLE tasks ADD COLUMN state TEXT");
  if (!columns.has('verified')) db.exec('ALTER TABLE tasks ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  // Human approval checkpoints. Persisted rather than held in memory so a
  // restart between request and decision cannot resume privileged work.
  if (!columns.has('pending_approval')) db.exec('ALTER TABLE tasks ADD COLUMN pending_approval TEXT');
  if (!columns.has('approved_action')) db.exec('ALTER TABLE tasks ADD COLUMN approved_action TEXT');
  // Multi-agent missions. A single-agent task leaves all four null and behaves
  // exactly as before, so existing rows need no backfill.
  if (!columns.has('mission_id')) db.exec('ALTER TABLE tasks ADD COLUMN mission_id TEXT');
  if (!columns.has('depends_on')) db.exec('ALTER TABLE tasks ADD COLUMN depends_on TEXT');
  if (!columns.has('role')) db.exec('ALTER TABLE tasks ADD COLUMN role TEXT');
  if (!columns.has('capability')) db.exec('ALTER TABLE tasks ADD COLUMN capability TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS mission_members ON tasks(mission_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS queue_ready ON tasks(status, available_at, created_at)');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function insertTask(row: TaskRow): TaskRow {
  getDb()
    .prepare(
      `INSERT INTO tasks (id,agent_id,workspace_id,idempotency_key,task,status,state,progress,progress_message,output,error,evidence,tool_log,artifacts,created_at,updated_at,started_at,finished_at,mission_id,depends_on,role,capability)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.id, row.agent_id, row.workspace_id, row.idempotency_key, row.task, row.status, row.state ?? null,
      row.progress, row.progress_message, row.output, row.error, row.evidence, row.tool_log,
      row.artifacts, row.created_at, row.updated_at, row.started_at, row.finished_at,
      row.mission_id ?? null, row.depends_on ?? null, row.role ?? null, row.capability ?? null
    );
  return getTask(row.id)!;
}

export function findByIdempotency(agentId: string, workspaceId: string, key: string): TaskRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM tasks WHERE agent_id=? AND workspace_id=? AND idempotency_key=?`)
      .get(agentId, workspaceId, key) as TaskRow | undefined) ?? null
  );
}

export function getTask(id: string): TaskRow | null {
  return (getDb().prepare(`SELECT * FROM tasks WHERE id=?`).get(id) as TaskRow | undefined) ?? null;
}

export function updateTask(id: string, patch: Partial<TaskRow>): TaskRow {
  const current = getTask(id);
  if (!current) throw new Error(`task not found: ${id}`);
  if (['completed', 'failed', 'cancelled', 'dead_letter'].includes(current.status)) return current;
  const next = { ...current, ...patch, updated_at: Date.now() };
  getDb()
    .prepare(
      `UPDATE tasks SET status=?, state=?, verified=?, progress=?, progress_message=?, output=?, error=?, evidence=?, tool_log=?, artifacts=?, updated_at=?, started_at=?, finished_at=?, attempts=?, available_at=?, pending_approval=?, approved_action=? WHERE id=?`
    )
    .run(
      next.status, next.state ?? null, next.verified ?? 0, next.progress, next.progress_message, next.output,
      next.error, next.evidence, next.tool_log, next.artifacts, next.updated_at, next.started_at,
      next.finished_at, next.attempts ?? 0, next.available_at ?? 0,
      next.pending_approval ?? null, next.approved_action ?? null, id
    );
  return getTask(id)!;
}

/** The lifecycle state for a row, derived for rows written before the column existed. */
export function taskState(row: TaskRow): TaskState {
  if (row.state && (TASK_STATES as readonly string[]).includes(row.state)) return row.state as TaskState;
  return legacyToState(row.status);
}

export function appendEvent(taskId: string, kind: string, payload: unknown): void {
  getDb()
    .prepare(`INSERT INTO events (task_id, kind, payload, created_at) VALUES (?,?,?,?)`)
    .run(taskId, kind, redactSecrets(payload), Date.now());
}

export function listEvents(taskId: string) {
  return getDb()
    .prepare(`SELECT id, kind, payload, created_at FROM events WHERE task_id=? ORDER BY id ASC`)
    .all(taskId) as Array<{ id: number; kind: string; payload: string; created_at: number }>;
}

/** Every task belonging to one mission, in planned order. */
export function getMissionTasks(missionId: string): TaskRow[] {
  return getDb()
    .prepare(`SELECT * FROM tasks WHERE mission_id=? ORDER BY created_at ASC`)
    .all(missionId) as unknown as TaskRow[];
}

export function dependsOn(row: TaskRow): string[] {
  if (!row.depends_on) return [];
  try {
    const parsed = JSON.parse(row.depends_on) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function claimNextQueued(): TaskRow | null {
  const row = claimable();
  if (!row) return null;
  const now = Date.now();
  const result = getDb()
    .prepare(`UPDATE tasks SET status='running', attempts=attempts+1, started_at=?, updated_at=?, progress_message='claimed' WHERE id=? AND status='queued'`)
    .run(now, now, row.id);
  if (result.changes === 0) return null;
  return getTask(row.id);
}

/**
 * The first queued task whose dependencies are all satisfied.
 *
 * A dependent task stays `queued` so it remains claimable, but its state moves
 * to WAITING_FOR_DEPENDENCY so the plan reads honestly, and a task whose
 * dependency failed is failed rather than left waiting forever on work that is
 * never coming.
 */
function claimable(): TaskRow | null {
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE status='queued' AND available_at<=? ORDER BY created_at ASC LIMIT 200`)
    .all(Date.now()) as unknown as TaskRow[];
  for (const row of rows) {
    const deps = dependsOn(row);
    if (!deps.length) return row;
    const states = deps.map((id) => {
      const dep = getTask(id);
      return dep ? taskState(dep) : 'FAILED';
    });
    const broken = states.filter((s) => ['FAILED', 'BLOCKED', 'CANCELLED'].includes(s));
    if (broken.length) {
      updateTask(row.id, {
        status: 'failed',
        state: 'BLOCKED',
        progress: 1,
        progress_message: `blocked: a dependency ended ${broken[0]}`,
        error: `dependency did not complete: ${broken.join(', ')}`,
        finished_at: Date.now(),
      });
      appendEvent(row.id, 'dependency_broken', { depends_on: deps, states });
      continue;
    }
    if (states.every((s) => s === 'COMPLETED_VERIFIED' || s === 'COMPLETED_LIMITED')) return row;
    if (taskState(row) !== 'WAITING_FOR_DEPENDENCY') {
      updateTask(row.id, { state: 'WAITING_FOR_DEPENDENCY', progress_message: 'waiting for a dependency' });
    }
  }
  return null;
}

export function requeueInterrupted(): number {
  return Number(
    getDb()
      .prepare(`UPDATE tasks SET status=CASE WHEN attempts>=? THEN 'dead_letter' ELSE 'queued' END, progress_message='recovered after restart', updated_at=? WHERE status='running'`)
      .run(config.maxAttempts, Date.now()).changes ?? 0
  );
}

export function taskQueueSummary() {
  return getDb().prepare('SELECT status, count(*) AS count FROM tasks GROUP BY status').all();
}
