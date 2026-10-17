import { listAgents, PACKS, type AgentDef } from './registry.js';
import {
  agentsWithCapability,
  capabilityIndex,
  profileFor,
  CAPABILITIES,
  type Capability,
  type AgentCapabilityProfile,
} from './capabilities.js';
import { applyConstraints, forbiddenCapabilities, parseMission, type Constraint } from './constraints.js';

export interface PlanSubtask {
  id: string;
  agent_id: string;
  pack: string;
  role: string;
  capability: Capability | null;
  /**
   * Further capabilities this same agent covers. One agent frequently holds
   * several of the capabilities a mission needs, and that is coverage rather
   * than a second subtask.
   */
  covers: Capability[];
  /** Work text with the mandatory constraint block already attached. */
  subtask: string;
  /** Subtask ids that must reach a completion state first. */
  depends_on: string[];
  readiness: string;
  /** True when the subtask is assigned despite imperfect readiness. */
  degraded: boolean;
}

export interface HubPlan {
  orchestrator: string;
  pack: string;
  primary: string;
  secondary: string[];
  rationale: string;
  roster_size: number;
  known_packs: string[];
  considered_top: Array<{ agent_id: string; pack: string; score: number; capability?: string; readiness?: string }>;
  decomposition: PlanSubtask[];
  /** Restrictions lifted out of the mission and applied to every subtask. */
  constraints: Constraint[];
  /** Capabilities the mission needs that no ready agent provides. */
  capability_gaps: Array<{ capability: Capability; reason: string }>;
  required_capabilities: Capability[];
  /**
   * True when the mission matched no intent at all. The plan still routes to a
   * planner, but the caller must treat it as a request for clarification rather
   * than a confident classification.
   */
  unclassified: boolean;
  /** Agents considered but excluded, with the reason — no silent drops. */
  excluded: Array<{ agent_id: string; reason: string }>;
}

/**
 * Mission phrases mapped to the capability they genuinely require. Matching is
 * on intent, so "open the site and click Download" asks for browser.automate
 * rather than scoring every agent whose description contains the word "open".
 */
