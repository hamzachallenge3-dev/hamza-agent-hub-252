#!/usr/bin/env node
/**
 * Copy templates/agent.md into .ruflo/agents/<name>.md.
 * RUFLO_AGENT_ROOT overrides the project root (used by tests).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.RUFLO_AGENT_ROOT || scriptRoot;
const name = process.argv[2];
const description = process.argv.slice(3).join(' ').replace(/\s+/g, ' ').trim()
  || 'Describe what this agent is for.';

if (!name || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
  console.error('Usage: node scripts/new-agent.mjs <name> [description]');
  console.error('Name: a letter, then letters, numbers, hyphens, or underscores (max 64).');
  process.exit(1);
}

const dir = join(root, '.ruflo', 'agents');
mkdirSync(dir, { recursive: true });
const destination = join(dir, `${name}.md`);
if (existsSync(destination)) {
  console.error(`Already exists: ${destination}`);
  process.exit(1);
}

const template = readFileSync(join(scriptRoot, 'templates', 'agent.md'), 'utf8');
writeFileSync(
  destination,
  template.replaceAll('{{name}}', name).replaceAll('{{description}}', description),
);
console.log(destination);
