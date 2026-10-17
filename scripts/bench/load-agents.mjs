/**
 * Load the same 162 unique Ruflo agents the judge harness loads.
 * Lowest group weight wins. This file does not call a model.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const GROUPS = [
  { dir: join(repoRoot, '.ruflo', 'agents'), weight: 0 },
  { dir: join(repoRoot, '.claude', 'agents'), weight: 1 },
  { dir: join(repoRoot, 'plugins'), weight: 2, filter: path => path.split(sep).includes('agents') },
  { dir: join(repoRoot, 'v3', '@claude-flow', 'cli', '.claude', 'agents'), weight: 3 },
  { dir: join(repoRoot, 'v3', '@claude-flow', 'mcp', '.claude', 'agents'), weight: 3 },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body };
}

export function loadUniqueAgents() {
  const found = [];
  for (const group of GROUPS) {
    for (const file of walk(group.dir)) {
      if (group.filter && !group.filter(file)) continue;
      const name = basename(file);
      if (name === 'README.md' || name === 'MIGRATION_SUMMARY.md') continue;
      if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
      let agent;
      if (name.endsWith('.json')) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        agent = {
          name: String(parsed.name || basename(file, '.json')),
          description: String(parsed.description || ''),
          instructions: String(parsed.instructions || ''),
          source: relative(repoRoot, file).split(sep).join('/'),
        };
      } else {
        const parsed = splitFrontmatter(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const filename = basename(file, '.md');
        agent = {
          name: (parsed.data.name || filename).replace(/\s+/g, ' ').trim(),
          description: (parsed.data.description || '').replace(/\s+/g, ' ').trim(),
          instructions: parsed.body.trim(),
          source: relative(repoRoot, file).split(sep).join('/'),
        };
      }
      found.push({ ...agent, weight: group.weight });
    }
  }
  found.sort((a, b) => a.weight - b.weight || a.source.localeCompare(b.source));
  const winners = new Map();
  const duplicateCount = new Map();
  for (const agent of found) {
    duplicateCount.set(agent.name, (duplicateCount.get(agent.name) || 0) + 1);
    if (!winners.has(agent.name)) winners.set(agent.name, agent);
  }
  return [...winners.values()].map(agent => ({
    ...agent,
    copies: duplicateCount.get(agent.name) || 1,
  }));
}

const KIND_PATTERNS = [
  [/trad|market|backtest|ohlcv|candlestick/, 'trading'],
  [/security|audit|pii|injection|cve|threat/, 'security'],
  [/test|tdd|qa|validator|coverage/, 'test'],
  [/doc|readme|openapi|swagger/, 'docs'],
  [/architect|design|adr|domain|ddd/, 'architecture'],
  [/planner|coordinator|orchestrat|swarm|queen|hive|workflow/, 'planning'],
  [/memory|vector|embed|hnsw|rag|agentdb/, 'memory'],
  [/coder|developer|implement|typescript|python|backend|frontend|mobile/, 'code'],
  [/review/, 'review'],
  [/research|analyst|scout|dossier|horizon/, 'research'],
  [/perf|benchmark|optim|load|resource|topology/, 'perf'],
  [/browser|playwright/, 'browser'],
  [/git|github|pull request|pr-manager|release/, 'git'],
  [/music|lyric|composer/, 'music'],
];

export function domainKind(agent) {
  const blob = `${agent.name} ${agent.description}`.toLowerCase();
  for (const [pattern, kind] of KIND_PATTERNS) {
    if (pattern.test(blob)) return kind;
  }
  return 'general';
}

/** Hub roles that are the same job as a Ruflo agent. They are not scored twice. */
export const DROPPED_HUB_AGENTS = [
  { id: 'ecc-architect', kept: 'architect' },
  { id: 'ecc-planner', kept: 'planner' },
  { id: 'ecc-performance-optimizer', kept: 'performance-optimizer' },
];

function hubInstructions(agent) {
  const parts = [agent.description || ''];
  const candidates = [agent.profile, agent.upstream, join('packs', agent.pack, 'agents', `${agent.id}.md`)];
  for (const rel of candidates) {
    if (!rel) continue;
    const abs = join(repoRoot, 'hub/hamza-agent-hub', rel);
    if (!existsSync(abs)) continue;
    parts.push(readFileSync(abs, 'utf8').slice(0, 4000));
    break;
  }
  return parts.filter(Boolean).join('\n').slice(0, 8000);
}

export function loadMergedAgents() {
  const base = loadUniqueAgents().map(agent => ({ ...agent, origin: 'ruflo' }));
  const names = new Set(base.map(agent => agent.name));
  const dropped = new Set(DROPPED_HUB_AGENTS.map(item => item.id));
  const catalogPath = join(repoRoot, 'hub/hamza-agent-hub/src/runtime/catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const extra = [];
  for (const agent of catalog) {
    if (names.has(agent.id) || dropped.has(agent.id)) continue;
    extra.push({
      name: agent.id,
      description: String(agent.description || ''),
      instructions: hubInstructions(agent),
      source: `hub/hamza-agent-hub/src/runtime/catalog.json#${agent.id}`,
      copies: 1,
      origin: 'hub',
    });
    names.add(agent.id);
  }
  return [...base, ...extra];
}