const INTENT: Array<{ match: RegExp; capability: Capability; weight: number }> = [
  // "log in" alone also matches the filename `login.py`, which is how a Python
  // security review used to be routed to the browser. Require a destination.
  { match: /\b(log|sign) ?in (to|at|on|using)\b/i, capability: 'browser.automate', weight: 30 },
  // Bare "checkout" also matches "checkout code", which routed a code review to
  // the browser. Require the word to name a web surface.
  { match: /\b(checkout (page|flow|form|cart|button)|proceed to checkout)\b/i, capability: 'browser.automate', weight: 30 },
  { match: /\b(navigate|click|screenshot|web ?site|web ?page|on the site|browser automation|infinite scroll|paginat)\b/i, capability: 'browser.automate', weight: 30 },
  { match: /\bfill (in |out )?(the )?(form|field|input|checkout)\b/i, capability: 'browser.automate', weight: 30 },
  { match: /\bdownload (the|a|an)\b[^.]{0,30}\b(from|at|on)\b|\bdownload the invoice\b/i, capability: 'browser.automate', weight: 30 },
  // Naming a web destination is a browser intent regardless of word order.
  // "Download the invoice from the billing page" matched, but the same mission
  // phrased "go to the billing page and download the latest invoice" matched
  // nothing at all and fell through to the planner.
  { match: /\b(go to|open|visit|navigate to|head to)\b[^.]{0,40}\b(page|portal|site|website|dashboard|storefront)\b/i, capability: 'browser.automate', weight: 30 },
  { match: /\buse (a |the )?(web )?browser\b|\bbrowse (to|the web|a site)\b|\bweb automation\b/i, capability: 'browser.automate', weight: 40 },
  { match: /\b(search the web|research|find sources|gather evidence|competitors?|market research|look up online)\b/i, capability: 'research.web', weight: 30 },
  { match: /\b(list|show|browse|catalog|directory) (the )?(agents?|packs?|roster|tools)\b|\bwhich agents\b|\bتصفح الوكلاء\b/i, capability: 'catalog.browse', weight: 35 },
  { match: /\b(review|audit|inspect|critique|check)\b[^.]{0,40}\b(code|codebase|module|function|class|backend|frontend|service|implementation|pull request|pr|diff|repo|script|client|library|package|component|sdk|api|handler|controller|query|file)\b/i, capability: 'code.review', weight: 28 },
  { match: /\b(security|vulnerab|owasp|injection|xss|csrf|secrets? leak|أمان|ثغرات)\b/i, capability: 'security.review', weight: 30 },
  { match: /\b(write|add|create|implement|build|generate)\b[^.]{0,40}\b(tests?|unit tests?|spec)\b/i, capability: 'code.test', weight: 34 },
  { match: /\b(run|execute)\b[^.]{0,20}\btests?\b/i, capability: 'code.test', weight: 30 },
  { match: /\b(plan|design|architect|decompose|break down|roadmap|approach)\b/i, capability: 'plan.architecture', weight: 24 },
  { match: /\b(implement|build|create|write|develop|add)\b[^.]{0,40}\b(api|cli|feature|endpoint|service|module|function|script|app)\b/i, capability: 'code.generate', weight: 28 },
  // "plan the architecture, then implement it" refers back to the design rather
  // than naming a noun, so the implementation step used to be dropped entirely.
  { match: /\b(implement|build|code)\b\s+(it|this|that|the (design|plan|architecture|feature|change))\b/i, capability: 'code.generate', weight: 28 },
  { match: /\b(fix|resolve|repair)\b[^.]{0,30}\b(build|compile|error|failure)\b/i, capability: 'code.build_fix', weight: 30 },
  // The noun list required the word "leads" or "contacts", so "clean the list"
  // — the way a business mission actually phrases it — matched nothing and the
  // cleaning step was silently dropped from the plan.
  { match: /\b(clean|clean up|dedupe|deduplicate|normalise|normalize|de-?duplicate)\b[^.]{0,30}\b(leads?|emails?|contacts?|addresses|list|spreadsheet|records?|rows?)\b|\bتنظيف\b/i, capability: 'data.clean', weight: 34 },
  // Lead sourcing is research before it is anything else.
  { match: /\b(find|source|generate|prospect for)\b[^.]{0,20}\b(new )?(leads?|prospects?|customers?|clients?)\b/i, capability: 'research.web', weight: 30 },
  { match: /\b(csv|tsv|spreadsheet|sheet)\b[^.]{0,30}\b(json|convert|parse|import)\b|\bconvert .{0,20}(csv|sheet)\b/i, capability: 'data.transform', weight: 30 },
  { match: /\b(seo|meta description|canonical|open.?graph|json-?ld|سيو)\b/i, capability: 'seo.audit', weight: 34 },
  { match: /\b(github|gitlab|forge|repository url|repo url|mine (agents|skills|mcp))\b/i, capability: 'forge.inspect', weight: 26 },
  { match: /\bn8n\b|\bworkflow json\b/i, capability: 'workflow.validate', weight: 30 },
  // The window was 20 characters, too short for "compress this 40000 line log
  // into the relevant context", so long-log compaction never matched.
  { match: /\b(compact|compress|condense|summari[sz]e)\b[^.]{0,60}\b(context|logs?|output|transcript|trace)\b|\bheadroom\b/i, capability: 'context.compact', weight: 28 },
  { match: /\b(freellmapi|model gateway|llm endpoint|connect.{0,15}model)\b/i, capability: 'model.gateway', weight: 30 },
  { match: /\b(video|ffmpeg|subtitle|frame extraction|film pack)\b/i, capability: 'media.process', weight: 26 },
  { match: /\b(shell|bash|terminal|command line)\b/i, capability: 'shell.execute', weight: 24 },
  { match: /\b(draft|write|compose)\b[^.]{0,30}\b(email|report|summary|proposal|post|copy|article)\b/i, capability: 'content.write', weight: 26 },
  { match: /\b(coordinate|orchestrate|delegate|assign|multi-?agent)\b/i, capability: 'orchestrate', weight: 22 },
  { match: /\brun an automation\b|\bautomate (this|the|my)\b|\bintegration to run\b/i, capability: 'orchestrate', weight: 22 },
  // Arabic intents are listed separately because `\b` does not form a boundary
  // around Arabic letters, so folding them into the patterns above never matches.
  { match: /أمان|حماية|ثغرات|اختراق/, capability: 'security.review', weight: 30 },
  { match: /تنظيف|إزالة التكرار|ازالة التكرار|جهات الاتصال/, capability: 'data.clean', weight: 34 },
  { match: /تحسين محركات البحث|سيو/, capability: 'seo.audit', weight: 34 },
  { match: /مراجعة (الكود|كود|الشفرة)/, capability: 'code.review', weight: 28 },
  { match: /تصفح الوكلاء|قائمة الوكلاء/, capability: 'catalog.browse', weight: 35 },
  { match: /اختبارات|كتابة اختبار/, capability: 'code.test', weight: 32 },
  { match: /خطة|تصميم معماري|تخطيط/, capability: 'plan.architecture', weight: 24 },
  { match: /بحث على الويب|ابحث في الويب/, capability: 'research.web', weight: 30 },
];

