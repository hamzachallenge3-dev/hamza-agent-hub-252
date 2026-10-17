#!/usr/bin/env node
/**
 * Grade pending agent tasks with completions from a Kaggle notebook.
 * Passes already recorded stay passes. HTTP 400 rows are sent again
 * and stay failures until a completion passes the same check.
 *
 *   node scripts/bench/run-kaggle-bench.mjs --out docs/bench/agent-tasks.json
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from '../eval-groq.mjs';
import { loadMergedAgents } from './load-agents.mjs';
import { tasksFor } from './agent-tasks.mjs';
import { gradeTask } from './checks.mjs';
import { requestFor, selectPending } from './select-work.mjs';
import { improveSource } from './improve-agents.mjs';

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

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function readPrior(outPath) {
  const parsed = readJson(outPath, {});
  return {
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    stoppedReason: parsed.stoppedReason || '',
    groqStoppedReason: parsed.groqStoppedReason || '',
    model: parsed.model || 'openai/gpt-oss-120b',
  };
}

function readCompletions(path) {
  const text = readFileSync(path, 'utf8');
  const rows = [];
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      const output = redact(`${stdout}\n${stderr}`).slice(-2000);
      if (code === 0) resolve(output);
      else reject(new Error(output || `python exited ${code}`));
    });
  });
}

function gapIndexes(tasks, row) {
  const have = row?.tasks || [];
  const indexes = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = have[index];
    if (!task || /HTTP \d+|daily limit|timeout|Rate limit/i.test(String(task.detail || ''))) indexes.push(index);
  }
  return indexes;
}

export async function applyKaggleCompletions({ outPath, logPath, completions, modelInfo, gapOnly = false }) {
  const agents = loadMergedAgents();
  const prior = readPrior(outPath);
  const byName = new Map(prior.agents.map(row => [row.name, row]));
  const byId = new Map(completions.map(row => [row.id, row]));
  const loaded = modelInfo?.loaded || completions.find(row => row.model)?.model || '';
  let graded = 0;
  for (const agent of agents) {
    const tasks = tasksFor(agent);
    const existing = byName.get(agent.name);
    const pending = gapOnly ? gapIndexes(tasks, existing) : selectPending(tasks, existing);
    const hit = pending.filter(index => byId.has(tasks[index].id));
    if (!hit.length) continue;
    const row = existing?.tasks ? existing : {
      name: agent.name,
      source: agent.source,
      kind: tasks[0].kind,
      tasks: [],
      complete: false,
    };
    row.kind = tasks[0].kind;
    row.source = agent.source;
    for (const index of hit) {
      const task = tasks[index];
      const completion = byId.get(task.id);
      const started = completion.ms || 0;
      let saved;
      if (completion.error && !String(completion.content || '').trim()) {
        saved = {
          id: task.id,
          type: task.type,
          pass: false,
          detail: redact(completion.error).slice(0, 180),
          output: '',
          ms: started,
          model: completion.model || loaded,
        };
      } else {
        const result = await gradeTask(task, completion.content || '');
        saved = {
          id: task.id,
          type: task.type,
          pass: result.pass === true,
          detail: redact(result.detail).slice(0, 180),
          output: redact(completion.content || '').slice(0, 400),
          ms: started,
          model: completion.model || loaded,
        };
      }
      row.tasks[index] = saved;
      graded += 1;
      if (logPath) {
        mkdirSync(dirname(logPath), { recursive: true });
        appendFileSync(logPath, `${JSON.stringify({ name: agent.name, id: task.id, pass: saved.pass, detail: saved.detail, model: saved.model })}\n`);
      }
    }
    row.total = tasks.length;
    row.passed = row.tasks.filter(item => item && item.pass).length;
    row.complete = row.tasks.filter(Boolean).length >= tasks.length && row.tasks.every(item => item);
    byName.set(agent.name, row);
  }
  const rows = agents.map(agent => byName.get(agent.name)).filter(Boolean);
  const groqStoppedReason = prior.groqStoppedReason || prior.stoppedReason || '';
  const payload = {
    model: prior.model,
    provider: 'mixed',
    kaggleModel: loaded,
    groqStoppedReason,
    stoppedReason: '',
    agentCount: agents.length,
    completed: rows.filter(row => row.complete).length,
    atLeastTwo: rows.filter(row => row.complete && row.passed >= 2).length,
    agents: rows,
  };
  if (!graded) {
    return {
      graded: 0,
      loaded,
      completed: prior.agents.filter(row => row.complete).length,
      atLeastTwo: prior.agents.filter(row => row.complete && row.passed >= 2).length,
    };
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return { graded, loaded, completed: payload.completed, atLeastTwo: payload.atLeastTwo };
}

function exportTasks(outFile, prior) {
  const agents = loadMergedAgents();
  const byName = new Map(prior.agents.map(row => [row.name, row]));
  const requests = [];
  for (const agent of agents) {
    const tasks = tasksFor(agent);
    for (const index of selectPending(tasks, byName.get(agent.name))) {
      requests.push(requestFor(agent, tasks[index]));
    }
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, requests.map(row => JSON.stringify(row)).join('\n') + (requests.length ? '\n' : ''));
  return requests;
}

function improveUnder(outPath, bar) {
  const prior = readPrior(outPath);
  const changed = [];
  for (const row of prior.agents) {
    if (!row.complete || row.passed >= bar) continue;
    if (improveSource(row.source)) changed.push(row.name);
  }
  return changed;
}

async function applyDir(args, outPath, logPath) {
  const completionsPath = `${args.apply}/completions.jsonl`;
  if (!existsSync(completionsPath)) throw new Error(`no completions at ${completionsPath}`);
  const completions = readCompletions(completionsPath);
  const modelInfo = readJson(`${args.apply}/model.json`, {});
  return applyKaggleCompletions({
    outPath,
    logPath,
    completions,
    modelInfo,
    gapOnly: Boolean(args.gap),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || 'docs/bench/agent-tasks.json';
  const logPath = args.log || 'docs/bench/agent-tasks.jsonl';
  const root = args.root || '/tmp/ruflo-kaggle';
  const status = args.status || 'docs/bench/kaggle-status.json';
  const rounds = args.rounds ? Number(args.rounds) : 2;
  const bar = args.under ? Number(args.under) : 2;
  if (args.apply) {
    const applied = await applyDir(args, outPath, logPath);
    process.stdout.write(`${JSON.stringify(applied)}\n`);
    return;
  }
  mkdirSync(root, { recursive: true });
  mkdirSync(dirname(outPath), { recursive: true });
  for (let round = 1; round <= rounds; round++) {
    const prior = readPrior(outPath);
    const tasksPath = `${root}/tasks.jsonl`;
    const requests = exportTasks(tasksPath, prior);
    if (!requests.length) {
      process.stdout.write(`${JSON.stringify({ round, pending: 0 })}\n`);
      return;
    }
    process.stderr.write(`round ${round} pending ${requests.length}\n`);
    await runPython([
      'scripts/bench/kaggle_push.py', 'push',
      '--tasks', tasksPath,
      '--root', root,
      '--status', status,
    ]);
    const outDir = `${root}/output-${round}`;
    await runPython([
      'scripts/bench/kaggle_push.py', 'wait',
      '--status', status,
      '--out-dir', outDir,
      '--timeout', args.timeout || '43200',
      '--poll', args.poll || '45',
    ]);
    const completionsPath = `${outDir}/completions.jsonl`;
    if (!existsSync(completionsPath)) {
      const info = readJson(status, {});
      throw new Error(`no completions from kernel status ${info.kernelStatus || info.phase || ''} ${info.failure || info.error || ''}`);
    }
    const completions = readCompletions(completionsPath);
    const modelInfo = readJson(`${outDir}/model.json`, {});
    const applied = await applyKaggleCompletions({ outPath, logPath, completions, modelInfo });
    process.stderr.write(`round ${round} graded ${applied.graded} model ${applied.loaded}\n`);
    const changed = improveUnder(outPath, bar);
    process.stderr.write(`round ${round} improved ${changed.length}\n`);
    if (!changed.length) break;
  }
  const summary = readPrior(outPath);
  const final = readJson(outPath, {});
  process.stdout.write(`${JSON.stringify({
    kaggleModel: final.kaggleModel || '',
    completed: final.completed,
    atLeastTwo: final.atLeastTwo,
    agentCount: final.agentCount,
    groqStoppedReason: summary.groqStoppedReason,
  }, null, 2)}\n`);
}

const invoked = process.argv[1] && process.argv[1].endsWith('run-kaggle-bench.mjs');
if (invoked) {
  main().catch(err => {
    process.stderr.write(`${redact(err instanceof Error ? err.stack || err.message : String(err))}\n`);
    process.exit(1);
  });
}
