/**
 * Capability model.
 *
 * Routing used to score agents by raw keyword overlap against their description,
 * which is why "use a web browser to download an invoice" selected four code
 * reviewers and "browse the web" selected the catalog browser. A capability is
 * what an agent can actually *do*, derived from its category and the tools it is
 * permitted to call — never invented from marketing text in its description.
 */
import { listAgents, type AgentDef } from './registry.js';
import { tools13Capabilities } from '../packs/tools13/offline.js';
import { modelConfigured } from '../config.js';
import { executedSmokeResults } from '../tools/smoke.js';

/** Closed vocabulary. A capability exists only if some tool or runtime backs it. */
export const CAPABILITIES = [
  'orchestrate',
  'plan.architecture',
  'code.generate',
  'code.review',
  'code.build_fix',
  'code.test',
  'security.review',
  'research.web',
  'browser.automate',
  'data.clean',
  'data.transform',
  'content.write',
  'seo.audit',
  'catalog.browse',
  'forge.inspect',
  'model.gateway',
  'media.process',
  'workflow.validate',
  'context.compact',
  'shell.execute',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Tools that are themselves a capability: holding the tool *is* the ability,
 * with or without a model. Generic workspace tools are deliberately absent —
 * `workspace_write` does not make an agent an implementer, which is why the
 * catalog browser used to be selected to build a REST API.
 */
const TOOL_CAPABILITY: Record<string, Capability[]> = {
  dispatch_agent: ['orchestrate'],
  list_specialists: ['orchestrate'],
  hub_agent_browse: ['catalog.browse'],
  hub_full_roster: ['catalog.browse'],
  hub_list_agents: ['catalog.browse'],
  hub_list_packs: ['catalog.browse'],
  hub_tools13_lookup: ['catalog.browse'],
  hub_freellmapi_status: ['model.gateway'],
  hub_freellmapi_chat: ['model.gateway'],
  clean_leads: ['data.clean'],
  extract_contacts: ['data.clean'],
  sheets_to_json: ['data.transform'],
  html_extract_links: ['data.transform'],
  seo_audit_html: ['seo.audit'],
  forge_detect: ['forge.inspect'],
  github_url_tricks: ['forge.inspect'],
  agent_mining_queries: ['forge.inspect'],
  n8n_workflow_validate: ['workflow.validate'],
  context_compact: ['context.compact'],
  film_pack_prepare: ['media.process'],
  run_command: ['shell.execute'],
  browser_navigate: ['browser.automate'],
  browser_snapshot: ['browser.automate'],
  browser_act: ['browser.automate'],
  browser_extract: ['browser.automate'],
  browser_screenshot: ['browser.automate'],
  browser_session: ['browser.automate'],
  web_search: ['research.web'],
};

/** Minimum tooling an agent needs before a reasoning capability means anything. */
const WORKSPACE_TOOLS = ['workspace_read', 'workspace_list', 'workspace_grep', 'workspace_write', 'workspace_stat'];

/**
 * Category implies intent. Intent alone is not capability: it is intersected
 * with the tool-backed set below, except for reasoning-only capabilities which
 * additionally require a live model.
 */
const CATEGORY_CAPABILITY: Record<string, Capability[]> = {
  orchestrator: ['orchestrate', 'plan.architecture'],
  architect: ['plan.architecture'],
  reviewer: ['code.review'],
  build_resolver: ['code.build_fix'],
  tester: ['code.test'],
  generator: ['code.generate'],
  catalog_browser: ['catalog.browse'],
  web_automation: ['browser.automate'],
  model_gateway: ['model.gateway'],
  desk_workflow: ['data.clean', 'content.write'],
  desk_tool: ['data.clean'],
  forge_intelligence: ['forge.inspect'],
  specialist: [],
};

/** Capabilities that are pure reasoning: without a live model they are LIMITED. */
const MODEL_DEPENDENT = new Set<Capability>([
  'orchestrate',
  'plan.architecture',
  'code.generate',
  'code.review',
  'code.build_fix',
  'code.test',
  'security.review',
  'content.write',
]);

/** Narrow specialisations recognised from the agent id only (never free text). */
const ID_CAPABILITY: Array<{ match: RegExp; capability: Capability }> = [
  { match: /security|vulnerab|owasp/i, capability: 'security.review' },
  { match: /-test|test-|tester|pr-test/i, capability: 'code.test' },
  { match: /architect|planner/i, capability: 'plan.architecture' },
  { match: /scrapling|scraper|crawl/i, capability: 'research.web' },
  { match: /agent-reach|research/i, capability: 'research.web' },
  { match: /seo/i, capability: 'seo.audit' },
  { match: /lapian|video|muse|generative/i, capability: 'media.process' },
  { match: /n8n/i, capability: 'workflow.validate' },
  { match: /headroom/i, capability: 'context.compact' },
  { match: /glm|kimi|llm|model/i, capability: 'model.gateway' },
  { match: /marketing|content|copywriter|writer/i, capability: 'content.write' },
];

/**
 * The language/framework an ECC reviewer actually specialises in, taken from the
 * agent id. `ecc-python-reviewer` → `python`. Used so a Python review does not
 * tie with `ecc-cpp-reviewer`.
 */
export function specialisationOf(agent: AgentDef): string[] {
  const id = agent.id.replace(/^ecc-/, '');
  const known = [
    'python', 'typescript', 'javascript', 'react', 'vue', 'angular', 'svelte', 'node', 'django',
    'flask', 'fastapi', 'rails', 'ruby', 'go', 'golang', 'rust', 'java', 'kotlin', 'swift',
    'csharp', 'cpp', 'c', 'php', 'laravel', 'dart', 'flutter', 'scala', 'elixir', 'sql',
    'database', 'docker', 'kubernetes', 'terraform', 'aws', 'android', 'ios', 'css', 'html',
    'graphql', 'api', 'a11y', 'ml', 'data',
  ];
  return known.filter((k) => new RegExp(`(^|-)${k}(-|$)`).test(id));
}

export type Readiness = 'READY' | 'LIMITED' | 'BLOCKED' | 'UNTESTED';

export interface AgentCapabilityProfile {
  agent_id: string;
  pack: string;
  category: string;
  /** Capabilities genuinely backed by a permitted tool or a live model. */
  capabilities: Capability[];
  /** Capabilities the category implies but no tool/runtime currently backs. */
  unbacked: Capability[];
  specialisations: string[];
  readiness: Readiness;
  readiness_reason: string;
  requires_model: boolean;
  model_ready: boolean;
  tested: boolean;
  tools: string[];
}

/**
 * Tools13 agents whose upstream service is unavailable but which still own an
 * implemented local runner (`tool13-lapian-notes` → `film_pack_prepare`). They
 * are degraded, not unusable, so they stay routable while reporting the
 * dependency they are missing.
 */
const LOCAL_RUNNER_TOOLS = new Set(['film_pack_prepare']);

function tools13Readiness(agent: AgentDef): { readiness: 'BLOCKED' | 'LIMITED'; reason: string } | null {
  if (!agent.id.startsWith('tool13-')) return null;
  const cap = tools13Capabilities().find((c) => c.id === agent.id.slice('tool13-'.length));
  if (!cap || (cap.status !== 'BLOCKED' && cap.status !== 'NOT_ENABLED' && cap.status !== 'ENABLED')) return null;
  const reason = cap.hint || 'upstream runtime not installed';
  if (cap.status === 'ENABLED') {
    return { readiness: 'LIMITED', reason };
  }
  if (agent.tools.some((t) => LOCAL_RUNNER_TOOLS.has(t))) {
    return { readiness: 'LIMITED', reason: `upstream service unavailable; local runner only — ${reason}` };
  }
  return { readiness: 'BLOCKED', reason };
}

export function profileOf(agent: AgentDef): AgentCapabilityProfile {
  const implied = new Set<Capability>(CATEGORY_CAPABILITY[agent.category] ?? []);
  for (const rule of ID_CAPABILITY) {
    if (rule.match.test(agent.id)) implied.add(rule.capability);
  }

  const toolBacked = new Set<Capability>();
  for (const tool of agent.tools) {
    for (const cap of TOOL_CAPABILITY[tool] ?? []) toolBacked.add(cap);
  }

  const modelReady = modelConfigured();
  const measured = executedSmokeResults();
  const hasWorkspace = agent.tools.some((t) => WORKSPACE_TOOLS.includes(t));

  // Holding a capability and being ready to exercise it are different things.
  // Model availability changes readiness, never membership — otherwise the whole
  // roster would appear to lose every skill the moment the model goes down.
  const capabilities: Capability[] = [];
  const unbacked: Capability[] = [];
  for (const cap of new Set([...implied, ...toolBacked])) {
    if (toolBacked.has(cap)) capabilities.push(cap);
    else if (implied.has(cap) && hasWorkspace) capabilities.push(cap);
    else unbacked.push(cap);
  }
  capabilities.sort();
  unbacked.sort();

  // Only reasoning capabilities with no deterministic tool behind them need a model.
  const requiresModel = capabilities.some((c) => MODEL_DEPENDENT.has(c) && !toolBacked.has(c));
  const upstream = tools13Readiness(agent);

  let readiness: Readiness;
  let reason: string;
  if (upstream) {
    readiness = upstream.readiness;
    reason = upstream.reason;
  } else if (requiresModel && !modelReady) {
    readiness = 'LIMITED';
    reason = 'reasoning capabilities need a live model; deterministic tools still run';
  } else if (!agent.tested && measured) {
    // The catalog's `tested` flag is a claim, not evidence. Once the tool smoke
    // checks have actually run, classify on what passed instead, so the Boss
    // routes on measured readiness and the plan agrees with the audit.
    const verified = agent.tools.filter((t) => measured.get(t)?.ok);
    if (verified.length === agent.tools.length && agent.tools.length > 0) {
      readiness = 'READY';
      reason = 'every tool it holds passed an executed smoke check';
    } else if (verified.length) {
      readiness = 'LIMITED';
      reason = 'some tools passed an executed check; the rest name an unmet dependency';
    } else {
      readiness = 'UNTESTED';
      reason = 'no tool it holds could be exercised here';
    }
  } else if (!agent.tested) {
    readiness = 'UNTESTED';
    reason = 'no recorded verified execution for this agent';
  } else {
    readiness = 'READY';
    reason = 'tools backed and model available';
  }

  return {
    agent_id: agent.id,
    pack: agent.pack,
    category: agent.category,
    capabilities,
    unbacked,
    specialisations: specialisationOf(agent),
    readiness,
    readiness_reason: reason,
    requires_model: requiresModel,
    model_ready: modelReady,
    tested: agent.tested,
    tools: agent.tools,
  };
}

let cache: { key: string; profiles: Map<string, AgentCapabilityProfile> } | null = null;

export function capabilityIndex(): Map<string, AgentCapabilityProfile> {
  const agents = listAgents();
  // The key includes whether measured evidence exists, so the index rebuilds
  // once the smoke checks have run rather than serving declared readiness for
  // the lifetime of the process.
  const key = `${agents.length}:${modelConfigured()}:${executedSmokeResults() ? 'measured' : 'declared'}`;
  if (cache && cache.key === key) return cache.profiles;
  const profiles = new Map<string, AgentCapabilityProfile>();
  for (const agent of agents) profiles.set(agent.id, profileOf(agent));
  cache = { key, profiles };
  return profiles;
}

export function profileFor(agentId: string): AgentCapabilityProfile | null {
  return capabilityIndex().get(agentId) ?? null;
}

/** Agents that genuinely hold a capability, optionally gated on readiness. */
export function agentsWithCapability(
  capability: Capability,
  opts: { executableOnly?: boolean } = {}
): AgentCapabilityProfile[] {
  const out: AgentCapabilityProfile[] = [];
  for (const profile of capabilityIndex().values()) {
    if (!profile.capabilities.includes(capability)) continue;
    if (opts.executableOnly && profile.readiness === 'BLOCKED') continue;
    out.push(profile);
  }
  return out.sort((a, b) => a.agent_id.localeCompare(b.agent_id));
}

/** True when no agent anywhere can perform the capability. */
export function capabilityGap(capability: Capability): boolean {
  return agentsWithCapability(capability, { executableOnly: true }).length === 0;
}
