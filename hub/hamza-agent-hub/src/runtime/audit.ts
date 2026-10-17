/**
 * Per-agent audit (Part 7).
 *
 * Answers, for every registered agent: what it is responsible for, which tools
 * it may actually call, what it takes in and gives back, whether it needs a
 * model or an external API, what runtime it depends on, whether anything has
 * ever verified it, and what it cannot do.
 *
 * Nothing here is written by hand per agent. Every field is derived from the
 * catalog, the capability model, the executed tool smoke checks, and the
 * Tools13 manifest, so the audit cannot drift from the code or flatter it.
 */
import { listAgents, getAgent, type AgentDef } from './registry.js';
import { capabilityIndex, type AgentCapabilityProfile, type Capability } from './capabilities.js';
import { tools13Capabilities } from '../packs/tools13/offline.js';
import {
  EXTERNAL_TOOLS,
  executedSmokeResults,
  resetExecutedSmokeResults,
  runAllSmokeChecks,
  type SmokeResult,
} from '../tools/smoke.js';
import { TOOL_SCHEMAS } from '../model/schemas.js';
import { modelConfigured } from '../config.js';

/**
 * Where an agent's claim to work comes from. Deliberately tool-scoped: an
 * agent is only ever as verified as the tools something actually ran.
 *
 * - `all_tools_executed` — every tool it holds has a passing executed check.
 * - `some_tools_executed` — at least one passed; the rest name their blocker.
 * - `declared_only` — the catalog says `tested: true` and nothing ran.
 * - `none` — no evidence of any kind.
 */
export type Evidence = 'all_tools_executed' | 'some_tools_executed' | 'declared_only' | 'none';

export interface AgentAudit {
  agent_id: string;
  pack: string;
  category: string;
  /** One line taken from the catalog, not invented. */
  responsibility: string;
  /** Path to the role brief, when the pack ships one. */
  role_brief: string | null;
  tools: string[];
  /** Tools with a passing executed smoke check. */
  verified_tools: string[];
  /** Tools that exist but could not be exercised here, with the blocker. */
  unverified_tools: Array<{ tool: string; reason: string }>;
  capabilities: Capability[];
  /** Implied by category but backed by nothing. */
  unbacked_capabilities: Capability[];
  inputs: string[];
  outputs: string[];
  requires_model: boolean;
  model_ready: boolean;
  api_requirements: string[];
  runtime_dependencies: string[];
  /** Measured: upgraded from the structural view when checks actually passed. */
  readiness: AgentCapabilityProfile['readiness'];
  readiness_reason: string;
  /** The sync structural classification, kept so the two can be compared. */
  declared_readiness: AgentCapabilityProfile['readiness'];
  evidence: Evidence;
  /** Declared in the catalog. Kept separate from measured evidence on purpose. */
  declared_tested: boolean;
  limitations: string[];
}

/** Runtime a tool cannot work without. */
const TOOL_RUNTIME: Record<string, string> = {
  browser_session: 'Chromium via Playwright (CPU, headless)',
  browser_navigate: 'Chromium via Playwright (CPU, headless)',
  browser_snapshot: 'Chromium via Playwright (CPU, headless)',
  browser_act: 'Chromium via Playwright (CPU, headless)',
  browser_extract: 'Chromium via Playwright (CPU, headless)',
  browser_screenshot: 'Chromium via Playwright (CPU, headless)',
  run_command: 'sandboxed shell, authenticated HTTP path only',
  film_pack_prepare: 'ffmpeg and ffprobe on PATH',
  hub_edge_health: 'deployed Cloudflare edge',
};

/** External API a tool reaches for. */
const TOOL_API: Record<string, string> = {
  web_search: 'a research provider credential (Tavily, Brave or Exa)',
  hub_freellmapi_chat: 'FreeLLMAPI gateway',
  hub_freellmapi_status: 'FreeLLMAPI gateway (status probe only)',
  browser_navigate: 'outbound HTTP to allow-listed domains',
};

function inputsFor(tools: string[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    const schema = TOOL_SCHEMAS[tool];
    if (!schema) continue;
    for (const field of Object.keys(schema)) out.add(`${tool}.${field}`);
  }
  return [...out].sort();
}

