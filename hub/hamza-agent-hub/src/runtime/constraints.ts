/**
 * Constraint extraction and propagation.
 *
 * The old planner split a mission on `then` / `;` / newline and routed every
 * clause as if it were work. A clause like "do not execute or use paid
 * services" therefore became its own subtask assigned to one agent, and the
 * other agents never saw the restriction. Constraints are now lifted out of the
 * mission *before* decomposition and re-attached to every subtask.
 */

export type ConstraintKind =
  | 'no_execution'
  | 'no_spend'
  | 'no_send'
  | 'no_write'
  | 'offline'
  | 'scope_limit'
  | 'approval_required'
  | 'other';

export interface Constraint {
  kind: ConstraintKind;
  /** The user's own words, preserved verbatim so nothing is paraphrased away. */
  text: string;
  /** Always true: a user restriction binds every delegated subtask. */
  global: boolean;
}

interface Rule {
  kind: ConstraintKind;
  match: RegExp;
}

/**
 * Sentence-level detectors. Each matches a *restriction*, not a work item.
 * Arabic forms are included because the Hub is used bilingually.
 */
const RULES: Rule[] = [
  { kind: 'no_execution', match: /\b(do\s*not|don'?t|never|without)\b[^.;\n]{0,40}\b(execute|run|exec|invoke)\b/i },
  { kind: 'no_execution', match: /\bno\s+(code\s+)?execution\b/i },
  { kind: 'no_execution', match: /لا\s*(تنفذ|تشغل)/ },
  { kind: 'no_spend', match: /\b(do\s*not|don'?t|never|without|no)\b[^.;\n]{0,40}\b(paid|pay|purchase|spend|billing|credits?|subscription|premium)\b/i },
  { kind: 'no_spend', match: /\bfree[- ]?(only|tier only|plans? only)\b/i },
  { kind: 'no_spend', match: /\bzero\s+spend|no\s+budget\b/i },
  { kind: 'no_spend', match: /بدون\s*(دفع|تكلفة|مصاريف)/ },
  { kind: 'no_send', match: /\b(do\s*not|don'?t|never)\b[^.;\n]{0,40}\b(send|email|post|publish|message|tweet|submit)\b/i },
  { kind: 'no_send', match: /لا\s*(ترسل|تنشر)/ },
  { kind: 'no_write', match: /\b(do\s*not|don'?t|never)\b[^.;\n]{0,40}\b(modify|change|edit|delete|overwrite|write to)\b/i },
  { kind: 'no_write', match: /\bread[- ]only\b/i },
  { kind: 'offline', match: /\b(offline|no\s+(internet|network|external)\s+(access|calls?)|local[- ]only)\b/i },
  { kind: 'approval_required', match: /\b(ask|require|request)\b[^.;\n]{0,30}\b(approval|permission|confirm)/i },
  { kind: 'approval_required', match: /\bonly\s+(after|with)\b[^.;\n]{0,30}\b(approval|my\s+yes|permission)\b/i },
  { kind: 'scope_limit', match: /\bonly\b[^.;\n]{0,60}\b(repo|repository|directory|folder|file|branch|domain|site)\b/i },
  { kind: 'scope_limit', match: /\b(do\s*not|don'?t|never)\b[^.;\n]{0,40}\b(touch|access)\b/i },
];

/**
 * Every restriction a clause expresses. "Do not execute or use paid services"
 * is both `no_execution` and `no_spend`; returning only the first would drop
 * half the user's rule.
 */
function classify(sentence: string): ConstraintKind[] {
  const kinds: ConstraintKind[] = [];
  for (const rule of RULES) {
    if (rule.match.test(sentence) && !kinds.includes(rule.kind)) kinds.push(rule.kind);
  }
  return kinds;
}

/** Split into sentences/clauses while keeping the original text of each. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+|[;؛\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface MissionText {
  /** Mission with constraint sentences removed — only actual work remains. */
  work: string;
  /** Work clauses, already constraint-free. */
  clauses: string[];
  constraints: Constraint[];
}

export function parseMission(task: string): MissionText {
  const parts = sentences(task);
  const constraints: Constraint[] = [];
  const workParts: string[] = [];

  for (const part of parts) {
    const kinds = classify(part);
    if (kinds.length) {
      for (const kind of kinds) constraints.push({ kind, text: part, global: true });
    } else {
      workParts.push(part);
    }
  }

  // A mission that is nothing but restrictions still has to run something;
  // fall back to the full text rather than producing an empty plan.
  const work = workParts.length ? workParts.join(' ') : task.trim();
  const clauses = workParts.length ? splitWork(workParts) : [task.trim()];

  return { work, clauses, constraints };
}

/**
 * Split remaining work into independent clauses. Conjunction splitting happens
 * only inside a sentence that lists several deliverables, so a single
 * instruction is not shredded into fragments.
 */
function splitWork(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const pieces = part
      .split(/\s*,\s*(?:then|and then|and also|and)\s+|\s+(?:then|and then|ثم|وبعدها)\s+/i)
      .map((p) => p.trim().replace(/^(and|then)\s+/i, ''))
      .filter((p) => p.length >= 3);
    if (pieces.length > 1) out.push(...pieces);
    else out.push(part);
  }
  return out.length ? out : parts;
}

/** Render constraints as an instruction block appended to every subtask. */
export function constraintBlock(constraints: Constraint[]): string {
  if (!constraints.length) return '';
  const lines = constraints.map((c) => `- [${c.kind}] ${c.text}`);
  return [
    'MANDATORY CONSTRAINTS (apply to this subtask and anything it delegates):',
    ...lines,
    'If a constraint makes the subtask impossible, stop and report BLOCKED. Never work around it.',
  ].join('\n');
}

/** Attach the full constraint set to a subtask body. */
export function applyConstraints(subtask: string, constraints: Constraint[]): string {
  const block = constraintBlock(constraints);
  return block ? `${subtask}\n\n${block}` : subtask;
}

/**
 * Capabilities a constraint forbids, so the planner never assigns an agent
 * whose only way to help would violate the user's rule.
 */
export function forbiddenCapabilities(constraints: Constraint[]): Set<string> {
  const out = new Set<string>();
  for (const c of constraints) {
    if (c.kind === 'no_execution') out.add('shell.execute');
    if (c.kind === 'offline') {
      out.add('research.web');
      out.add('browser.automate');
    }
  }
  return out;
}
