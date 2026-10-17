/**
 * Agent definitions are markdown (or JSON) files. The body is the system
 * prompt. Declared tools are names for the host to provide; this loader
 * does not execute them.
 *
 * Search order for a name, first match wins:
 *   1. .ruflo/agents
 *   2. .claude/agents
 *   3. plugins / agents
 *   4. package-local .claude/agents copies under v3
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

export interface AgentDefinition {
  name: string;
  description: string;
  instructions: string;
  sourcePath: string;
  /** Relative to the project root when the file is inside it. */
  source: string;
  model?: string;
  provider?: string;
  declaredTools: string[];
  /** Short bullets taken from the prompt. This is what the file claims, not a measured result. */
  claimedCapabilities: string[];
  /** Every shipped definition is a prompt. None of them is an executable tool. */
  kind: 'prompt';
  issues: string[];
}

export interface AgentCatalog {
  root: string;
  definitions: AgentDefinition[];
  /** Same name, more than one file. The first entry is the one execution uses. */
  duplicates: Array<{ name: string; sources: string[] }>;
}

const AGENT_FILE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function loadAgentCatalog(projectRoot: string): AgentCatalog {
  const groups: Array<{ dir: string; weight: number; filter?: (path: string) => boolean }> = [
    { dir: join(projectRoot, '.ruflo', 'agents'), weight: 0 },
    { dir: join(projectRoot, '.claude', 'agents'), weight: 1 },
    {
      dir: join(projectRoot, 'plugins'),
      weight: 2,
      filter: path => path.split(sep).includes('agents'),
    },
    // Package-local copies. Same name as a root or plugin agent loses.
    // Names that exist only here are still real definitions.
    { dir: join(projectRoot, 'v3', '@claude-flow', 'cli', '.claude', 'agents'), weight: 3 },
    { dir: join(projectRoot, 'v3', '@claude-flow', 'mcp', '.claude', 'agents'), weight: 3 },
  ];
  const found: Array<{ definition: AgentDefinition; weight: number; depth: number }> = [];
  for (const group of groups) {
    for (const file of walkFiles(group.dir)) {
      if (group.filter && !group.filter(file)) continue;
      const name = basename(file);
      if (name === 'README.md' || name === 'MIGRATION_SUMMARY.md') continue;
      if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
      const definition = name.endsWith('.json') ? readJsonAgent(file, projectRoot) : readMarkdownAgent(file, projectRoot);
      found.push({ definition, weight: group.weight, depth: relative(group.dir, file).split(sep).length });
    }
  }
  found.sort((a, b) => a.weight - b.weight || a.depth - b.depth || a.definition.source.localeCompare(b.definition.source));
  const definitions = found.map(item => item.definition);
  const byName = new Map<string, string[]>();
  for (const definition of definitions) {
    const list = byName.get(definition.name) ?? [];
    list.push(definition.source);
    byName.set(definition.name, list);
  }
  const duplicates = [...byName.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([name, sources]) => ({ name, sources }));
  return { root: projectRoot, definitions, duplicates };
}

const SPAWN_TYPE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SPAWN_DISPLAY = /^[A-Za-z][A-Za-z0-9 _-]{0,80}$/;

