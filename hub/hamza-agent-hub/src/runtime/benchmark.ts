/**
 * Routing and execution benchmark (Part 11).
 *
 * A fixed set of representative missions with the capability each one genuinely
 * needs, plus the agents that would be wrong answers. Routing accuracy is
 * measured against the capability the Boss selects, not against one blessed
 * agent id, because several agents can be a correct answer for the same work.
 *
 * Cases are declared here rather than in the test file so the same suite can be
 * run from the CLI against a deployed Hub and compared over time.
 */
import { planWithBoss, type HubPlan } from './boss.js';
import { profileFor, type Capability } from './capabilities.js';
import { runAllSmokeChecks } from '../tools/smoke.js';

export interface BenchmarkCase {
  id: string;
  mission: string;
  /** Capability the mission must route to. Omitted only when it is withheld. */
  expect_capability?: Capability;
  /** Capabilities the plan must also cover, in any order. */
  expect_also?: Capability[];
  /** Agent ids that would be a wrong primary, with why. */
  forbid_primary?: string[];
  /** Constraint text that must survive into every subtask. */
  expect_constraints?: string[];
  /** Set when the mission is expected to report a capability gap. */
  expect_gap?: Capability;
  /**
   * A capability the user's own constraints rule out. Withholding it is the
   * correct answer, so the case asserts it is named as withheld rather than
   * quietly routed anyway.
   */
  expect_withheld?: Capability;
  notes: string;
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: 'B01',
    mission: 'Review this Python module for SQL injection and other security vulnerabilities',
    expect_capability: 'security.review',
    forbid_primary: ['ecc-marketing-agent', 'ecc-seo-specialist', 'hub-web-browser'],
    notes: 'The original defect: a Python security review ranked a marketing agent.',
  },
  {
    id: 'B02',
    mission: 'Review the TypeScript API client for correctness and style problems',
    expect_capability: 'code.review',
    forbid_primary: ['ecc-marketing-agent', 'hub-agent-browse'],
    notes: 'Language specialisation should beat generic reviewers.',
  },
  {
    id: 'B03',
    mission: 'Open https://example.com, click the Download invoice link and save the file',
    expect_capability: 'browser.automate',
    forbid_primary: ['hub-agent-browse'],
    notes: 'Website browsing must not route to the catalog browser.',
  },
  {
    id: 'B04',
    mission: 'Browse the agent catalog and list every agent in the SEO category',
    expect_capability: 'catalog.browse',
    forbid_primary: ['hub-web-browser'],
    notes: 'Catalog browsing must not route to web automation.',
  },
  {
    id: 'B05',
    mission: 'Clean this lead list, normalise the addresses and remove duplicates',
    expect_capability: 'data.clean',
    forbid_primary: ['ecc-marketing-agent'],
    notes: 'Deterministic desk work; must not need a model.',
  },
  {
    id: 'B06',
    mission: 'Run an SEO audit on this HTML page and report missing meta descriptions',
    expect_capability: 'seo.audit',
    notes: 'Tools13 local alternative path.',
  },
  {
    id: 'B07',
    mission: 'Plan the architecture for a multi-tenant billing service, then implement it and write tests',
    expect_capability: 'plan.architecture',
    expect_also: ['code.generate', 'code.test'],
    forbid_primary: ['ecc-python-reviewer', 'tool13-goose'],
    notes: 'The original defect: a multi-agent software task picked a reviewer and an unavailable integration.',
  },
  {
    id: 'B08',
    mission: 'Research our competitors online and produce a cited summary',
    expect_capability: 'research.web',
    notes: 'Research must prefer the search integration over UI automation.',
  },
  {
    id: 'B09',
    mission: 'Fix the failing build in this Rust project',
    expect_capability: 'code.build_fix',
    notes: 'Build resolution is its own capability.',
  },
  {
    id: 'B10',
    mission: 'Write unit tests for the payment reconciliation module',
    expect_capability: 'code.test',
    notes: 'Testing should not collapse into generic code review.',
  },
  {
    id: 'B11',
    mission: 'Validate this n8n workflow before anyone activates it',
    expect_capability: 'workflow.validate',
    notes: 'Validation must never execute or activate the workflow.',
  },
  {
    id: 'B12',
    mission: 'Compress this 40000 line log into the relevant context',
    expect_capability: 'context.compact',
    notes: 'Local deterministic compaction.',
  },
  {
    id: 'B13',
    mission: 'Detect which forge hosts https://github.com/hamzaloukili/agent-core and show the raw file URLs',
    expect_capability: 'forge.inspect',
    notes: 'Forge intelligence path.',
  },
  {
    id: 'B14',
    mission: 'Prepare the lapian film pack frames from the uploaded video',
    expect_capability: 'media.process',
    notes: 'Local runner exists but ffmpeg may not; readiness must say which.',
  },
  {
    id: 'B15',
    mission: 'Check whether the FreeLLMAPI model gateway is reachable',
    expect_capability: 'model.gateway',
    notes: 'Must report BLOCKED honestly rather than claim a live model.',
  },
  {
    id: 'B16',
    mission: 'Review the checkout code for security problems. Do not execute anything or use paid services.',
    expect_capability: 'security.review',
    expect_constraints: ['execute', 'paid'],
    notes: 'The original defect: constraints were split into separate subtasks instead of attached to all of them.',
  },
  {
    id: 'B17',
    mission: 'Clean the contact list, then audit the site SEO, then review the auth code for security issues',
    expect_capability: 'data.clean',
    expect_also: ['seo.audit', 'security.review'],
    notes: 'User sequencing with "then" must beat the default role order.',
  },
  {
    id: 'B18',
    mission: 'راجع الكود بحثاً عن ثغرات أمان',
    expect_capability: 'security.review',
    notes: 'Arabic routing: \\b forms no word boundary around Arabic letters.',
  },
  {
    id: 'B19',
    mission: 'نظف جهات الاتصال وأزل التكرار',
    expect_capability: 'data.clean',
    notes: 'Arabic routing for deterministic desk work.',
  },
  {
    id: 'B20',
    mission: 'تصفح الوكلاء واعرض قائمة الوكلاء المتاحة',
    expect_capability: 'catalog.browse',
    forbid_primary: ['hub-web-browser'],
    notes: 'Arabic catalog browsing must not route to web automation.',
  },
  {
    id: 'B21',
    mission: 'Log in to the supplier portal at https://portal.example.com and download this month invoice',
    expect_capability: 'browser.automate',
    notes: 'Authenticated browser workflow; must stop and ask on 2FA.',
  },
  {
    id: 'B22',
    mission: 'Use the Goose integration to run an automation for me',
    expect_capability: 'orchestrate',
    forbid_primary: ['tool13-goose'],
    notes: 'A BLOCKED upstream must never be assigned as an executable worker.',
  },
  {
    id: 'B23',
    mission: 'Research competitor pricing online. Work offline with no internet access.',
    // The user forbade the very capability the goal needs. The right behaviour
    // is to withhold it and say so, not to route it anyway or drop it silently.
    expect_withheld: 'research.web',
    expect_constraints: ['offline'],
    notes: 'A self-contradicting mission must surface the conflict, not silently pick one side.',
  },
  {
    id: 'B24',
    mission: 'Transform this spreadsheet export into JSON records',
    expect_capability: 'data.transform',
    notes: 'Deterministic transformation.',
  },
  {
    id: 'B25',
    mission: 'Implement a REST endpoint that returns invoice totals',
    expect_capability: 'code.generate',
    forbid_primary: ['hub-agent-browse', 'ecc-marketing-agent'],
    notes: 'Implementation must not route to the catalog browser, the original build-a-REST-API defect.',
  },
  {
    id: 'B26',
    mission: 'Draft a proposal email for the client summarising our offer',
    expect_capability: 'content.write',
    notes: 'Writing work; requires a model, so readiness must report LIMITED without one.',
  },
  {
    id: 'B27',
    mission: 'Run the test suite using a shell command and report the output',
    expect_capability: 'shell.execute',
    notes: 'Shell access is privileged; it must route only to an agent actually granted run_command.',
  },

  // The five workflows of Part 9, phrased the way a user phrases them rather
  // than the way the intent table is written.
  {
    id: 'B28',
    mission: 'Research the top three competitors in our market and write a cited report',
    expect_capability: 'research.web',
    expect_also: ['content.write'],
    notes: 'Workflow A: research then write, two owners rather than one agent doing both blind.',
  },
  {
    id: 'B29',
    mission: 'Open the supplier portal, go to the billing page and download the latest invoice',
    expect_capability: 'browser.automate',
    forbid_primary: ['hub-agent-browse'],
    notes: 'Workflow B: real web automation, not the catalog browser.',
  },
  {
    id: 'B30',
    mission: 'Fix the failing build and prove the tests pass',
    expect_capability: 'code.build_fix',
    expect_also: ['code.test'],
    notes: 'Workflow C: a repair is not finished until something proves it.',
  },
  {
    id: 'B31',
    mission: 'Find new leads, clean up the list and draft a proposal. Do not send anything.',
    expect_capability: 'data.clean',
    expect_also: ['research.web', 'content.write'],
    expect_constraints: ['no_send'],
    notes: 'Workflow D: "clean up the list" used to match nothing, dropping the cleaning step entirely.',
  },
  {
    id: 'B32',
    mission: 'List the open issues on the GitHub repository and summarise them',
    expect_capability: 'forge.inspect',
    forbid_primary: ['hub-web-browser'],
    notes: 'Workflow E: an authorised API exists, so the Boss must not force UI automation.',
  },
];

