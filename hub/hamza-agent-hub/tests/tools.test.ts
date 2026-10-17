/**
 * Tools13 and tool-surface audit (Parts 7 and 8).
 *
 * Executes a real smoke check for every tool that can run here, and requires a
 * named blocker for every tool that cannot. The point is that no tool is
 * reported as working without something having actually run it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EXTERNAL_TOOLS,
  SMOKE_CHECKS,
  allExposedTools,
  runSmokeCheck,
  smokeCheckedTools,
} from '../src/tools/smoke.js';
import { auditAgents, auditSummary } from '../src/runtime/audit.js';
import { listAgents } from '../src/runtime/registry.js';
import { profileFor } from '../src/runtime/capabilities.js';
import { planWithBoss } from '../src/runtime/boss.js';
import { tools13Capabilities } from '../src/packs/tools13/offline.js';
import { closeDb } from '../src/storage/db.js';

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-tools-'));
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

it('covers every exposed tool with either a smoke check or a named blocker', () => {
  const checked = new Set(smokeCheckedTools());
  const uncovered = allExposedTools().filter((t) => !checked.has(t) && !EXTERNAL_TOOLS[t]);
  expect(uncovered).toEqual([]);

  // A blocker must say what is missing, not merely that something is.
  for (const [tool, reason] of Object.entries(EXTERNAL_TOOLS)) {
    expect(reason.length, `${tool} needs a specific blocker`).toBeGreaterThan(20);
  }
});

// Each check runs the tool through the same dispatch an agent uses.
for (const check of SMOKE_CHECKS) {
  it(`smoke: ${check.tool}`, async () => {
    const result = await runSmokeCheck(check);
    expect(result.ok, `${check.tool}: ${result.detail}`).toBe(true);
  });
}

it('reports Tools13 honestly: 13 catalogued, 8 blocked, 5 with local alternatives', () => {
  const caps = tools13Capabilities();
  expect(caps).toHaveLength(13);
  expect(caps.filter((c) => c.status === 'BLOCKED')).toHaveLength(8);
  expect(caps.filter((c) => c.status === 'LOCAL_ALTERNATIVE')).toHaveLength(5);

  // A local alternative must name its runner, and must not imply the upstream
  // service is running.
  for (const cap of caps.filter((c) => c.status === 'LOCAL_ALTERNATIVE')) {
    expect(cap.runner, `${cap.id} claims a local alternative with no runner`).toBeTruthy();
  }
  for (const cap of caps.filter((c) => c.status === 'BLOCKED')) {
    expect(cap.runner).toBeNull();
    expect(cap.hint.length).toBeGreaterThan(10);
  }
});

it('audits every registered agent with evidence rather than a declared flag', async () => {
  const audit = await auditAgents();
  expect(audit).toHaveLength(listAgents().length);

  for (const row of audit) {
    expect(['READY', 'LIMITED', 'BLOCKED', 'UNTESTED']).toContain(row.readiness);
    expect(row.readiness_reason.length).toBeGreaterThan(10);
    // Every agent must declare what it needs, even when the answer is nothing.
    expect(Array.isArray(row.runtime_dependencies)).toBe(true);
    expect(Array.isArray(row.limitations)).toBe(true);
    // Verified tool counts are derived from executed checks, so they can never
    // exceed the number of tools the agent actually holds.
    expect(row.verified_tools.length).toBeLessThanOrEqual(row.tools.length);
  }
});

it('never claims an agent is verified without a passing tool check', async () => {
  const audit = await auditAgents();
  for (const row of audit) {
    if (row.evidence === 'all_tools_executed') {
      expect(row.verified_tools.length, `${row.agent_id} claims full execution evidence`).toBe(row.tools.length);
      expect(row.unverified_tools).toEqual([]);
    }
    if (row.evidence === 'some_tools_executed') {
      expect(row.verified_tools.length).toBeGreaterThan(0);
      expect(row.unverified_tools.length).toBeGreaterThan(0);
    }
    // No passing check means no claim of execution, whatever the catalog says.
    if (row.verified_tools.length === 0) {
      expect(['declared_only', 'none']).toContain(row.evidence);
    }
  }
});

it('upgrades readiness only on evidence, never past a real blocker', async () => {
  const audit = await auditAgents();
  for (const row of audit) {
    // A measured upgrade is only ever from UNTESTED; a missing model or a dead
    // upstream must survive the audit untouched.
    if (row.readiness !== row.declared_readiness) {
      expect(row.declared_readiness, `${row.agent_id} was upgraded from a real blocker`).toBe('UNTESTED');
      expect(['READY', 'LIMITED']).toContain(row.readiness);
      expect(row.verified_tools.length).toBeGreaterThan(0);
    }
    if (row.readiness === 'READY') {
      expect(row.requires_model && !row.model_ready, `${row.agent_id} is READY while needing an absent model`).toBe(false);
    }
  }
});

it('leaves no agent holding a tool the dispatch cannot run', async () => {
  // 68 ECC agents were granted workspace_stat, 32 workspace_mkdir and 5
  // list_specialists, none of which existed, so every such call failed with
  // "unknown tool". They are implemented now, so nothing should report that.
  const audit = await auditAgents();
  const phantom = audit.flatMap((row) =>
    row.unverified_tools
      .filter((u) => /no executable smoke check exists/.test(u.reason))
      .map((u) => `${row.agent_id}:${u.tool}`)
  );
  expect(phantom).toEqual([]);
});

it('routes on the same readiness the audit reports', async () => {
  // The console showed a plan claiming UNTESTED beside an audit claiming READY,
  // because routing used the synchronous classification and the audit used
  // executed evidence. Once the checks have run there is one answer.
  const audit = await auditAgents();
  for (const row of audit) {
    expect(profileFor(row.agent_id)?.readiness, `${row.agent_id} routes on a different readiness than it audits`).toBe(
      row.readiness
    );
  }
  const plan = planWithBoss('Clean the lead list then audit the SEO of the landing page then review the python code.');
  for (const subtask of plan.decomposition) {
    const row = audit.find((a) => a.agent_id === subtask.agent_id)!;
    expect(subtask.readiness).toBe(row.readiness);
  }
});

it('summarises the roster without double counting catalog entries as capability', async () => {
  const summary = await auditSummary();
  expect(summary.total).toBe(listAgents().length);
  const classified = summary.ready + summary.limited + summary.blocked + summary.untested;
  expect(classified).toBe(summary.total);
  // Blocked Tools13 agents must appear as blocked, not as operational capability.
  expect(summary.blocked).toBeGreaterThan(0);
  const evidenced = summary.all_tools_executed + summary.some_tools_executed + summary.declared_only;
  expect(evidenced).toBeLessThanOrEqual(summary.total);
});
