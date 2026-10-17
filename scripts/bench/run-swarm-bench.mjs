#!/usr/bin/env node
/**
 * Five end-to-end swarms. Planner, coder, and tester each call the model.
 * The pass bit is the automatic case check on the coder's module.
 *
 *   node scripts/bench/run-swarm-bench.mjs --out docs/bench/swarm-tasks.json
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { createGroqClient, DailyLimitError, FatalGroqError, GROQ_FREE_LIMITS, redact } from '../eval-groq.mjs';
import { extractJson, extractModule } from '../swarm/handoff.mjs';
import { checkCode } from './checks.mjs';
import { loadUniqueAgents } from './load-agents.mjs';
import { SWARM_TASKS, plannerPrompt, coderPrompt, testerPrompt } from './swarm-tasks.mjs';

const MODEL = GROQ_FREE_LIMITS.model;

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

function rolePrompt(agents, role) {
  const agent = agents.find(item => item.name === role) || agents.find(item => item.name.includes(role));
  return (agent?.instructions || `You are the ${role}.`).slice(0, 400);
}

async function once(complete, request, accept) {
  let last = new Error('no attempt');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await complete({
      ...request,
      prompt: attempt === 1 ? request.prompt : `${request.prompt}\n\nPrevious answer was rejected: ${last.message}\nReturn only the artifact.`,
    });
    try {
      return { raw, value: accept(raw) };
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw last;
}

export async function runOneSwarm(task, { complete, systemFor, workDir }) {
  const calls = [];
  const planned = await once(
    complete,
    { role: 'planner', system: systemFor('planner'), prompt: plannerPrompt(task), json: true },
    raw => {
      const spec = extractJson(raw);
      if (spec.functionName !== task.exportName) throw new Error(`functionName was ${spec.functionName}`);
      return spec;
    },
  );
  calls.push({ role: 'planner', content: planned.raw });
  const specText = JSON.stringify(planned.value);
  writeFileSync(join(workDir, 'spec.json'), `${specText}\n`);
  const coded = await once(
    complete,
    { role: 'coder', system: systemFor('coder'), prompt: coderPrompt(task, specText), json: false },
    extractModule,
  );
  calls.push({ role: 'coder', content: coded.raw });
  writeFileSync(join(workDir, `${task.id}.mjs`), coded.value);
  const tested = await once(
    complete,
    { role: 'tester', system: systemFor('tester'), prompt: testerPrompt(task, specText, coded.value), json: true },
    raw => {
      const report = extractJson(raw);
      if (typeof report.passed !== 'boolean') throw new Error('tester JSON has no passed boolean');
      return report;
    },
  );
  calls.push({ role: 'tester', content: tested.raw });
  writeFileSync(join(workDir, 'report.json'), `${JSON.stringify(tested.value)}\n`);
  const executed = await checkCode(coded.value, task);
  return {
    id: task.id,
    pass: executed.pass === true,
    detail: executed.detail,
    testerPassed: tested.value.passed,
    calls: calls.map(call => ({ role: call.role, chars: call.content.length, content: call.content.slice(0, 500) })),
  };
}

export async function runSwarmBench({ outPath, logPath, log = () => {} } = {}) {
  if (!process.env.GROQ_API_KEY) throw new FatalGroqError('GROQ_API_KEY is unset');
  const client = createGroqClient({ model: MODEL, log });
  await client.confirm();
  const agents = loadUniqueAgents();
  const systemFor = role => rolePrompt(agents, role);
  const complete = async request => {
    const content = await client.chat(
      [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      request.json ? 400 : 360,
      0,
      Boolean(request.json),
    );
    if (!String(content || '').trim()) throw new Error(`${request.role} response was empty`);
    return content;
  };
  const results = [];
  let stoppedReason = '';
  mkdirSync(dirname(outPath), { recursive: true });
  for (const task of SWARM_TASKS) {
    const workDir = mkdtempSync(join(tmpdir(), `ruflo-swarm-${task.id}-`));
    try {
      const result = await runOneSwarm(task, { complete, systemFor, workDir });
      results.push({ ...result, model: MODEL, workDir });
      log(`${task.id} pass=${result.pass} ${result.detail}`);
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      if (err instanceof DailyLimitError || err.name === 'DailyLimitError' || /unset|HTTP 401|HTTP 403|daily/i.test(message)) {
        stoppedReason = message.slice(0, 300);
        results.push({ id: task.id, pass: false, stopped: true, detail: stoppedReason, calls: [] });
        break;
      }
      results.push({ id: task.id, pass: false, detail: message.slice(0, 300), calls: [] });
      log(`${task.id} fail ${message.slice(0, 160)}`);
    }
    writeFileSync(outPath, JSON.stringify({ model: MODEL, stoppedReason, results, groq: client.stats() }, null, 2));
    if (logPath) appendFileSync(logPath, `${JSON.stringify(results[results.length - 1])}\n`);
  }
  const payload = { model: MODEL, stoppedReason, passed: results.filter(item => item.pass).length, total: results.length, results, groq: client.stats() };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await runSwarmBench({
    outPath: args.out || 'docs/bench/swarm-tasks.json',
    logPath: args.log || 'docs/bench/swarm-tasks.jsonl',
    log: line => process.stderr.write(`${redact(line)}\n`),
  });
  process.stdout.write(`${JSON.stringify({ model: payload.model, passed: payload.passed, total: payload.total, stoppedReason: payload.stoppedReason, groq: payload.groq }, null, 2)}\n`);
  if (payload.stoppedReason) process.exitCode = 2;
}

const invoked = process.argv[1] && process.argv[1].endsWith('run-swarm-bench.mjs');
if (invoked) {
  main().catch(err => {
    process.stderr.write(`${redact(err instanceof Error ? err.stack || err.message : String(err))}\n`);
    process.exit(1);
  });
}
