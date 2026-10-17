/**
 * Task lifecycle states.
 *
 * The runtime previously had one success state, `completed`, which was written
 * whether the agent produced a real result or an "offline scaffold" string. A
 * placeholder is no longer a success: work only reaches COMPLETED_VERIFIED when
 * it carries evidence, otherwise COMPLETED_LIMITED.
 *
 * Existing consumers (ChatGPT connector, task_status readers) still receive the
 * legacy `status` value; the richer state travels alongside as `state`.
 */

export const TASK_STATES = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_DEPENDENCY',
  'WAITING_FOR_APPROVAL',
  'COMPLETED_VERIFIED',
  'COMPLETED_LIMITED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/** Legacy statuses persisted in the tasks table; unchanged on disk. */
export type LegacyStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';

export const TERMINAL_STATES: TaskState[] = [
  'COMPLETED_VERIFIED',
  'COMPLETED_LIMITED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
];

/**
 * Backward compatibility: every new state maps onto a legacy status, so a
 * client that only understands `completed` keeps working. Both completion
 * states map to `completed` because both finished without error — the
 * difference is whether the output was verified, which `state` carries.
 */
export const STATE_TO_LEGACY: Record<TaskState, LegacyStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_FOR_DEPENDENCY: 'queued',
  WAITING_FOR_APPROVAL: 'queued',
  COMPLETED_VERIFIED: 'completed',
  COMPLETED_LIMITED: 'completed',
  BLOCKED: 'failed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/** Derive a state for rows written before the state column existed. */
export function legacyToState(status: LegacyStatus): TaskState {
  switch (status) {
    case 'queued':
      return 'QUEUED';
    case 'running':
      return 'RUNNING';
    case 'completed':
      // Unknown provenance: never claim verification retroactively.
      return 'COMPLETED_LIMITED';
    case 'cancelled':
      return 'CANCELLED';
    case 'dead_letter':
    case 'failed':
    default:
      return 'FAILED';
  }
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

const ALLOWED: Record<TaskState, TaskState[]> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'BLOCKED', 'FAILED', 'WAITING_FOR_DEPENDENCY', 'WAITING_FOR_APPROVAL'],
  RUNNING: [
    'COMPLETED_VERIFIED',
    'COMPLETED_LIMITED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
    'QUEUED',
    'WAITING_FOR_DEPENDENCY',
    'WAITING_FOR_APPROVAL',
  ],
  WAITING_FOR_DEPENDENCY: ['QUEUED', 'RUNNING', 'CANCELLED', 'FAILED', 'BLOCKED'],
  WAITING_FOR_APPROVAL: ['QUEUED', 'RUNNING', 'CANCELLED', 'FAILED', 'BLOCKED'],
  COMPLETED_VERIFIED: [],
  COMPLETED_LIMITED: [],
  BLOCKED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new Error(`illegal task transition ${from} -> ${to}`);
  }
}
