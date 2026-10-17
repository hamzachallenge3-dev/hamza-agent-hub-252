#!/usr/bin/env node
/**
 * Run every loaded agent on its three automatic tasks through Groq.
 * Model is openai/gpt-oss-120b only. One request at a time.
 * A daily limit stops the run and keeps the rows already graded.
 *
 *   node scripts/bench/run-task-bench.mjs --out docs/bench/agent-tasks.json
 *   node scripts/bench/run-task-bench.mjs --resume --out docs/bench/agent-tasks.json
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGroqClient, DailyLimitError, FatalGroqError, GROQ_FREE_LIMITS, redact } from '../eval-groq.mjs';
import { loadMergedAgents, loadUniqueAgents } from './load-agents.mjs';
import { tasksFor } from './agent-tasks.mjs';
import { gradeTask } from './checks.mjs';

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

function tokensFor(task) {
  if (task.type === 'code') return 360;
  if (task.type === 'file') return 220;
  return 80;
}

function fatalStops(message) {
  return /unset|HTTP 401|HTTP 403|not offered|not a confirmed|timeout/.test(message);
}

function ungraded(task) {
  if (!task || task.pass === true) return false;
  return /HTTP \d+|daily limit|timeout|Rate limit/i.test(String(task.detail || ''));
}

export async function runTaskBench({ outPath, logPath, resume = false, retryUnder = null, limit = Infinity, merged = false, log = () => {} } = {}) {
  if (!process.env.GROQ_API_KEY) throw new FatalGroqError('GROQ_API_KEY is unset');
  const agents = merged ? loadMergedAgents() : loadUniqueAgents();
  const client = createGroqClient({ model: MODEL, log });
  await client.confirm();
  mkdirSync(dirname(outPath), { recursive: true });
  const prior = resume ? readPrior(outPath) : { agents: [] };
  const byName = new Map(prior.agents.map(row => [row.name, row]));
  let stoppedReason = prior.stoppedReason && resume ? '' : '';
  let scored = 0;

  for (const agent of agents) {
    if (scored >= limit) break;
    const tasks = tasksFor(agent);
    const existing = byName.get(agent.name);
    const retrying = retryUnder != null;
    if (retrying) {
      if (!existing?.complete || existing.passed >= retryUnder) continue;
    } else if (existing?.complete && existing.tasks.length >= tasks.length && !existing.tasks.some(ungraded)) {
      continue;
    }
    const row = existing?.tasks?.length ? existing : {
      name: agent.name,
      source: agent.source,
      kind: tasks[0].kind,
      tasks: [],
      complete: false,
    };
    row.kind = tasks[0].kind;
    row.source = agent.source;
    byName.set(agent.name, row);
    const indexes = retrying
      ? tasks.map((_, index) => index).filter(index => row.tasks[index] && row.tasks[index].pass !== true)
      : tasks.map((_, index) => index).filter(index => index >= row.tasks.length || ungraded(row.tasks[index]));
    for (const index of indexes) {
      const task = tasks[index];
      const started = Date.now();
      let content = '';
      try {
        content = await client.chat(
          [
            { role: 'system', content: agent.instructions.slice(0, 600) },
            { role: 'user', content: task.prompt },
          ],
          tokensFor(task),
          0,
          task.type === 'file',
        );
      } catch (err) {
        const message = redact(err instanceof Error ? err.message : String(err));
        if (err instanceof DailyLimitError || err.name === 'DailyLimitError' || fatalStops(message)) {
          stoppedReason = message.slice(0, 300);
          writeReport();
          return finish(stoppedReason);
        }
        const failed = { id: task.id, type: task.type, pass: false, detail: message.slice(0, 180), output: '', ms: Date.now() - started };
        if ((retrying || ungraded(row.tasks[index])) && row.tasks[index]) row.tasks[index] = failed;
        else row.tasks.push(failed);
        writeReport();
        continue;
      }
      const graded = await gradeTask(task, content);
      const saved = {
        id: task.id,
        type: task.type,
        pass: graded.pass === true,
        detail: redact(graded.detail).slice(0, 180),
        output: redact(content).slice(0, 400),
        ms: Date.now() - started,
      };
      if ((retrying || ungraded(row.tasks[index])) && row.tasks[index]) row.tasks[index] = saved;
      else row.tasks.push(saved);
      appendLog(logPath, { name: agent.name, id: task.id, pass: graded.pass === true, detail: graded.detail });
      writeReport();
    }
    row.complete = row.tasks.length >= tasks.length;
    row.passed = row.tasks.filter(item => item.pass).length;
    row.total = row.tasks.length;
    scored += 1;
    const usage = client.stats();
    log(`${scored} ${agent.name} ${row.passed}/${row.total} remaining=${usage.remainingRequests ?? ''}`);
    writeReport();
  }

  writeReport();
  return finish(stoppedReason);

  function writeReport() {
    const rows = agents.map(agent => byName.get(agent.name)).filter(Boolean);
    for (const row of rows) {
      const tasks = Array.isArray(row.tasks) ? row.tasks : [];
      row.passed = tasks.filter(item => item && item.pass).length;
      row.total = tasks.length;
      row.complete = tasks.length > 0 && tasks.every(item => item);
    }
    const kaggleModel = rows.flatMap(row => row.tasks || []).map(item => item && item.model).find(model => model && model !== MODEL) || '';
    const payload = {
      model: MODEL,
      provider: kaggleModel ? 'mixed' : 'groq',
      ...(kaggleModel ? { kaggleModel } : {}),
      stoppedReason,
      agentCount: agents.length,
      completed: rows.filter(row => row.complete).length,
      atLeastTwo: rows.filter(row => row.complete && row.passed >= 2).length,
      groq: client.stats(),
      agents: rows,
    };
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }

  function finish(reason) {
    const rows = agents.map(agent => byName.get(agent.name)).filter(Boolean);
    return {
      model: MODEL,
      stoppedReason: reason,
      agentCount: agents.length,
      completed: rows.filter(row => row.complete).length,
      atLeastTwo: rows.filter(row => row.complete && row.passed >= 2).length,
      groq: client.stats(),
    };
  }
}

function readPrior(outPath) {
  try {
    const parsed = JSON.parse(readFileSync(outPath, 'utf8'));
    return { agents: Array.isArray(parsed.agents) ? parsed.agents : [], stoppedReason: parsed.stoppedReason || '' };
  } catch {
    return { agents: [], stoppedReason: '' };
  }
}

function appendLog(logPath, entry) {
  if (!logPath) return;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ ...entry, detail: redact(entry.detail).slice(0, 180) })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || 'docs/bench/agent-tasks.json';
  const logPath = args.log || 'docs/bench/agent-tasks.jsonl';
  const retryUnder = args.retryUnder ?? args['retry-under'];
  const summary = await runTaskBench({
    outPath,
    logPath,
    resume: Boolean(args.resume) || retryUnder != null,
    retryUnder: retryUnder != null ? Number(retryUnder) : null,
    limit: args.limit ? Number(args.limit) : Infinity,
    merged: args.rufloOnly ? false : true,
    log: line => process.stderr.write(`${redact(line)}\n`),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.stoppedReason) process.exitCode = 2;
}

const invoked = process.argv[1] && process.argv[1].endsWith('run-task-bench.mjs');
if (invoked) {
  main().catch(err => {
    process.stderr.write(`${redact(err instanceof Error ? err.stack || err.message : String(err))}\n`);
    process.exit(1);
  });
}
