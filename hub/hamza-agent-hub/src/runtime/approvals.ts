/**
 * Human approval checkpoints (Part 10).
 *
 * `WAITING_FOR_APPROVAL` was declared in the state vocabulary and published in
 * the OpenAPI enum, but nothing ever set it: an action the policy marked as
 * needing sign-off simply ran. A task now parks in that state with the exact
 * pending action recorded, and only an explicit decision releases it.
 *
 * The pending action is stored on the task row so a restart cannot lose it and
 * silently resume privileged work.
 */
import { getTask, updateTask, appendEvent, taskState } from '../storage/db.js';
import { assertTransition, STATE_TO_LEGACY } from './states.js';
import { redactSecrets } from '../security/redact.js';

export interface PendingApproval {
  /** Tool the agent tried to call. */
  tool: string;
  /** Human-readable description of what will happen if approved. */
  describe: string;
  /** Why approval is required. */
  reason: string;
  requested_at: number;
}

export interface ApprovalDecision {
  approved: boolean;
  /** Who decided. Recorded for the audit trail; never a credential. */
  actor: string;
  note?: string;
}

/**
 * Parks a task awaiting a human decision. The pending action is recorded but
 * never executed, so a crash between request and decision cannot resume it.
 */
export function requestApproval(taskId: string, pending: Omit<PendingApproval, 'requested_at'>): PendingApproval {
  const task = getTask(taskId);
  if (!task) throw new Error(`missing task ${taskId}`);
  assertTransition(taskState(task), 'WAITING_FOR_APPROVAL');

  const record: PendingApproval = { ...pending, requested_at: Date.now() };
  updateTask(taskId, {
    status: STATE_TO_LEGACY.WAITING_FOR_APPROVAL,
    state: 'WAITING_FOR_APPROVAL',
    progress_message: `awaiting approval: ${pending.describe}`.slice(0, 200),
    pending_approval: redactSecrets(record),
  });
  appendEvent(taskId, 'approval_requested', record);
  return record;
}

export function pendingApproval(taskId: string): PendingApproval | null {
  const task = getTask(taskId);
  if (!task?.pending_approval) return null;
  try {
    return JSON.parse(task.pending_approval) as PendingApproval;
  } catch {
    return null;
  }
}

/**
 * Records a human decision. Approving returns the task to the queue so the
 * agent can retry the action; declining fails it with the reason, because
 * continuing past a refused action would defeat the checkpoint.
 */
export function resolveApproval(taskId: string, decision: ApprovalDecision): { state: string; pending: PendingApproval } {
  const task = getTask(taskId);
  if (!task) throw new Error(`missing task ${taskId}`);
  const pending = pendingApproval(taskId);
  if (!pending) throw new Error(`task ${taskId} is not awaiting approval`);

  const next = decision.approved ? 'QUEUED' : 'CANCELLED';
  assertTransition('WAITING_FOR_APPROVAL', next);
  updateTask(taskId, {
    status: STATE_TO_LEGACY[next],
    state: next,
    pending_approval: null,
    // Approval authorises exactly one attempt of exactly this action.
    approved_action: decision.approved ? redactSecrets({ tool: pending.tool, describe: pending.describe }) : null,
    progress_message: decision.approved ? 'approved; requeued' : 'approval declined',
    finished_at: decision.approved ? null : Date.now(),
    error: decision.approved ? null : `approval declined for ${pending.describe}`,
  });
  appendEvent(taskId, decision.approved ? 'approval_granted' : 'approval_declined', {
    actor: decision.actor,
    note: decision.note ?? null,
    pending,
  });
  return { state: next, pending };
}

/**
 * True when a human already authorised this exact tool for this task. Consumed
 * once: a single approval must not become a standing permission.
 */
export function consumeApproval(taskId: string, tool: string): boolean {
  const task = getTask(taskId);
  if (!task?.approved_action) return false;
  try {
    const approved = JSON.parse(task.approved_action) as { tool: string };
    if (approved.tool !== tool) return false;
  } catch {
    return false;
  }
  updateTask(taskId, { approved_action: null });
  appendEvent(taskId, 'approval_consumed', { tool });
  return true;
}
