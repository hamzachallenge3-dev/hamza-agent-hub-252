#!/usr/bin/env node
/**
 * Run the planner -> coder -> tester handoff.
 *
 *   node scripts/swarm-handoff.mjs --out /tmp/ruflo-swarm
 *   node scripts/swarm-handoff.mjs --settings ruflo.settings.json --out /tmp/ruflo-swarm
 *
 * Without settings, the planner is a local worker. With settings, the
 * planner calls the providers in order and the coder still consumes
 * the spec file the planner wrote.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHandoff } from './swarm/handoff.mjs';
import { completeWithProviders } from './swarm/providers.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const out = args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), 'ruflo-swarm-'));

let complete;
if (args.settings) {
  const settings = JSON.parse(readFileSync(resolve(args.settings), 'utf8'));
  const providers = (settings.providers || []).filter(provider => provider.enabled !== false);
  complete = async request => {
    const result = await completeWithProviders(providers, request);
    process.stderr.write(`planner provider=${result.providerId}\n`);
    return result.content;
  };
}

const receipt = await runHandoff({
  repoRoot,
  workDir: out,
  task: { kind: 'is-even' },
  complete,
});
process.stdout.write(`${JSON.stringify({ out, ...receipt }, null, 2)}\n`);
if (!receipt.ok) process.exit(1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