/** Ordering used when several capabilities are needed, so plans read sensibly. */
const ROLE_ORDER: Capability[] = [
  'plan.architecture',
  'research.web',
  'catalog.browse',
  'browser.automate',
  'data.clean',
  'data.transform',
  'code.generate',
  'code.build_fix',
  'code.test',
  'code.review',
  'security.review',
  'seo.audit',
  'forge.inspect',
  'workflow.validate',
  'context.compact',
  'media.process',
  'model.gateway',
  'content.write',
  'shell.execute',
  'orchestrate',
];

/**
 * Every capability needs a label: an unlabelled one fell through to the raw
 * capability id, so a build-fix subtask was shown to the operator as the role
 * "code.build_fix". A test keeps the table complete.
 */
const ROLE_LABEL: Record<Capability, string> = {
  'plan.architecture': 'planner',
  'code.generate': 'implementer',
  'code.build_fix': 'build fixer',
  'code.test': 'tester',
  'code.review': 'reviewer',
  'security.review': 'security reviewer',
  'research.web': 'researcher',
  'browser.automate': 'browser operator',
  'catalog.browse': 'catalog browser',
  'data.clean': 'data cleaner',
  'data.transform': 'data transformer',
  'content.write': 'writer',
  'seo.audit': 'seo auditor',
  'forge.inspect': 'forge analyst',
  'model.gateway': 'model gateway operator',
  'media.process': 'media processor',
  'workflow.validate': 'workflow validator',
  'context.compact': 'context compactor',
  'shell.execute': 'command runner',
  'orchestrate': 'coordinator',
};

/** Capabilities the mission text genuinely asks for, strongest intent first. */
export function requiredCapabilities(task: string): Array<{ capability: Capability; weight: number }> {
  const found = new Map<Capability, number>();
  for (const rule of INTENT) {
    if (rule.match.test(task)) {
      found.set(rule.capability, Math.max(found.get(rule.capability) ?? 0, rule.weight));
    }
  }
  return [...found.entries()]
    .map(([capability, weight]) => ({ capability, weight }))
    .sort((a, b) => b.weight - a.weight || ROLE_ORDER.indexOf(a.capability) - ROLE_ORDER.indexOf(b.capability));
}

function readinessPenalty(profile: AgentCapabilityProfile): number {
  switch (profile.readiness) {
    case 'READY':
      return 0;
    case 'UNTESTED':
      return 2;
    case 'LIMITED':
      return 6;
    case 'BLOCKED':
      return 1000;
  }
}

/** Does the mission name this agent's specialisation (python, react, sql…)? */
function specialisationBonus(profile: AgentCapabilityProfile, task: string): number {
  if (!profile.specialisations.length) return 0;
  const lower = task.toLowerCase();
  const hit = profile.specialisations.some((s) => new RegExp(`\\b${s}\\b`).test(lower));
  if (hit) return 16;
  // A language specialist the mission did not ask for is a poor fit:
  // `ecc-cpp-reviewer` must not tie with `ecc-code-reviewer` on a Python job.
  return -10;
}

