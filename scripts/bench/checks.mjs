/**
 * Automatic graders. No model call lives here.
 * A value must equal the known string, a JSON file must deep-equal,
 * or the exported function must pass every case.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJson, extractModule } from '../swarm/handoff.mjs';

const execCases = fileURLToPath(new URL('./exec-cases.mjs', import.meta.url));

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stripFence(text) {
  const body = String(text ?? '').trim();
  const fenced = body.match(/```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/);
  return (fenced ? fenced[1] : body).trim();
}

export function checkExact(text, expected) {
  let body = stripFence(text).replace(/\r\n/g, '\n').trim();
  if (
    (body.startsWith('"') && body.endsWith('"') && body.length >= 2)
    || (body.startsWith("'") && body.endsWith("'") && body.length >= 2)
  ) {
    body = body.slice(1, -1).trim();
  }
  const pass = body === expected;
  return { pass, detail: pass ? 'exact' : `got ${JSON.stringify(body.slice(0, 180))}` };
}

export function checkJson(text, expected) {
  try {
    const parsed = extractJson(text);
    const pass = stable(parsed) === stable(expected);
    return { pass, detail: pass ? 'json match' : 'json differs' };
  } catch (err) {
    return { pass: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function checkText(text, expected) {
  const body = stripFence(text).replace(/\r\n/g, '\n').trim();
  const want = String(expected).replace(/\r\n/g, '\n').trim();
  return { pass: body === want, detail: body === want ? 'text match' : 'text differs' };
}

function cleanEnv() {
  return {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
  };
}

export async function checkCode(text, spec) {
  let code;
  try {
    code = extractModule(text);
  } catch (err) {
    return { pass: false, detail: err instanceof Error ? err.message : String(err) };
  }
  const dir = mkdtempSync(join(tmpdir(), 'bench-case-'));
  const modPath = join(dir, 'mod.mjs');
  const casesPath = join(dir, 'cases.json');
  writeFileSync(modPath, code);
  writeFileSync(casesPath, JSON.stringify({ exportName: spec.exportName, cases: spec.cases }));
  try {
    const child = await runChild(modPath, casesPath);
    if (child.error && !child.results) return { pass: false, detail: String(child.error).slice(0, 180) };
    const results = child.results || [];
    const failed = results.find(item => !item.pass);
    const pass = results.length === spec.cases.length && !failed;
    const detail = pass
      ? `${results.length}/${results.length} cases`
      : `case failed ${JSON.stringify(failed || { error: child.error || 'no results' }).slice(0, 180)}`;
    return { pass, detail };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runChild(modPath, casesPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [execCases, modPath, casesPath], {
      env: cleanEnv(),
      signal: AbortSignal.timeout(8000),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => resolve({ error: err.message }));
    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: (stderr || stdout || 'code check produced no result').slice(0, 180) });
      }
    });
  });
}

export async function gradeTask(task, text) {
  if (task.type === 'value') return checkExact(text, task.expected);
  if (task.type === 'file') return checkJson(text, task.expected);
  if (task.type === 'text') return checkText(text, task.expected);
  if (task.type === 'code') return checkCode(text, task);
  return { pass: false, detail: `unknown task type ${task.type}` };
}