/** Safe id stored for an agent. Spaces in display names such as "Benchmark Suite" become hyphens. */
export function slugAgentType(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/**
 * Accept a spawn type. A display name with spaces is accepted only when it
 * resolves to a catalog agent, and the returned value is the hyphenated id
 * that identifier checks allow.
 */
export function resolveSpawnAgentType(projectRoot: string, agentType: string): string | null {
  const trimmed = agentType.trim();
  if (!trimmed) return null;
  if (SPAWN_TYPE.test(trimmed)) return trimmed;
  if (!SPAWN_DISPLAY.test(trimmed)) return null;
  const slug = slugAgentType(trimmed);
  if (!SPAWN_TYPE.test(slug)) return null;
  // A display name is stored as its slug even when this directory has no
  // catalog copy. Shell metacharacters never reach this branch.
  void projectRoot;
  return slug;
}

export function instructionsForAgent(projectRoot: string, agentType: string): string | undefined {
  const wanted = agentType.trim().toLowerCase();
  const slug = slugAgentType(agentType);
  const match = loadAgentCatalog(projectRoot).definitions.find(definition => {
    const keys = lookupKeys(definition);
    return keys.includes(wanted) || keys.includes(slug);
  });
  if (!match || !match.instructions.trim()) return undefined;
  return match.instructions.trim();
}

function lookupKeys(definition: AgentDefinition): string[] {
  const filename = basename(definition.sourcePath).replace(/\.(md|json)$/i, '');
  const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [...new Set([definition.name.toLowerCase(), slug, filename.toLowerCase()])];
}

export function agentTypeChoices(projectRoot: string): Array<{ value: string; label: string; hint: string }> {
  const seen = new Set<string>();
  const choices: Array<{ value: string; label: string; hint: string }> = [];
  for (const definition of loadAgentCatalog(projectRoot).definitions) {
    if (seen.has(definition.name) || definition.issues.includes('missing name')) continue;
    seen.add(definition.name);
    choices.push({
      value: definition.name,
      label: definition.name,
      hint: definition.description || 'Custom agent',
    });
  }
  return choices;
}

export function createAgentFile(options: {
  projectRoot: string;
  name: string;
  description: string;
  templatePath: string;
}): string {
  if (!AGENT_FILE.test(options.name)) {
    throw new Error('Agent name must start with a letter and contain only letters, numbers, hyphens, and underscores (max 64).');
  }
  const destinationDir = join(options.projectRoot, '.ruflo', 'agents');
  mkdirSync(destinationDir, { recursive: true });
  const destination = join(destinationDir, `${options.name}.md`);
  if (existsSync(destination)) {
    throw new Error(`Agent file already exists: ${destination}`);
  }
  const template = readFileSync(options.templatePath, 'utf8');
  const description = options.description.replace(/\s+/g, ' ').trim();
  const contents = template
    .replaceAll('{{name}}', options.name)
    .replaceAll('{{description}}', description || 'Describe what this agent is for.');
  writeFileSync(destination, contents, 'utf8');
  return destination;
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function readMarkdownAgent(file: string, projectRoot: string): AgentDefinition {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = splitFrontmatter(raw);
  const data = parsed.data;
  const filename = basename(file).replace(/\.md$/, '');
  const issues: string[] = [];
  const name = cleanScalar(data.name) || filename;
  if (!cleanScalar(data.name)) issues.push('missing name');
  if (/[\\/\0]/.test(name)) issues.push('name has unsupported characters');
  const description = cleanScalar(data.description);
  if (!description) issues.push('missing description');
  const instructions = parsed.body.trim();
  if (instructions.length < 40) issues.push('instructions are missing or too short');
  return {
    name,
    description,
    instructions,
    sourcePath: file,
    source: toSource(projectRoot, file),
    model: cleanScalar(data.model) || undefined,
    provider: cleanScalar(data.provider) || undefined,
    declaredTools: splitTools(data.tools),
    claimedCapabilities: extractClaims(instructions, description),
    kind: 'prompt',
    issues,
  };
}

function readJsonAgent(file: string, projectRoot: string): AgentDefinition {
  const issues: string[] = [];
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('JSON agent must be an object');
    else parsed = value as Record<string, unknown>;
  } catch {
    issues.push('invalid JSON');
  }
  const filename = basename(file).replace(/\.json$/, '');
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : filename;
  if (typeof parsed.name !== 'string') issues.push('missing name');
  if (/[\\/\0]/.test(name)) issues.push('name has unsupported characters');
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  if (!description) issues.push('missing description');
  const instructions = typeof parsed.instructions === 'string' ? parsed.instructions.trim() : '';
  if (instructions.length < 40) issues.push('instructions are missing or too short');
  const tools = Array.isArray(parsed.tools)
    ? parsed.tools.filter((tool): tool is string => typeof tool === 'string')
    : splitTools(typeof parsed.tools === 'string' ? parsed.tools : '');
  return {
    name,
    description,
    instructions,
    sourcePath: file,
    source: toSource(projectRoot, file),
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
    provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
    declaredTools: tools,
    claimedCapabilities: extractClaims(instructions, description),
    kind: 'prompt',
    issues,
  };
}

function splitFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  return { data: parseFrontmatter(block), body };
}

function parseFrontmatter(block: string): Record<string, string> {
  const lines = block.split(/\r?\n/);
  const data: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const rest = match[2].trim();
    if (rest === '|' || rest === '>' || rest === '') {
      const folded = rest === '>';
      const chunks: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        if (lines[i + 1].trim() === '') {
          const next = lines.slice(i + 2).find(candidate => candidate.trim() !== '');
          if (!next || !/^\s+\S/.test(next)) break;
        }
        i++;
        chunks.push(lines[i].trim());
      }
      const items = chunks
        .map(chunk => chunk.replace(/^\-\s+/, '').replace(/\s+#.*$/, '').trim())
        .filter(Boolean);
      data[key] = rest === '' && chunks.some(chunk => chunk.trim().startsWith('-'))
        ? items.join(', ')
        : chunks.filter(Boolean).join(folded ? ' ' : '\n');
      continue;
    }
    data[key] = stripQuotes(rest);
  }
  return data;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function cleanScalar(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function splitTools(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(tool => tool.trim()).filter(Boolean);
}

function extractClaims(instructions: string, description: string): string[] {
  const claims: string[] = [];
  const lines = instructions.split(/\r?\n/);
  let capture = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (capture && claims.length) break;
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      if (capture && claims.length) break;
      capture = /capabilit|responsibilit|purpose|what you do|overview/i.test(line);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+\**([^*\n]{8,180})/);
    if (!bullet) continue;
    if (capture || claims.length < 4) {
      claims.push(bullet[1].replace(/\*\*/g, '').trim());
    }
    if (claims.length >= 6) break;
  }
  if (!claims.length && description) claims.push(description);
  return claims.slice(0, 6);
}

function toSource(projectRoot: string, file: string): string {
  const rel = relative(projectRoot, file);
  return rel.startsWith('..') ? file : rel.split(sep).join('/');
}
