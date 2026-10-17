/**
 * Ruflo swarm calls Hub agents. Hub calls Ruflo agents.
 * Duplicate roles and tools are not executed a second time.
 */

import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadAgentPrompt } from './handoff.mjs';
import { loadUniqueAgents } from '../bench/load-agents.mjs';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const selfPath = fileURLToPath(import.meta.url);

export const DROPPED_AGENTS = [
  { id: 'ecc-architect', kept: 'architect', reason: 'same role as the Ruflo architect' },
  { id: 'ecc-planner', kept: 'planner', reason: 'same role as the Ruflo planner' },
  { id: 'ecc-performance-optimizer', kept: 'performance-optimizer', reason: 'same role as the Ruflo performance-optimizer' },
];

export const DROPPED_TOOLS = [
  { name: 'browser_snapshot', kept: 'ruflo browser_snapshot' },
  { name: 'browser_act', kept: 'ruflo browser_act' },
  { name: 'browser_screenshot', kept: 'ruflo browser_screenshot' },
];

const droppedIds = new Map(DROPPED_AGENTS.map(item => [item.id, item]));
const droppedTools = new Set(DROPPED_TOOLS.map(item => item.name));

let typesRegistered = false;

export function registerHubTypes() {
  if (typesRegistered) return;
  register(new URL('./ts-hub-resolve.mjs', import.meta.url), import.meta.url);
  typesRegistered = true;
}

function stripTypesOn() {
  return process.execArgv.includes('--experimental-strip-types');
}

function spawnMode(mode, input) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    selfPath,
    mode,
    JSON.stringify(input || {}),
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'hub bridge failed').trim();
    throw new Error(detail.slice(0, 500));
  }
  const line = result.stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

async function importHub(relativePath) {
  registerHubTypes();
  return import(pathToFileURL(join(repoRoot, 'hub/hamza-agent-hub', relativePath)).href);
}

export function mergedHubTools(names) {
  return names.filter(name => !droppedTools.has(name));
}

export async function swarmUseHubAgentInProcess({ agentId = 'hub-agent-browse', query = 'planner' } = {}) {
  const alias = droppedIds.get(agentId);
  if (alias) {
    const kept = loadUniqueAgents().find(agent => agent.name === alias.kept);
    let prompt = null;
    if (alias.kept === 'planner' || alias.kept === 'coder' || alias.kept === 'tester') {
      prompt = loadAgentPrompt(repoRoot, alias.kept);
    }
    return {
      direction: 'swarm-uses-hub',
      dropped: true,
      ranHub: false,
      droppedId: alias.id,
      kept: alias.kept,
      reason: alias.reason,
      agent: {
        id: alias.kept,
        source: prompt?.source || kept?.source || '',
        name: prompt?.name || kept?.name || alias.kept,
      },
    };
  }

  const { getAgent } = await importHub('src/runtime/registry.ts');
  const browse = await importHub('src/runtime/browse.ts');
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`unknown hub agent: ${agentId}`);
  const found = browse.browseEverything({ query, limit: 5 });
  return {
    direction: 'swarm-uses-hub',
    dropped: false,
    ranHub: true,
    agent: { id: agent.id, pack: agent.pack, description: agent.description },
    hits: found.hits.slice(0, 5).map(hit => ({ id: hit.id, kind: hit.kind })),
    droppedTools: DROPPED_TOOLS.map(item => item.name),
    tools: mergedHubTools(browse.MCP_SURFACE_TOOLS),
  };
}

export async function swarmUseHubAgent(input = {}) {
  if (input.agentId && droppedIds.has(input.agentId)) return swarmUseHubAgentInProcess(input);
  if (!stripTypesOn()) return spawnMode('swarm', input);
  return swarmUseHubAgentInProcess(input);
}

export async function hubCallRufloAgent({ repoRoot: root = repoRoot, workDir, role = 'planner' }) {
  const { runHandoff } = await import('./handoff.mjs');
  const agent = loadAgentPrompt(root, role);
  const receipt = await runHandoff({ repoRoot: root, workDir, task: { kind: 'is-even' } });
  return {
    direction: 'hub-calls-ruflo',
    agent: { role: agent.role, name: agent.name, source: agent.source },
    receipt,
  };
}

export async function hubCallThroughAdapter(input) {
  if (!stripTypesOn()) return spawnMode('hub', input);
  const { callRufloAgent } = await importHub('src/integrations/ruflo.ts');
  return callRufloAgent(input);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'swarm' && mode !== 'hub') return;
  const input = JSON.parse(process.argv[3] || '{}');
  const out = mode === 'swarm'
    ? await swarmUseHubAgentInProcess(input)
    : await hubCallThroughAdapter({ ...input, __inProcess: true });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

const invoked = process.argv[1] && process.argv[1].endsWith('hub-bridge.mjs');
if (invoked && (process.argv[2] === 'swarm' || process.argv[2] === 'hub')) {
  main().catch(err => {
    process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
    process.exit(1);
  });
}
