import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DROPPED_TOOLS, hubCallThroughAdapter, mergedHubTools, swarmUseHubAgent } from '../../scripts/swarm/hub-bridge.mjs';
import { DROPPED_HUB_AGENTS, loadMergedAgents, loadUniqueAgents } from '../../scripts/bench/load-agents.mjs';

test('swarm runs a hub agent and drops the duplicate role', async () => {
  const used = await swarmUseHubAgent({ agentId: 'hub-agent-browse', query: 'planner' });
  assert.equal(used.direction, 'swarm-uses-hub');
  assert.equal(used.ranHub, true);
  assert.equal(used.agent.id, 'hub-agent-browse');
  assert.ok(used.hits.length > 0);
  assert.equal(used.tools.includes('browser_snapshot'), false);
  assert.equal(used.tools.includes('hub_agent_browse'), true);

  const dropped = await swarmUseHubAgent({ agentId: 'ecc-planner' });
  assert.equal(dropped.dropped, true);
  assert.equal(dropped.ranHub, false);
  assert.equal(dropped.kept, 'planner');
  assert.match(dropped.agent.source, /planner\.md$/);
});

test('hub calls the ruflo planner coder and tester', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'hub-calls-ruflo-'));
  try {
    const result = await hubCallThroughAdapter({ workDir, role: 'planner' });
    assert.equal(result.direction, 'hub-calls-ruflo');
    assert.equal(result.agent.name, 'planner');
    assert.equal(result.receipt.ok, true);
    assert.equal(result.receipt.passed, 3);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('merged agents keep the ruflo set and omit duplicate hub roles', () => {
  const unique = loadUniqueAgents();
  assert.equal(unique.length, 162);
  const merged = loadMergedAgents();
  const names = new Set(merged.map(agent => agent.name));
  assert.equal(names.size, merged.length);
  assert.ok(merged.length > unique.length);
  assert.ok(names.has('hub-boss'));
  assert.ok(names.has('planner'));
  for (const item of DROPPED_HUB_AGENTS) {
    assert.equal(names.has(item.id), false);
    assert.ok(names.has(item.kept));
  }
  assert.deepEqual(mergedHubTools(['browser_snapshot', 'hub_health', ...DROPPED_TOOLS.map(item => item.name)]), ['hub_health']);
});
