/**
 * Child process for a task-benchmark code check.
 * The parent launches this with a secret-free environment.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modPath = process.argv[2];
const cases = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const mod = await import(`${pathToFileURL(modPath).href}?t=${Date.now()}`);
const fn = mod[cases.exportName];

function materialize(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.$nan) return Number.NaN;
    if (value.$inf) return Number.POSITIVE_INFINITY;
  }
  return value;
}

if (typeof fn !== 'function') {
  process.stdout.write(JSON.stringify({ error: `missing export ${cases.exportName}` }));
  process.exit(0);
}

const results = [];
for (const item of cases.cases) {
  const args = (item.args || []).map(materialize);
  if (item.throws) {
    let threw = '';
    try {
      fn(...args);
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    results.push({ pass: threw === item.throws, threw, expected: item.throws });
    continue;
  }
  let actual;
  let error = '';
  try {
    actual = fn(...args);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const pass = !error && (item.custom ? customPass(item, actual) : stable(actual) === stable(item.expect));
  results.push({ pass, actual, expected: item.expect, error });
}
process.stdout.write(JSON.stringify({ results }));

function customPass(item, actual) {
  if (item.custom === 'plan') {
    if (!Array.isArray(actual) || actual.length !== 4) return false;
    if (!actual.every(step => typeof step === 'string' && step.trim())) return false;
    const has = pattern => actual.some(step => pattern.test(step));
    return has(/\/health/) && has(/\btest\b/i) && has(/\bcoder\b/i) && has(/\btester\b/i);
  }
  if (item.custom === 'questions') {
    if (!Array.isArray(actual) || actual.length !== 3) return false;
    return actual.every(entry => typeof entry === 'string' && entry.includes('?') && !/best library/i.test(entry));
  }
  if (item.custom === 'procedure') {
    if (!actual || typeof actual !== 'object') return false;
    const stepsOk = Array.isArray(actual.steps)
      && actual.steps.length === 4
      && actual.steps.every(step => typeof step === 'string' && step.trim());
    return actual.goal === item.job
      && stepsOk
      && typeof actual.output === 'string'
      && actual.output.trim().length > 0
      && actual.limit === 'I will not claim a result without evidence from this turn.';
  }
  return false;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