function outputsFor(agent: AgentDef, profile: AgentCapabilityProfile): string[] {
  const out = new Set<string>();
  if (agent.tools.some((t) => t.startsWith('workspace_write'))) out.add('workspace artifacts (files under the task workspace)');
  if (agent.tools.includes('browser_screenshot')) out.add('screenshot files as action receipts');
  if (profile.capabilities.includes('catalog.browse')) out.add('catalog listings (JSON)');
  if (profile.capabilities.includes('orchestrate')) out.add('mission plan with per-task assignments and constraints');
  if (profile.capabilities.includes('data.clean') || profile.capabilities.includes('data.transform')) out.add('normalised records (JSON)');
  if (profile.capabilities.includes('seo.audit')) out.add('audit findings (JSON)');
  if (profile.capabilities.includes('research.web')) out.add('search results with source URLs');
  if (profile.requires_model) out.add('written analysis (requires a live model; otherwise COMPLETED_LIMITED)');
  if (!out.size) out.add('structured JSON tool output');
  return [...out].sort();
}

function limitationsFor(
  agent: AgentDef,
  profile: AgentCapabilityProfile,
  unverified: Array<{ tool: string; reason: string }>
): string[] {
  const limits: string[] = [];
  if (profile.requires_model && !profile.model_ready) {
    limits.push('No live model is configured, so reasoning output is deterministic and marked COMPLETED_LIMITED.');
  }
  if (profile.unbacked.length) {
    limits.push(`Category implies ${profile.unbacked.join(', ')}, but no permitted tool backs ${profile.unbacked.length === 1 ? 'it' : 'them'}.`);
  }
  if (agent.id.startsWith('tool13-')) {
    const cap = tools13Capabilities().find((c) => c.id === agent.id.slice('tool13-'.length));
    if (cap?.status === 'BLOCKED') limits.push(`Upstream service unavailable: ${cap.hint}`);
    if (cap?.status === 'LOCAL_ALTERNATIVE') limits.push(`Local alternative only (${cap.runner}); the upstream service is not running.`);
  }
  for (const u of unverified) limits.push(`${u.tool}: ${u.reason}`);
  if (!agent.tools.some((t) => t.startsWith('workspace_')) && profile.requires_model) {
    limits.push('No workspace tools, so it cannot read the code it is asked to reason about.');
  }
  return limits;
}

/**
 * The structural classification in `capabilities.ts` has to be synchronous, so
 * it falls back to the catalog's `tested` flag — which is exactly the kind of
 * unverified claim this audit exists to remove. Here the executed checks are
 * available, so an agent whose whole toolset passed is READY on evidence rather
 * than UNTESTED on a flag. Nothing is ever upgraded past a real blocker: a
 * missing model still means LIMITED and a dead upstream still means BLOCKED.
 */
function measuredReadiness(
  profile: AgentCapabilityProfile,
  evidence: Evidence
): { readiness: AgentCapabilityProfile['readiness']; reason: string } {
  if (profile.readiness !== 'UNTESTED') {
    return { readiness: profile.readiness, reason: profile.readiness_reason };
  }
  if (evidence === 'all_tools_executed') {
    return { readiness: 'READY', reason: 'every tool it holds passed an executed smoke check' };
  }
  if (evidence === 'some_tools_executed') {
    return { readiness: 'LIMITED', reason: 'some tools passed an executed check; the rest name an unmet dependency' };
  }
  return { readiness: 'UNTESTED', reason: profile.readiness_reason };
}

/**
 * Smoke results are shared across the whole audit; the checks are pure.
 *
 * The cache lives in the smoke module so the synchronous readiness
 * classification can read the same evidence. Two caches would be two answers.
 */
async function smokeResults(): Promise<Map<string, SmokeResult>> {
  const cached = executedSmokeResults();
  if (cached) return cached;
  await runAllSmokeChecks();
  return executedSmokeResults()!;
}

export function resetAuditCache(): void {
  resetExecutedSmokeResults();
}

