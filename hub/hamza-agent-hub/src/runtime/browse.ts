import { listAgents, PACKS, getAgent, type AgentDef } from './registry.js';
import { loadTools13Manifest } from '../packs/tools13/registry.js';
import { tools13Capabilities } from '../packs/tools13/offline.js';
import { scoreAllAgents, requiredCapabilities } from './boss.js';
import { capabilityIndex, profileFor, CAPABILITIES, type Capability } from './capabilities.js';
import { sandboxToolsEnabled } from '../tools/sandbox.js';

/** MCP tools exposed by this one plugin (stdio / base HTTP surface). */
export const MCP_SURFACE_TOOLS = [
  'hub_health',
  'hub_edge_health',
  'hub_tools13_capabilities',
  'n8n_workflow_validate',
  'context_compact',
  'html_extract_links',
  'hub_list_packs',
  'hub_list_agents',
  'hub_full_roster',
  'hub_agent_browse',
  'hub_freellmapi_status',
  'hub_freellmapi_chat',
  'hub_boss_route',
  'hub_tools13_lookup',
  'run_agent',
  'task_status',
  'task_result',
  'cancel_task',
  'clean_leads',
  'sheets_to_json',
  'extract_contacts',
  'seo_audit_html',
  'forge_detect',
  'github_url_tricks',
  'agent_mining_queries',
  // Real web automation. Distinct from hub_agent_browse, which browses the catalog.
  'browser_session',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'browser_extract',
  'browser_screenshot',
  'web_search',
  'hub_integrations',
  'hub_agent_audit',
] as const;

/** Extra tools only on authenticated HTTP (Worker HUB_SECRET path → hub.py). */
export const SANDBOX_MCP_TOOLS = ['run_command'] as const;

export interface BrowseOptions {
  query?: string;
  pack?: string;
  category?: string;
  capability?: string;
  limit?: number;
  offset?: number;
  include_tools13?: boolean;
  include_mcp?: boolean;
  /** Hide agents that cannot currently execute (BLOCKED). */
  executable_only?: boolean;
}

export interface BrowseHit {
  kind: 'agent' | 'tools13' | 'mcp_tool' | 'pack' | 'browser_worker';
  id: string;
  pack?: string;
  category?: string;
  description: string;
  tools?: string[];
  score: number;
  /** Agent rows only: what the agent can genuinely do and whether it can run now. */
  capabilities?: Capability[];
  readiness?: string;
  readiness_reason?: string;
  requires_model?: boolean;
  tested?: boolean;
  /** Tools13 rows only: whether the upstream service is actually available. */
  status?: string;
  runner?: string | null;
}

function haystack(parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Edit distance capped at 2, used for a single typo ("securty" → "security").
 * Anything further apart is a different word, not a misspelling.
 */
function closeEnough(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2 || a.length < 4) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length] <= 2;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff.+_-]+/)
    .filter((t) => t.length >= 2);
}

function scoreText(query: string, text: string): number {
  if (!query.trim()) return 1;
  const q = query.toLowerCase().trim();
  let score = 0;
  if (text.includes(q)) score += 20;
  const words = text.split(/[^a-z0-9\u0600-\u06ff.+_-]+/);
  for (const t of tokenize(q)) {
    if (text.includes(t)) score += 3;
    // Fuzzy fallback so one typo still finds the agent.
    else if (words.some((w) => closeEnough(t, w))) score += 1;
  }
  return score;
}

/** Capability names the query itself asks for, so search matches ability. */
function queryCapabilities(query: string): Set<Capability> {
  const out = new Set<Capability>(requiredCapabilities(query).map((c) => c.capability));
  // An explicit capability name is also a valid search term.
  for (const token of tokenize(query)) {
    for (const cap of CAPABILITIES) {
      if (cap.includes(token) || cap.split('.').some((part) => closeEnough(token, part))) out.add(cap);
    }
  }
  return out;
}

export interface BrowseResult {
  query: string;
  total_agents: number;
  packs: typeof PACKS;
  counts: Record<string, number>;
  hits: BrowseHit[];
  ranked_for_query: Array<{ agent_id: string; pack: string; score: number }>;
  /** Registered vs executable vs tools vs external services — never conflated. */
  inventory: {
    registered_agents: number;
    executable_agents: number;
    limited_agents: number;
    blocked_agents: number;
    untested_agents: number;
    mcp_tools: number;
    sandbox_tools: number;
    tools13_catalog_entries: number;
    local_alternative_services: number;
    blocked_external_services: number;
    browser_workers: number;
    skill_definitions: number;
  };
  pagination: { offset: number; limit: number; returned: number; total_hits: number; has_more: boolean };
  /** Present only when the request itself was invalid. */
  error?: string;
  valid_packs?: string[];
  valid_categories?: string[];
  /** Plain-language explanation when nothing matched. */
  message?: string;
}