export interface CaseResult {
  id: string;
  mission: string;
  ok: boolean;
  failures: string[];
  primary: string;
  primary_readiness: string;
  routed_capabilities: Capability[];
  subtasks: number;
  constraints: number;
  ms: number;
}

function evaluate(testCase: BenchmarkCase, plan: HubPlan, ms: number): CaseResult {
  const failures: string[] = [];
  // A capability a subtask additionally covers is routed just as much as its
  // primary one: the work is assigned to an agent that holds it.
  const routed = plan.decomposition
    .flatMap((s) => [s.capability, ...s.covers])
    .filter((c): c is Capability => c !== null);
  const gapped = plan.capability_gaps.map((g) => g.capability);

  // A capability the Boss correctly reports as a gap counts as routed: naming
  // the gap is the right answer, and treating it as a miss would reward
  // silently assigning an agent that cannot do the work.
  const covered = new Set<Capability>([...routed, ...gapped]);

  if (testCase.expect_capability && !covered.has(testCase.expect_capability)) {
    failures.push(`expected ${testCase.expect_capability}, routed ${routed.join(', ') || 'nothing'}`);
  }
  if (testCase.expect_withheld) {
    const withheld = plan.excluded.some(
      (e) => e.agent_id === `(capability ${testCase.expect_withheld})` && /constraint/i.test(e.reason)
    );
    if (!withheld) failures.push(`${testCase.expect_withheld} should have been withheld by constraint and named as such`);
    if (routed.includes(testCase.expect_withheld)) failures.push(`${testCase.expect_withheld} was routed despite a constraint forbidding it`);
  }
  for (const also of testCase.expect_also ?? []) {
    if (!covered.has(also)) failures.push(`missing required capability ${also}`);
  }
  for (const forbidden of testCase.forbid_primary ?? []) {
    if (plan.primary === forbidden) failures.push(`routed to ${forbidden}, which cannot do this work`);
  }
  for (const needle of testCase.expect_constraints ?? []) {
    const everySubtask = plan.decomposition.every((s) => new RegExp(needle, 'i').test(s.subtask));
    if (!plan.decomposition.length) failures.push('no subtasks were produced');
    else if (!everySubtask) failures.push(`constraint "${needle}" did not reach every subtask`);
  }
  if (testCase.expect_gap && !gapped.includes(testCase.expect_gap)) {
    failures.push(`expected a reported gap for ${testCase.expect_gap}`);
  }
  // A BLOCKED agent must never be handed executable work.
  for (const subtask of plan.decomposition) {
    if (subtask.readiness === 'BLOCKED' && !subtask.degraded) {
      failures.push(`${subtask.agent_id} is BLOCKED but was assigned without being flagged degraded`);
    }
  }

  return {
    id: testCase.id,
    mission: testCase.mission,
    ok: failures.length === 0,
    failures,
    primary: plan.primary,
    primary_readiness: profileFor(plan.primary)?.readiness ?? 'UNKNOWN',
    routed_capabilities: routed,
    subtasks: plan.decomposition.length,
    constraints: plan.constraints.length,
    ms,
  };
}

