import fs from 'node:fs';
import path from 'node:path';
import { ROOT, modelConfigured } from '../config.js';
import catalogJson from './catalog.json' with { type: 'json' };

export interface AgentDef {
  id: string;
  pack: string;
  category: string;
  description: string;
  tools: string[];
  profile?: string;
  upstream?: string;
  model_ready: boolean;
  tested: boolean;
}

const catalog = catalogJson as AgentDef[];

export const PACKS = [
  {
    id: 'hub',
    name: 'Hamza Agent Hub Boss + Browse',
    description:
      'hub-boss routes with FULL roster awareness; hub-agent-browse searches packs, agents, tools13, and MCP tools',
  },
  {
    id: 'desk',
    name: 'Automation Desk',
    description: 'imdifferent01 desk tools + Inbox/Weekly/Meeting workflows (live twin of desk.imdifferent01.com)',
  },
  {
    id: 'ecc68',
    name: 'ECC 68',
    description: '68 ECC specialist coding agents with chief-of-staff routing',
  },
  {
    id: 'forge',
    name: 'Cross-Forge Intelligence',
    description: 'Forge detect, GitHub tricks, agent/skill/MCP mining from Hamza plugin-builder handoff',
  },
  {
    id: 'tools13',
    name: 'Hub Boss Tools Recovery 13',
    description:
      '13 referenced Hub Boss tools (SEO audit, Lapian, nanoMuse, n8n, ECC, Goose, Headroom, models, …)',
  },
] as const;

export function listAgents(pack?: string): AgentDef[] {
  const ready = modelConfigured();
  return catalog
    .filter((a) => !pack || a.pack === pack)
    .map((a) => ({ ...a, model_ready: ready }));
}

export function getAgent(id: string): AgentDef | null {
  return listAgents().find((a) => a.id === id) ?? null;
}

export function loadRoleInstructions(agentId: string): string {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`unknown agent: ${agentId}`);
  const parts: string[] = [`# ${agent.id}\nPack: ${agent.pack}\n${agent.description}\n`];
  if (agent.upstream) {
    const p = path.join(ROOT, agent.upstream);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p, 'utf8').slice(0, 20_000));
  }
  if (agent.profile) {
    const p = path.join(ROOT, agent.profile);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p, 'utf8').slice(0, 8_000));
  }
  // Pack-local markdown agent briefs
  const brief = path.join(ROOT, 'packs', agent.pack, 'agents', `${agent.id}.md`);
  if (fs.existsSync(brief)) parts.push(fs.readFileSync(brief, 'utf8'));
  return parts.join('\n---\n');
}

export function assertCatalog(): void {
  const ids = catalog.map((a) => a.id);
  if (ids.length < 87) {
    throw new Error(`expected >=87 agents (hub+browse+freellmapi+desk+forge+ecc68+tools13), got ${ids.length}`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('duplicate agent ids');
  const packs = new Set(catalog.map((a) => a.pack));
  for (const required of ['hub', 'desk', 'ecc68', 'forge', 'tools13']) {
    if (!packs.has(required)) throw new Error(`missing pack: ${required}`);
  }
  const ecc = catalog.filter((a) => a.pack === 'ecc68');
  if (ecc.length !== 68) throw new Error(`ecc68 pack must have 68 agents, got ${ecc.length}`);
  const t13 = catalog.filter((a) => a.pack === 'tools13');
  if (t13.length !== 13) throw new Error(`tools13 pack must have 13 agents, got ${t13.length}`);
  const boss = catalog.find((a) => a.id === 'hub-boss');
  if (
    !boss?.tools.includes('hub_full_roster') ||
    !boss.tools.includes('hub_list_agents') ||
    !boss.tools.includes('hub_agent_browse')
  ) {
    throw new Error('hub-boss must include hub_full_roster, hub_list_agents, hub_agent_browse');
  }
  const browser = catalog.find((a) => a.id === 'hub-agent-browse');
  if (!browser?.tools.includes('hub_agent_browse')) {
    throw new Error('hub-agent-browse must include hub_agent_browse tool');
  }
  // Catalog browsing and web automation are different jobs on purpose: the two
  // were conflated, which is why a search for "browser" returned no web agent.
  const web = catalog.find((a) => a.id === 'hub-web-browser');
  if (!web?.tools.includes('browser_navigate') || !web.tools.includes('browser_snapshot')) {
    throw new Error('hub-web-browser must include browser_navigate and browser_snapshot');
  }
  if (web.tools.includes('hub_agent_browse')) {
    throw new Error('hub-web-browser must not hold catalog-browse tools');
  }
}