function knownCategories(): string[] {
  return [...new Set(listAgents().map((a) => a.category))].sort();
}

function emptyResult(partial: Partial<BrowseResult>): BrowseResult {
  return {
    query: '*',
    total_agents: listAgents().length,
    packs: PACKS,
    counts: {},
    hits: [],
    ranked_for_query: [],
    inventory: inventory(),
    pagination: { offset: 0, limit: 0, returned: 0, total_hits: 0, has_more: false },
    ...partial,
  };
}

/**
 * Honest inventory. A catalog row is not a running capability: the old counts
 * added tools13 manifest entries and MCP tool names to the agent total, which
 * made the Hub look far more operational than it was.
 */
function inventory(): BrowseResult['inventory'] {
  const profiles = [...capabilityIndex().values()];
  const t13 = tools13Capabilities();
  return {
    registered_agents: profiles.length,
    executable_agents: profiles.filter((p) => p.readiness === 'READY').length,
    limited_agents: profiles.filter((p) => p.readiness === 'LIMITED').length,
    blocked_agents: profiles.filter((p) => p.readiness === 'BLOCKED').length,
    untested_agents: profiles.filter((p) => p.readiness === 'UNTESTED').length,
    mcp_tools: MCP_SURFACE_TOOLS.length,
    sandbox_tools: sandboxToolsEnabled() ? SANDBOX_MCP_TOOLS.length : 0,
    tools13_catalog_entries: t13.length,
    local_alternative_services: t13.filter((c) => c.status === 'LOCAL_ALTERNATIVE').length,
    blocked_external_services: t13.filter((c) => c.status === 'BLOCKED').length,
    browser_workers: profiles.filter((p) => p.capabilities.includes('browser.automate')).length,
    skill_definitions: listAgents().filter((a) => a.profile).length,
  };
}

/**
 * Browse everything in the one plugin: packs, agents, tools13, MCP surface.
 * Empty query returns the full catalog (paginated).
 */