export interface BenchmarkReport {
  cases: CaseResult[];
  routing_accuracy: number;
  passed: number;
  total: number;
  latency_ms: { p50: number; p95: number; max: number };
  tool_success_rate: number;
  tools: { passed: number; total: number };
  /** Plans that assigned work to an agent with no live model behind it. */
  degraded_assignments: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

export async function runBenchmark(cases: BenchmarkCase[] = BENCHMARK_CASES): Promise<BenchmarkReport> {
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const started = Date.now();
    try {
      const plan = planWithBoss(testCase.mission);
      results.push(evaluate(testCase, plan, Date.now() - started));
    } catch (err) {
      results.push({
        id: testCase.id,
        mission: testCase.mission,
        ok: false,
        failures: [`planning threw: ${err instanceof Error ? err.message : String(err)}`],
        primary: '(none)',
        primary_readiness: 'UNKNOWN',
        routed_capabilities: [],
        subtasks: 0,
        constraints: 0,
        ms: Date.now() - started,
      });
    }
  }

  const smoke = await runAllSmokeChecks();
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const passed = results.filter((r) => r.ok).length;

  return {
    cases: results,
    passed,
    total: results.length,
    routing_accuracy: results.length ? passed / results.length : 0,
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.at(-1) ?? 0 },
    tool_success_rate: smoke.length ? smoke.filter((r) => r.ok).length / smoke.length : 0,
    tools: { passed: smoke.filter((r) => r.ok).length, total: smoke.length },
    degraded_assignments: results.filter((r) => r.primary_readiness === 'LIMITED').length,
  };
}