export async function auditAgent(agentId: string): Promise<AgentAudit | null> {
  const agent = getAgent(agentId);
  if (!agent) return null;
  const [audit] = await auditAgents([agent]);
  return audit ?? null;
}

export async function auditAgents(agents: AgentDef[] = listAgents()): Promise<AgentAudit[]> {
  const smoke = await smokeResults();
  const index = capabilityIndex();

  return agents.map((agent) => {
    const profile = index.get(agent.id)!;
    const verified: string[] = [];
    const unverified: Array<{ tool: string; reason: string }> = [];

    for (const tool of agent.tools) {
      const result = smoke.get(tool);
      if (result?.ok) {
        verified.push(tool);
      } else if (result) {
        unverified.push({ tool, reason: `smoke check failed: ${result.detail}` });
      } else {
        unverified.push({ tool, reason: EXTERNAL_TOOLS[tool] ?? 'no executable smoke check exists for this tool' });
      }
    }

    const apis = [...new Set(agent.tools.map((t) => TOOL_API[t]).filter((v): v is string => Boolean(v)))];
    if (profile.requires_model) apis.push('an OpenAI-compatible model provider');

    const evidence: Evidence =
      verified.length === agent.tools.length && agent.tools.length > 0
        ? 'all_tools_executed'
        : verified.length
          ? 'some_tools_executed'
          : agent.tested
            ? 'declared_only'
            : 'none';

    const { readiness, reason } = measuredReadiness(profile, evidence);

    return {
      agent_id: agent.id,
      pack: agent.pack,
      category: agent.category,
      responsibility: agent.description,
      role_brief: agent.profile ?? null,
      tools: agent.tools,
      verified_tools: verified.sort(),
      unverified_tools: unverified,
      capabilities: profile.capabilities,
      unbacked_capabilities: profile.unbacked,
      inputs: inputsFor(agent.tools),
      outputs: outputsFor(agent, profile),
      requires_model: profile.requires_model,
      model_ready: profile.model_ready,
      api_requirements: [...new Set(apis)].sort(),
      runtime_dependencies: [...new Set(agent.tools.map((t) => TOOL_RUNTIME[t]).filter((v): v is string => Boolean(v)))].sort(),
      readiness,
      readiness_reason: reason,
      declared_readiness: profile.readiness,
      evidence,
      declared_tested: agent.tested,
      limitations: limitationsFor(agent, profile, unverified),
    };
  });
}

export interface AuditSummary {
  total: number;
  ready: number;
  limited: number;
  blocked: number;
  untested: number;
  /** Agents whose entire toolset passed an executed check. */
  all_tools_executed: number;
  /** Agents with at least one passing check and at least one named blocker. */
  some_tools_executed: number;
  /** Agents resting only on the catalog flag, with nothing executed. */
  declared_only: number;
  declared_tested: number;
  model_ready: boolean;
  tools: { verified: number; external: number };
  packs: Record<string, number>;
}

export async function auditSummary(): Promise<AuditSummary> {
  const audit = await auditAgents();
  const smoke = await smokeResults();
  const packs: Record<string, number> = {};
  for (const row of audit) packs[row.pack] = (packs[row.pack] ?? 0) + 1;
  return {
    total: audit.length,
    ready: audit.filter((a) => a.readiness === 'READY').length,
    limited: audit.filter((a) => a.readiness === 'LIMITED').length,
    blocked: audit.filter((a) => a.readiness === 'BLOCKED').length,
    untested: audit.filter((a) => a.readiness === 'UNTESTED').length,
    all_tools_executed: audit.filter((a) => a.evidence === 'all_tools_executed').length,
    some_tools_executed: audit.filter((a) => a.evidence === 'some_tools_executed').length,
    declared_only: audit.filter((a) => a.evidence === 'declared_only').length,
    declared_tested: audit.filter((a) => a.declared_tested).length,
    model_ready: modelConfigured(),
    tools: {
      verified: [...smoke.values()].filter((r) => r.ok).length,
      external: Object.keys(EXTERNAL_TOOLS).length,
    },
    packs,
  };
}
