/**
 * Evidence grading.
 *
 * `executeTask` used to mark every non-throwing run `completed`, so an agent
 * whose entire output was "Offline scaffold for X; specialist analysis requires
 * a live model" was indistinguishable from a real result. A run is only
 * verified when it produced evidence a human could check: a real model turn,
 * or a deterministic tool that actually did something.
 */
import type { TaskState } from './states.js';

/** Marker a provider sets when its content is generated without a live model. */
export const SCAFFOLD_MARKER = 'hub:scaffold';

const SCAFFOLD_PHRASES = [
  'offline scaffold',
  'specialist analysis requires a live model',
  'completed_offline',
  'mode":"heuristic',
  'mode": "heuristic',
];

export interface EvidenceInput {
  /** `model:<provider>:<step>` and `tool:<name>:<ok|fail>` lines. */
  evidence: string[];
  toolLog: Array<{ tool: string; ok: boolean; output?: string }>;
  artifacts: string[];
  output: string;
  /** True when every model turn came from the offline heuristic path. */
  scaffoldOnly: boolean;
  /** Set when the agent itself reported it cannot proceed. */
  blockedReason?: string | null;
}

export interface Verdict {
  state: Extract<TaskState, 'COMPLETED_VERIFIED' | 'COMPLETED_LIMITED' | 'BLOCKED'>;
  verified: boolean;
  reasons: string[];
  /** Evidence the verdict rests on, for audit. */
  proof: string[];
}

/** Tools whose success is real work rather than inspection of an empty dir. */
function isSubstantiveTool(entry: { tool: string; ok: boolean; output?: string }): boolean {
  if (!entry.ok) return false;
  // Listing an empty workspace proves nothing.
  if (entry.tool === 'workspace_list') {
    const out = (entry.output ?? '').trim();
    return out !== '' && out !== '[]';
  }
  if (entry.tool === 'workspace_grep') {
    return !(entry.output ?? '').includes('(no matches)');
  }
  return true;
}

export function looksLikeScaffold(output: string): boolean {
  const lower = output.toLowerCase();
  if (lower.includes(SCAFFOLD_MARKER)) return true;
  return SCAFFOLD_PHRASES.some((p) => lower.includes(p));
}

export function gradeRun(input: EvidenceInput): Verdict {
  const reasons: string[] = [];
  const proof: string[] = [];

  if (input.blockedReason) {
    return {
      state: 'BLOCKED',
      verified: false,
      reasons: [input.blockedReason],
      proof: input.evidence.slice(0, 20),
    };
  }

  const liveModelTurns = input.evidence.filter(
    (e) => e.startsWith('model:') && !e.startsWith('model:heuristic')
  );
  const substantiveTools = input.toolLog.filter(isSubstantiveTool);
  const scaffoldOutput = looksLikeScaffold(input.output);

  if (liveModelTurns.length) proof.push(...liveModelTurns.slice(0, 5));
  if (substantiveTools.length) proof.push(...substantiveTools.slice(0, 5).map((t) => `tool:${t.tool}:ok`));
  if (input.artifacts.length) proof.push(...input.artifacts.slice(0, 5).map((a) => `artifact:${a}`));

  if (scaffoldOutput) {
    reasons.push('output is an offline scaffold, not specialist analysis');
  }
  if (input.scaffoldOnly && !liveModelTurns.length) {
    reasons.push('no live model turn: every reasoning step came from the offline heuristic');
  }
  if (!substantiveTools.length) {
    reasons.push('no tool produced a substantive result');
  }

  // Verified needs real reasoning *or* real deterministic work, and an output
  // that is not a placeholder.
  const verified = !scaffoldOutput && (liveModelTurns.length > 0 || substantiveTools.length > 0);

  if (verified) {
    return {
      state: 'COMPLETED_VERIFIED',
      verified: true,
      reasons: liveModelTurns.length
        ? ['live model reasoning with checkable output']
        : ['deterministic tool execution produced a checkable result'],
      proof,
    };
  }

  return {
    state: 'COMPLETED_LIMITED',
    verified: false,
    reasons: reasons.length ? reasons : ['insufficient evidence to verify the result'],
    proof,
  };
}

/**
 * An HTTP 200 is not proof that a browser action worked. Callers pass what they
 * observed after the action; this decides whether to claim success.
 */
export function verifyAction(observation: {
  action: string;
  /** Did the page/DOM change in the way the action implies? */
  domChanged: boolean;
  /** Text or selector the caller expected to appear after a successful action. */
  expectation?: string | null;
  expectationMet?: boolean | null;
  error?: string | null;
}): { ok: boolean; verified: boolean; reason: string } {
  if (observation.error) {
    return { ok: false, verified: false, reason: observation.error };
  }
  if (observation.expectation) {
    if (observation.expectationMet) {
      return { ok: true, verified: true, reason: `confirmed: ${observation.expectation} observed after ${observation.action}` };
    }
    return {
      ok: false,
      verified: false,
      reason: `unconfirmed: ${observation.expectation} not observed after ${observation.action}`,
    };
  }
  if (observation.domChanged) {
    return { ok: true, verified: false, reason: `${observation.action} changed the page but no expectation was supplied to confirm it` };
  }
  return { ok: false, verified: false, reason: `${observation.action} produced no observable change` };
}
