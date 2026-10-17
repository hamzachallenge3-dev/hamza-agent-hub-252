import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCode, checkExact, checkJson } from '../../scripts/bench/checks.mjs';
import { domainKind, loadUniqueAgents } from '../../scripts/bench/load-agents.mjs';
import { tasksFor } from '../../scripts/bench/agent-tasks.mjs';
import { runOneSwarm } from '../../scripts/bench/run-swarm-bench.mjs';
import { SWARM_TASKS } from '../../scripts/bench/swarm-tasks.mjs';
import { improveSource } from '../../scripts/bench/improve-agents.mjs';
import { applyKaggleCompletions } from '../../scripts/bench/run-kaggle-bench.mjs';

const LIMIT = 'I will not claim a result without evidence from this turn.';

test('exact and json checks reject neighbors of the known value', () => {
  assert.equal(checkExact('sql injection', 'sql injection').pass, true);
  assert.equal(checkExact('```\nsql injection\n```', 'sql injection').pass, true);
  assert.equal(checkExact('SQL injection', 'sql injection').pass, false);
  assert.equal(checkExact('sql injection.', 'sql injection').pass, false);
  const expected = { agent: 'coder', errorName: 'nan', functionName: 'isEven' };
  assert.equal(checkJson(JSON.stringify({ functionName: 'isEven', agent: 'coder', errorName: 'nan' }), expected).pass, true);
  assert.equal(checkJson(JSON.stringify({ ...expected, extra: true }), expected).pass, false);
});

test('code checks run the exported function', async () => {
  const even = await checkCode(`
    export function isEven(n) {
      if (!Number.isFinite(n)) throw new Error("nan");
      return n % 2 === 0;
    }
  `, tasksFor({ name: 'coder', description: 'Implementation specialist' })[1]);
  assert.equal(even.pass, true);
  const wrong = await checkCode('export function isEven(n) { return n === 2; }', tasksFor({ name: 'coder', description: 'coder' })[1]);
  assert.equal(wrong.pass, false);
});

test('every loaded agent has three domain tasks and the file names that agent', () => {
  const agents = loadUniqueAgents();
  assert.equal(agents.length, 162);
  const kinds = new Set();
  for (const agent of agents) {
    const tasks = tasksFor(agent);
    assert.equal(tasks.length, 3);
    assert.deepEqual(tasks.map(task => task.type), ['value', 'code', 'file']);
    assert.equal(tasks[2].expected.agent, agent.name);
    kinds.add(tasks[0].kind);
  }
  assert.equal(domainKind({ name: 'market-analyst', description: '' }), 'trading');
  assert.equal(domainKind({ name: 'notes', description: 'writes notes' }), 'general');
  assert.ok(kinds.has('general'));
});

test('a swarm passes only when the coder module passes the cases', async () => {
  const task = SWARM_TASKS[0];
  const workDir = mkdtempSync(join(tmpdir(), 'bench-swarm-'));
  const roles = [];
  try {
    const good = await runOneSwarm(task, {
      workDir,
      systemFor: role => role,
      complete: async request => {
        roles.push(request.role);
        if (request.role === 'planner') return JSON.stringify({ functionName: 'isEven', behavior: 'even check' });
        if (request.role === 'coder') {
          assert.match(request.prompt, /isEven/);
          return 'export function isEven(n) { if (!Number.isFinite(n)) throw new Error("nan"); return n % 2 === 0; }\n';
        }
        assert.match(request.prompt, /export function isEven/);
        return JSON.stringify({ passed: true });
      },
    });
    assert.deepEqual(roles, ['planner', 'coder', 'tester']);
    assert.equal(good.pass, true);
    const badDir = mkdtempSync(join(tmpdir(), 'bench-swarm-bad-'));
    const bad = await runOneSwarm(task, {
      workDir: badDir,
      systemFor: () => '',
      complete: async request => {
        if (request.role === 'planner') return JSON.stringify({ functionName: 'isEven', behavior: 'even check' });
        if (request.role === 'coder') return 'export function isEven() { return true; }\n';
        return JSON.stringify({ passed: true });
      },
    });
    assert.equal(bad.pass, false);
    rmSync(badDir, { recursive: true, force: true });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('prompt improvement inserts one contract and does not change a task expected value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-prompt-'));
  const source = 'agents/example.md';
  const path = join(dir, source);
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(path, '---\nname: example\n---\nYou are example.\n');
  try {
    assert.equal(improveSource(source, dir), true);
    assert.equal(improveSource(source, dir), false);
    const text = readFileSync(path, 'utf8');
    assert.match(text, /Reply with only/);
    assert.match(text, /name: example/);
    const task = tasksFor({ name: 'example', description: 'notes' })[0];
    assert.equal(task.expected, LIMIT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gap apply keeps a finished check failure and grades a missing task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-gap-'));
  const outPath = join(dir, 'tasks.json');
  writeFileSync(outPath, JSON.stringify({
    model: 'openai/gpt-oss-120b',
    agents: [{
      name: 'security-manager',
      source: '.claude/agents/consensus/security-manager.md',
      tasks: [{ id: 'security-manager#1', type: 'value', pass: false, detail: 'got sentence', output: 'nope' }],
      complete: false,
      passed: 0,
    }],
  }));
  try {
    const applied = await applyKaggleCompletions({
      outPath,
      completions: [
        { id: 'security-manager#1', content: 'sql injection', model: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
        { id: 'coder#1', content: 'nan', model: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
      ],
      modelInfo: { loaded: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
      gapOnly: true,
    });
    const saved = JSON.parse(readFileSync(outPath, 'utf8'));
    const security = saved.agents.find(row => row.name === 'security-manager');
    assert.equal(security.tasks[0].pass, false);
    assert.equal(security.tasks[0].detail, 'got sentence');
    const coder = saved.agents.find(row => row.name === 'coder');
    assert.equal(coder.tasks[0].pass, true);
    assert.equal(coder.tasks[0].model, 'Qwen/Qwen2.5-Coder-7B-Instruct');
    assert.equal(applied.graded, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
