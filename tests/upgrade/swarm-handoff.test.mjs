import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFromSpec, planIsEven, runHandoff } from '../../scripts/swarm/handoff.mjs';
import { completeWithProviders } from '../../scripts/swarm/providers.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('local workers hand a spec to code and a passing test report', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'ruflo-handoff-'));
  try {
    const receipt = await runHandoff({
      repoRoot,
      workDir,
      task: { kind: 'is-even' },
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.plannerSource, 'local-worker');
    assert.deepEqual(receipt.handoffs.map(item => item.from), ['planner', 'coder', 'tester']);
    assert.equal(receipt.agents[1].source, '.claude/agents/core/coder.md');
    const spec = JSON.parse(readFileSync(join(workDir, 'spec.json'), 'utf8'));
    const code = readFileSync(join(workDir, 'is-even.mjs'), 'utf8');
    assert.match(code, new RegExp(`function ${spec.functionName}`));
    assert.match(code, new RegExp(spec.errorName));
    const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(report.results.length, 3);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('coder output follows the planner spec, including the error name', () => {
  const spec = planIsEven({ kind: 'is-even' });
  spec.errorName = 'not-finite';
  const code = codeFromSpec(spec);
  assert.match(code, /not-finite/);
  assert.doesNotMatch(code, /throw new Error\("nan"\)/);
});

test('a failing provider falls through to the next and that spec is what gets coded', async () => {
  const first = await listen((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unavailable' }));
  });
  const spec = planIsEven({ kind: 'is-even' });
  const second = await listen((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(body.model, 'second-model');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(spec) } }],
      }));
    });
  });
  const workDir = mkdtempSync(join(tmpdir(), 'ruflo-provider-'));
  try {
    const receipt = await runHandoff({
      repoRoot,
      workDir,
      task: { kind: 'is-even' },
      complete: async request => {
        const result = await completeWithProviders([
          { id: 'down', baseUrl: first.url, model: 'first-model' },
          { id: 'up', baseUrl: second.url, model: 'second-model', apiKey: 'test-key' },
        ], request);
        assert.equal(result.providerId, 'up');
        assert.equal(result.attempts.length, 1);
        assert.match(result.attempts[0].error, /HTTP 503/);
        if (request.role === 'coder') return codeFromSpec(spec);
        if (request.role === 'tester') return JSON.stringify({ passed: true, results: [] });
        return result.content;
      },
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.plannerSource, 'model');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    await first.close();
    await second.close();
  }
});

test('planner, coder, and tester each call complete and pass the file along', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'ruflo-roles-'));
  const roles = [];
  try {
    const receipt = await runHandoff({
      repoRoot,
      workDir,
      task: { kind: 'is-even' },
      complete: async request => {
        roles.push(request.role);
        if (request.role === 'planner') return JSON.stringify(planIsEven({ kind: 'is-even' }));
        if (request.role === 'coder') {
          assert.match(request.prompt, /spec\.json/);
          assert.match(request.prompt, /isEven/);
          return codeFromSpec(planIsEven({ kind: 'is-even' }));
        }
        assert.equal(request.role, 'tester');
        assert.match(request.prompt, /export function isEven/);
        return JSON.stringify({ passed: true, results: [{ args: [2], pass: true }] });
      },
    });
    assert.deepEqual(roles, ['planner', 'coder', 'tester']);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.plannerSource, 'model');
    assert.equal(receipt.coderSource, 'model');
    assert.equal(receipt.testerSource, 'model');
    assert.match(readFileSync(join(workDir, 'is-even.mjs'), 'utf8'), /export function isEven/);
    const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf8'));
    assert.equal(report.passed, true);
    const executed = JSON.parse(readFileSync(join(workDir, 'executed.json'), 'utf8'));
    assert.equal(executed.passed, true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('a 400 from the first provider does not call the second', async () => {
  let secondHits = 0;
  const first = await listen((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad prompt' }));
  });
  const second = await listen((req, res) => {
    secondHits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
  try {
    await assert.rejects(
      () => completeWithProviders([
        { id: 'bad', baseUrl: first.url, model: 'm' },
        { id: 'spare', baseUrl: second.url, model: 'm' },
      ], { system: 's', prompt: 'p' }),
      /HTTP 400/,
    );
    assert.equal(secondHits, 0);
  } finally {
    await first.close();
    await second.close();
  }
});

function listen(handler) {
  const server = createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((done, reject) => server.close(err => err ? reject(err) : done())),
      });
    });
  });
}