/** Words that mark an agent as purpose-built for a capability. */
const ROLE_WORDS: Partial<Record<Capability, RegExp>> = {
  'code.review': /review/i,
  'security.review': /security|vulnerab/i,
  'code.test': /test/i,
  'plan.architecture': /architect|planner|plan/i,
  'code.generate': /generat|builder|writer|explorer|implement|scaffold/i,
  'code.build_fix': /build|resolver|error/i,
  'orchestrate': /boss|chief|orchestrat|coordinat|evaluator/i,
  'research.web': /research|reach|search|scrap/i,
  'browser.automate': /browser|web/i,
  'catalog.browse': /browse|catalog|roster/i,
  'data.clean': /clean|lead|contact|inbox/i,
  'data.transform': /sheet|csv|transform|report/i,
  'content.write': /writer|content|marketing|report|meeting/i,
  'seo.audit': /seo/i,
  'forge.inspect': /forge|github|gitlab|miner/i,
  'model.gateway': /llm|model|gateway/i,
};

/** An agent built for the role outranks one that merely inherited it. */
function roleAffinity(profile: AgentCapabilityProfile, capability: Capability): number {
  const re = ROLE_WORDS[capability];
  if (!re) return 0;
  let score = 0;
  if (re.test(profile.agent_id)) score += 14;
  if (re.test(profile.category)) score += 6;
  return score;
}

export interface CandidateScore {
  profile: AgentCapabilityProfile;
  score: number;
  capability: Capability;
}

/** Rank the agents that genuinely hold `capability` for this mission. */
export function rankForCapability(
  capability: Capability,
  task: string,
  opts: { forbidden?: Set<string>; exclude?: Set<string> } = {}
): CandidateScore[] {
  if (opts.forbidden?.has(capability)) return [];
  const candidates = agentsWithCapability(capability, { executableOnly: true });
  return candidates
    .filter((p) => !opts.exclude?.has(p.agent_id))
    .map((profile) => {
      let score = 40;
      score += roleAffinity(profile, capability);
      score += specialisationBonus(profile, task);
      score -= readinessPenalty(profile);
      // A focused agent beats a grab-bag one.
      score -= Math.max(0, profile.capabilities.length - 3);
      // Exact word from the mission in the id is a weak, late tiebreak only.
      const idWords = profile.agent_id.split('-').filter((w) => w.length >= 4);
      if (idWords.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(task))) score += 3;
      return { profile, score, capability };
    })
    .sort((a, b) => b.score - a.score || a.profile.agent_id.localeCompare(b.profile.agent_id));
}

/**
 * Relevance score for every non-boss agent, reported by `hub_agent_browse` as
 * `ranked_for_query`. The whole roster is always returned — the Boss is meant
 * to see everyone, and a zero score is a real answer ("considered, not a fit").
 * Selection of the executing agents is done by `rankForCapability`, not here.
 */
