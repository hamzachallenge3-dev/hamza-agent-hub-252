#!/usr/bin/env node
/**
 * Time the local planner -> coder -> tester handoff.
 *   node scripts/bench-swarm-handoff.mjs --runs 30
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHandoff } from './swarm/handoff.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const runs = Number(process.argv.includes('--runs')
  ? process.argv[process.argv.indexOf('--runs') + 1]
  : 30);
const samples = [];
const root = mkdtempSync(join(tmpdir(), 'ruflo-bench-'));
try {
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    const receipt = await runHandoff({
      repoRoot,
      workDir: join(root, String(i)),
      task: { kind: 'is-even' },
    });
    if (!receipt.ok) throw new Error(`run ${i} failed`);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
samples.sort((a, b) => a - b);
const sum = samples.reduce((total, value) => total + value, 0);
const pick = quantile => samples[Math.min(samples.length - 1, Math.floor(quantile * (samples.length - 1)))];
process.stdout.write(`${JSON.stringify({
  runs,
  unit: 'ms',
  mean: Math.round((sum / samples.length) * 100) / 100,
  p50: Math.round(pick(0.5) * 100) / 100,
  p95: Math.round(pick(0.95) * 100) / 100,
  min: Math.round(samples[0] * 100) / 100,
  max: Math.round(samples[samples.length - 1] * 100) / 100,
}, null, 2)}\n`);