export function browseEverything(opts: BrowseOptions = {}): BrowseResult {
  // Invalid filters are an error, not an excuse to return unrelated rows.
  if (opts.pack && !PACKS.some((p) => p.id === opts.pack) && !listAgents().some((a) => a.pack === opts.pack)) {
    return emptyResult({
      error: `unknown pack: ${opts.pack}`,
      valid_packs: PACKS.map((p) => p.id),
      message: `No pack is named "${opts.pack}". Pick one of: ${PACKS.map((p) => p.id).join(', ')}.`,
    });
  }
  if (opts.category && !knownCategories().some((c) => c.toLowerCase() === opts.category!.toLowerCase())) {
    return emptyResult({
      error: `unknown category: ${opts.category}`,
      valid_categories: knownCategories(),
      message: `No agent category is named "${opts.category}". Known categories: ${knownCategories().join(', ')}.`,
    });
  }
  if (opts.capability && !CAPABILITIES.includes(opts.capability as Capability)) {
    return emptyResult({
      error: `unknown capability: ${opts.capability}`,
      valid_packs: PACKS.map((p) => p.id),
      message: `No capability is named "${opts.capability}". Known capabilities: ${CAPABILITIES.join(', ')}.`,
    });
  }

  const query = opts.query?.trim() || '';
  const limit = Math.min(Math.max(opts.limit ?? (query ? 40 : 200), 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const includeTools13 = opts.include_tools13 !== false;
  const includeMcp = opts.include_mcp !== false;
  const wanted = query ? queryCapabilities(query) : new Set<Capability>();

  const agents = listAgents(opts.pack).filter((a) =>
    opts.category ? a.category.toLowerCase() === opts.category.toLowerCase() : true
  );

  const counts: Record<string, number> = {};
  for (const a of listAgents()) counts[a.pack] = (counts[a.pack] || 0) + 1;

  const hits: BrowseHit[] = [];

  for (const p of PACKS) {
    if (opts.pack && p.id !== opts.pack) continue;
    // A category or capability filter is about agents; a pack row answers neither.
    if (opts.category || opts.capability) continue;
    const text = haystack([p.id, p.name, p.description]);
    const score = query ? scoreText(query, text) : 1;
    if (!query || score > 0) {
      hits.push({ kind: 'pack', id: p.id, pack: p.id, description: `${p.name}: ${p.description}`, score });
    }
  }

  for (const a of agents) {
    const profile = profileFor(a.id);
    if (opts.capability && !profile?.capabilities.includes(opts.capability as Capability)) continue;
    if (opts.executable_only && profile?.readiness === 'BLOCKED') continue;

    const text = haystack([a.id, a.pack, a.category, a.description, ...(a.tools || []), ...(profile?.capabilities ?? [])]);
    let score = query ? scoreText(query, text) : 1;
    // Capability match is stronger evidence of fit than a word in a description,
    // which is how a marketing agent used to outrank a reviewer.
    if (query && profile) {
      for (const cap of profile.capabilities) if (wanted.has(cap)) score += 12;
    }
    if (!query || score > 0) {
      hits.push({
        kind: profile?.capabilities.includes('browser.automate') ? 'browser_worker' : 'agent',
        id: a.id,
        pack: a.pack,
        category: a.category,
        description: a.description,
        tools: a.tools,
        score,
        capabilities: profile?.capabilities ?? [],
        readiness: profile?.readiness,
        readiness_reason: profile?.readiness_reason,
        requires_model: profile?.requires_model,
        tested: a.tested,
      });
    }
  }

  if (includeTools13 && !opts.category && !opts.capability) {
    const status = new Map(tools13Capabilities().map((c) => [c.id, c]));
    for (const t of loadTools13Manifest()) {
      if (opts.pack && opts.pack !== 'tools13') continue;
      const text = haystack([t.id, t.name, t.category, t.source, t.note, t.type, t.plugin_id || '']);
      const score = query ? scoreText(query, text) : 1;
      if (!query || score > 0) {
        const cap = status.get(t.id);
        hits.push({
          kind: 'tools13',
          id: t.id,
          pack: 'tools13',
          category: t.category,
          description: `${t.name} — ${t.note || t.source}`,
          score,
          status: cap?.status,
          runner: cap?.runner ?? null,
        });
      }
    }
  }

  if (includeMcp && !opts.category && !opts.capability) {
    const surface = sandboxToolsEnabled()
      ? [...MCP_SURFACE_TOOLS, ...SANDBOX_MCP_TOOLS]
      : [...MCP_SURFACE_TOOLS];
    for (const name of surface) {
      // MCP tools are not pack members; a pack filter must not surface them.
      if (opts.pack) continue;
      const text = haystack([name, 'mcp', 'tool', name.startsWith('browser_') ? 'web automation playwright chromium' : '']);
      const score = query ? scoreText(query, text) : 1;
      if (!query || score > 0) {
        hits.push({
          kind: 'mcp_tool',
          id: name,
          category: 'mcp',
          description: name.startsWith('browser_')
            ? `MCP web automation tool: ${name} (real Chromium page, not catalog browsing)`
            : `MCP surface tool: ${name}`,
          score,
        });
      }
    }
  }

  // Stable ordering: score, then kind, then id. Equal scores never reshuffle
  // between calls, so pagination is repeatable.
  hits.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const page = hits.slice(offset, offset + limit);
  const ranked = query
    ? scoreAllAgents(query)
        .filter((r) => r.score > 0)
        .slice(0, 12)
        .map((r) => ({ agent_id: r.agent.id, pack: r.agent.pack, score: r.score }))
    : [];

  return {
    query: query || '*',
    total_agents: listAgents().length,
    packs: PACKS,
    counts,
    hits: page,
    ranked_for_query: ranked,
    inventory: inventory(),
    pagination: {
      offset,
      limit,
      returned: page.length,
      total_hits: hits.length,
      has_more: offset + page.length < hits.length,
    },
    ...(hits.length
      ? {}
      : {
          message: query
            ? `Nothing in the catalog matches "${query}". Try a capability name (${CAPABILITIES.slice(0, 5).join(', ')}, …), a pack id, or an agent id.`
            : 'The catalog is empty, which means the registry failed to load.',
        }),
  };
}

export function browseAgentDetail(agentId: string): {
  agent: AgentDef | null;
  directory_line: string | null;
  capabilities?: Capability[];
  unbacked_capabilities?: Capability[];
  readiness?: string;
  readiness_reason?: string;
  requires_model?: boolean;
  model_ready?: boolean;
  tested?: boolean;
  specialisations?: string[];
  /** Upstream services this agent depends on and whether they are available. */
  dependencies?: Array<{ id: string; status: string; hint: string }>;
} {
  const agent = getAgent(agentId);
  if (!agent) return { agent: null, directory_line: null };
  const profile = profileFor(agent.id);
  const dependencies = agent.id.startsWith('tool13-')
    ? tools13Capabilities()
        .filter((c) => c.id === agent.id.slice('tool13-'.length))
        .map((c) => ({ id: c.id, status: c.status, hint: c.hint }))
    : [];
  return {
    agent,
    directory_line: `${agent.id} [${agent.pack}/${agent.category}] (${profile?.readiness ?? 'UNTESTED'}): ${agent.description}`,
    capabilities: profile?.capabilities ?? [],
    unbacked_capabilities: profile?.unbacked ?? [],
    readiness: profile?.readiness,
    readiness_reason: profile?.readiness_reason,
    requires_model: profile?.requires_model,
    model_ready: profile?.model_ready,
    tested: agent.tested,
    specialisations: profile?.specialisations ?? [],
    dependencies,
  };
}
