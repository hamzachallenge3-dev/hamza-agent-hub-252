/**
 * Benchmark gate (Part 11).
 *
 * The suite in src/runtime/benchmark.ts is the measurement; this file is the
 * gate. Routing accuracy must stay at 100% of the declared cases, so a change
 * that re-breaks any of the originally reported routing defects fails CI
 * instead of quietly lowering the score.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BENCHMARK_CASES, runBenchmark } from '../src/runtime/benchmark.js';
import { CAPABILITIES } from '../src/runtime/capabilities.js';
import { planWithBoss } from '../src/runtime/boss.js';
import { closeDb } from '../src/storage/db.js';

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-bench-'));
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_DATA_DIR', path.join(base, 'data'));
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  vi.stubEnv('HAH_FREELLMAPI_URL', '');
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
});

afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

it('has at least 20 representative missions covering most capabilities', () => {
  expect(BENCHMARK_CASES.length).toBeGreaterThanOrEqual(20);

  const ids = BENCHMARK_CASES.map((c) => c.id);
  expect(new Set(ids).size, 'benchmark case ids must be unique').toBe(ids.length);

  // Every case must state what it is for, so a future reader can tell whether
  // changing it is a fix or a cover-up.
  for (const testCase of BENCHMARK_CASES) expect(testCase.notes.length).toBeGreaterThan(20);

  // Every capability in the closed vocabulary has a mission that asks for it,
  // so a routing change cannot leave one silently unexercised.
  const exercised = new Set(BENCHMARK_CASES.map((c) => c.expect_capability).filter(Boolean));
  expect(CAPABILITIES.filter((c) => !exercised.has(c))).toEqual([]);
});

it('gives every capability a readable role label', async () => {
  // An unlabelled capability fell through to its raw id, so a build-fix subtask
  // was shown to the operator with the role "code.build_fix".
  const missions: Record<string, string> = {
    'code.build_fix': 'Fix the failing build and prove the tests pass',
    'media.process': 'Extract frames from the video with ffmpeg',
    'workflow.validate': 'Validate this n8n workflow json',
    'context.compact': 'Compress this 40000 line log into the relevant context',
    'model.gateway': 'Connect the hub to the FreeLLMAPI model gateway',
    'shell.execute': 'Run the test suite using a shell command',
  };
  for (const [capability, mission] of Object.entries(missions)) {
    const plan = planWithBoss(mission);
    const subtask = plan.decomposition.find((s) => s.capability === capability);
    expect(subtask, `${capability} was not routed by its own mission`).toBeTruthy();
    expect(subtask!.role, `${capability} has no role label`).not.toBe(capability);
  }
});

it('routes every benchmark mission correctly', async () => {
  const report = await runBenchmark();
  const failures = report.cases.filter((c) => !c.ok);
  expect(
    failures.map((f) => `${f.id} (${f.primary}): ${f.failures.join('; ')}`),
    'routing regressions'
  ).toEqual([]);
  expect(report.routing_accuracy).toBe(1);
  expect(report.tool_success_rate).toBe(1);
});

it('never assigns a BLOCKED agent as an unflagged worker across the whole suite', async () => {
  const report = await runBenchmark();
  for (const result of report.cases) {
    expect(result.primary_readiness, `${result.id} routed to a BLOCKED primary`).not.toBe('BLOCKED');
  }
});

it('keeps planning latency well inside the request budget', async () => {
  const report = await runBenchmark();
  // Planning is pure in-process scoring over 93 agents; if it ever approaches a
  // second, something has started doing I/O inside the planner.
  expect(report.latency_ms.p95).toBeLessThan(250);
});