export function scoreAllAgents(task: string): Array<{ agent: AgentDef; score: number }> {
  const caps = requiredCapabilities(task);
  const forbidden = forbiddenCapabilities(parseMission(task).constraints);
  const scores = new Map<string, number>();
  for (const { capability, weight } of caps) {
    for (const cand of rankForCapability(capability, task, { forbidden })) {
      const prev = scores.get(cand.profile.agent_id) ?? 0;
      scores.set(cand.profile.agent_id, Math.max(prev, cand.score + weight));
    }
  }
  return listAgents()
    .filter((a) => a.id !== 'hub-boss')
    .map((agent) => ({ agent, score: scores.get(agent.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));
}

/**
 * hub-boss planner: understand the goal, lift out constraints, map work to
 * capabilities, pick agents that actually hold them, and keep the restrictions
 * attached to every assignment.
 */
export function planWithBoss(task: string): HubPlan {
  const roster = listAgents();
  const mission = parseMission(task);
  const forbidden = forbiddenCapabilities(mission.constraints);
  const needed = requiredCapabilities(mission.work);

  const excluded: Array<{ agent_id: string; reason: string }> = [];
  const gaps: Array<{ capability: Capability; reason: string }> = [];
  const subtasks: PlanSubtask[] = [];
  const used = new Set<string>();
  const considered: HubPlan['considered_top'] = [];

  // When the user spelled out an order ("clean leads then audit SEO then
  // review"), that sequence wins: it is an instruction, not a hint. Only
  // capabilities the clauses do not place fall back to the canonical
  // plan → build → test → review ordering.
  const clauseRank = clauseOrdering(mission.clauses);
  const ordered = [...needed].sort((a, b) => {
    const ra = clauseRank.get(a.capability);
    const rb = clauseRank.get(b.capability);
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
    return ROLE_ORDER.indexOf(a.capability) - ROLE_ORDER.indexOf(b.capability);
  });

  let previousId: string | null = null;
  for (const { capability } of ordered) {
    if (forbidden.has(capability)) {
      excluded.push({ agent_id: `(capability ${capability})`, reason: 'forbidden by a user constraint' });
      continue;
    }
    const ranked = rankForCapability(capability, mission.work, { forbidden, exclude: used });
    if (!ranked.length) {
      // An agent already assigned may hold this capability too. Excluding it
      // from ranking keeps the plan from giving one agent two subtasks, but it
      // does not mean the capability is missing: reporting a gap for work that
      // is in fact assigned reads as a defect and hides the real gaps.
      const covering = subtasks.find((s) => agentsWithCapability(capability).some((a) => a.agent_id === s.agent_id));
      if (covering) {
        covering.covers.push(capability);
        continue;
      }
      const anyone = agentsWithCapability(capability);
      gaps.push({
        capability,
        reason: anyone.length
          ? `${anyone.length} agent(s) claim ${capability} but none is assignable here (BLOCKED or excluded)`
          : `no registered agent provides ${capability}`,
      });
      continue;
    }
    const best = ranked[0];
    used.add(best.profile.agent_id);
    considered.push(
      ...ranked.slice(0, 3).map((r) => ({
        agent_id: r.profile.agent_id,
        pack: r.profile.pack,
        score: r.score,
        capability,
        readiness: r.profile.readiness,
      }))
    );

    const role = ROLE_LABEL[capability] ?? capability;
    const id = `t${subtasks.length + 1}`;
    // Review and test depend on the work they inspect.
    const dependsOn =
      previousId && ['code.review', 'security.review', 'code.test'].includes(capability) ? [previousId] : [];
    subtasks.push({
      id,
      agent_id: best.profile.agent_id,
      pack: best.profile.pack,
      role,
      capability,
      covers: [],
      subtask: applyConstraints(`[${role}] ${missionClauseFor(capability, mission.clauses, mission.work)}`, mission.constraints),
      depends_on: dependsOn,
      readiness: best.profile.readiness,
      degraded: best.profile.readiness !== 'READY',
    });
    if (!['code.review', 'security.review', 'code.test'].includes(capability)) previousId = id;
  }

  // Nothing matched an intent. A planner is a reasonable first step, but the
  // plan must say the mission was not classified rather than presenting an
  // architecture task as though that is what was asked for.
  const unclassified = needed.length === 0;
  if (!subtasks.length) {
    const planner =
      rankForCapability('plan.architecture', mission.work, { forbidden })[0] ??
      rankForCapability('orchestrate', mission.work, { forbidden })[0];
    if (planner) {
      subtasks.push({
        id: 't1',
        agent_id: planner.profile.agent_id,
        pack: planner.profile.pack,
        role: unclassified ? 'planner (mission not classified)' : 'planner',
        capability: 'plan.architecture',
        covers: [],
        subtask: applyConstraints(
          unclassified
            ? `[planner] The Boss could not match this mission to a known capability. Clarify the goal or restate it before executing.\n\n${mission.work}`
            : `[planner] ${mission.work}`,
          mission.constraints
        ),
        depends_on: [],
        readiness: planner.profile.readiness,
        degraded: planner.profile.readiness !== 'READY',
      });
    }
  }

  for (const profile of capabilityIndex().values()) {
    if (profile.readiness === 'BLOCKED' && needed.some((n) => profile.capabilities.includes(n.capability))) {
      excluded.push({ agent_id: profile.agent_id, reason: `BLOCKED: ${profile.readiness_reason}` });
    }
  }

  const primary = subtasks[0]?.agent_id ?? 'ecc-planner';
  const pack = subtasks[0]?.pack ?? 'ecc68';
  const secondary = subtasks.slice(1).map((s) => s.agent_id);

  const constraintExclusions = excluded.filter((e) => e.reason === 'forbidden by a user constraint').length;
  const rationale = unclassified
    ? `Boss could not match this mission to any of the ${CAPABILITIES.length} known capabilities across ${roster.length} agents; routed for clarification`
    : `Boss mapped the mission to ${ordered.length} capability(ies) and assigned ${subtasks.length} agent(s) from ${roster.length}; ` +
      `${mission.constraints.length} constraint(s) attached to every subtask` +
      (gaps.length ? `; ${gaps.length} capability gap(s)` : '') +
      // A capability the user's own constraints rule out is not a routing
      // failure, but the plan must not read as though the work was covered.
      (constraintExclusions ? `; ${constraintExclusions} capability(ies) withheld by user constraint` : '');

  return {
    orchestrator: 'hub-boss',
    pack,
    primary,
    secondary,
    roster_size: roster.length,
    known_packs: [...new Set(roster.map((a) => a.pack))],
    considered_top: considered.slice(0, 12),
    rationale,
    decomposition: subtasks,
    constraints: mission.constraints,
    capability_gaps: gaps,
    required_capabilities: ordered.map((o) => o.capability),
    /** True when no intent matched; the plan is a request for clarification. */
    unclassified,
    excluded,
  };
}

/**
 * Position of each capability in the user's own clause sequence. Only used when
 * the mission actually lists several clauses; a single instruction carries no
 * ordering information.
 */
function clauseOrdering(clauses: string[]): Map<Capability, number> {
  const rank = new Map<Capability, number>();
  if (clauses.length <= 1) return rank;
  clauses.forEach((clause, index) => {
    for (const { capability } of requiredCapabilities(clause)) {
      if (!rank.has(capability)) rank.set(capability, index);
    }
  });
  return rank;
}

/** Pick the clause that best expresses this role, else the whole mission. */
function missionClauseFor(capability: Capability, clauses: string[], work: string): string {
  if (clauses.length <= 1) return work;
  const scored = clauses
    .map((clause) => {
      const caps = requiredCapabilities(clause);
      const hit = caps.find((c) => c.capability === capability);
      return { clause, weight: hit?.weight ?? 0 };
    })
    .sort((a, b) => b.weight - a.weight);
  return scored[0]?.weight ? scored[0].clause : work;
}

/** Full directory text injected into the hub-boss system prompt. */
export function buildBossDirectory(): string {
  const agents = listAgents();
  const byPack = new Map<string, AgentDef[]>();
  for (const a of agents) {
    const list = byPack.get(a.pack) || [];
    list.push(a);
    byPack.set(a.pack, list);
  }
  const lines: string[] = [
    `# FULL AGENT ROSTER (${agents.length} agents)`,
    'You KNOW every agent below. When routing, pick from this complete directory — never invent IDs.',
    'Each entry shows its real capabilities and runtime readiness. Never assign a BLOCKED agent.',
    '',
  ];
  const index = capabilityIndex();
  for (const pack of PACKS) {
    const list = byPack.get(pack.id) || [];
    lines.push(`## Pack: ${pack.id} — ${pack.name} (${list.length})`);
    lines.push(pack.description);
    for (const a of list) {
      const p = index.get(a.id);
      const caps = p?.capabilities.length ? p.capabilities.join(',') : 'none';
      lines.push(`- ${a.id} [${a.category}] (${p?.readiness ?? 'UNTESTED'}; caps: ${caps}): ${a.description.slice(0, 140)}`);
    }
    lines.push('');
  }
  for (const [packId, list] of byPack) {
    if (PACKS.some((p) => p.id === packId)) continue;
    lines.push(`## Pack: ${packId} (${list.length})`);
    for (const a of list) lines.push(`- ${a.id}: ${a.description.slice(0, 160)}`);
    lines.push('');
  }
  return lines.join('\n');
}
