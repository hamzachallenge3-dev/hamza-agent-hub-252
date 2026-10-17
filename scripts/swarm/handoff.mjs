/**
 * Run planner -> coder -> tester with a real artifact handoff.
 *
 * Each agent reads the previous agent's file. The tester's cases are
 * executed against the coder's module. When `complete` is passed, the
 * planner, coder, and tester each call it and the next role reads the
 * file the previous role wrote. Otherwise every role is a local worker.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const AGENT_FILES = {
  planner: '.claude/agents/core/planner.md',
  coder: '.claude/agents/core/coder.md',
  tester: '.claude/agents/core/tester.md',
};

export function loadAgentPrompt(repoRoot, role) {
  const relativePath = AGENT_FILES[role];
  if (!relativePath) throw new Error(`Unknown swarm role: ${role}`);
  const absolute = join(repoRoot, relativePath);
  const raw = readFileSync(absolute, 'utf8');
  const name = (raw.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || role;
  return { role, name, source: relativePath, instructions: raw };
}

export function planIsEven(task) {
  if (!task || typeof task !== 'object') throw new Error('Task must be an object');
  if (task.kind !== 'is-even') throw new Error(`Unsupported local task kind: ${task.kind || '(missing)'}`);
  return {
    functionName: 'isEven',
    params: ['n'],
    guard: 'Number.isFinite',
    errorName: 'nan',
    body: 'return n % 2 === 0;',
    cases: [
      { args: [2], expect: true },
      { args: [3], expect: false },
      { args: [Number.NaN], throws: 'nan' },
    ],
  };
}

export function codeFromSpec(spec) {
  const name = spec.functionName;
  if (!/^[A-Za-z_$][\w$]*$/.test(name || '')) throw new Error('Spec function name is not an identifier');
  if (!Array.isArray(spec.params) || spec.params.length !== 1) throw new Error('Spec must name one parameter');
  const param = spec.params[0];
  if (!/^[A-Za-z_$][\w$]*$/.test(param)) throw new Error('Spec parameter is not an identifier');
  if (spec.guard !== 'Number.isFinite') throw new Error('Spec guard is not supported');
  if (typeof spec.errorName !== 'string' || !spec.errorName) throw new Error('Spec error name is missing');
  if (spec.body !== 'return n % 2 === 0;') throw new Error('Spec body is not the evenness check');
  return [
    `export function ${name}(${param}) {`,
    `  if (!${spec.guard}(${param})) throw new Error(${JSON.stringify(spec.errorName)});`,
    `  ${spec.body}`,
    '}',
    '',
  ].join('\n');
}

export async function testModule(moduleUrl, spec) {
  const imported = await import(moduleUrl);
  const fn = imported[spec.functionName];
  if (typeof fn !== 'function') throw new Error(`Module did not export ${spec.functionName}`);
  const results = [];
  for (const item of spec.cases) {
    if (item.throws) {
      let threw = '';
      try {
        fn(...item.args);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      results.push({ args: item.args, pass: threw === item.throws, threw, expected: item.throws });
      continue;
    }
    const actual = fn(...item.args);
    results.push({ args: item.args, pass: actual === item.expect, actual, expected: item.expect });
  }
  return { passed: results.every(item => item.pass), results };
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function extractJson(text) {
  const body = String(text || '').trim();
  const candidates = [];
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(body);
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(body.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next slice
    }
  }
  throw new Error('Response was not JSON');
}

export function extractModule(text) {
  let body = String(text || '').trim();
  const fenced = body.match(/```(?:javascript|js|mjs)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();
  if (!/export\s+function\s+/.test(body)) throw new Error('Coder response has no exported function');
  return body.endsWith('\n') ? body : `${body}\n`;
}

function normalizeSpec(value) {
  const spec = extractJson(JSON.stringify(value));
  codeFromSpec(spec);
  if (!Array.isArray(spec.cases) || spec.cases.length < 3) throw new Error('Spec cases are missing');
  return spec;
}

function plannerPrompt(task) {
  return [
    'Return only a JSON object for an isEven function spec.',
    'Keys: functionName, params, guard, errorName, body, cases.',
    'functionName is isEven. params is ["n"]. guard is Number.isFinite.',
    'errorName is nan. body is "return n % 2 === 0;".',
    'cases is an array of three objects:',
    '{"args":[2],"expect":true}',
    '{"args":[3],"expect":false}',
    '{"args":[null],"throws":"nan"}',
    'null stands for a non-finite input. Do not add other keys.',
    `Task: ${JSON.stringify(task)}`,
  ].join('\n');
}

function coderPrompt(specText) {
  return [
    'Read the planner spec. Return only an ES module, no markdown.',
    'Export the function named in functionName.',
    'If the guard fails, throw new Error with errorName.',
    'Then use body as the return statement.',
    'Spec file spec.json:',
    specText,
  ].join('\n');
}

function testerPrompt(specText, codeText) {
  return [
    'Read spec.json and is-even.mjs. Return only JSON.',
    'Shape: {"passed":true,"results":[{"args":[2],"pass":true,"actual":true,"expected":true}]}',
    'Include one result per spec case. passed is true only if every case matches.',
    'For the throws case, set threw to the error message and pass to whether it equals the spec.',
    'Spec:',
    specText,
    'Module:',
    codeText,
  ].join('\n');
}

async function takeModel(complete, agent, prompt, json, accept) {
  let lastError = new Error('no attempt');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await complete({
      role: agent.role,
      system: agent.instructions.slice(0, 500),
      prompt: attempt === 1
        ? prompt
        : `${prompt}\n\nPrevious answer was rejected: ${lastError.message}\nReturn only the requested artifact.`,
      json,
    });
    try {
      return { raw, value: accept(raw) };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(`${agent.role} model output was rejected: ${lastError.message}`);
}

export async function runHandoff({ repoRoot, workDir, task, complete }) {
  mkdirSync(workDir, { recursive: true });
  const agents = ['planner', 'coder', 'tester'].map(role => loadAgentPrompt(repoRoot, role));
  const started = Date.now();
  const handoffs = [];

  let spec;
  let plannerSource = 'local-worker';
  let coderSource = 'local-worker';
  let testerSource = 'local-worker';
  const modelOutputs = [];
  if (complete) {
    const planned = await takeModel(complete, agents[0], plannerPrompt(task), true, raw => normalizeSpec(extractJson(raw)));
    spec = planned.value;
    plannerSource = 'model';
    modelOutputs.push({ role: 'planner', content: planned.raw });
  } else {
    spec = planIsEven(task);
  }
  const specPath = join(workDir, 'spec.json');
  writeJson(specPath, spec);
  handoffs.push({ from: 'planner', to: 'coder', file: 'spec.json', source: plannerSource });

  const specText = readFileSync(specPath, 'utf8');
  let code;
  if (complete) {
    const coded = await takeModel(complete, agents[1], coderPrompt(specText), false, extractModule);
    code = coded.value;
    coderSource = 'model';
    modelOutputs.push({ role: 'coder', content: coded.raw });
  } else {
    code = codeFromSpec(spec);
  }
  const codePath = join(workDir, 'is-even.mjs');
  writeFileSync(codePath, code);
  const coderRead = JSON.parse(readFileSync(specPath, 'utf8'));
  if (coderRead.functionName !== spec.functionName) throw new Error('Coder did not read the planner spec');
  handoffs.push({ from: 'coder', to: 'tester', file: 'is-even.mjs', source: coderSource, read: 'spec.json' });

  const executed = await testModule(pathToFileURL(codePath).href, spec);
  let report = executed;
  if (complete) {
    const codeText = readFileSync(codePath, 'utf8');
    const tested = await takeModel(complete, agents[2], testerPrompt(specText, codeText), true, raw => {
      const parsed = extractJson(raw);
      if (typeof parsed.passed !== 'boolean') throw new Error('Tester JSON has no passed boolean');
      return parsed;
    });
    report = tested.value;
    testerSource = 'model';
    modelOutputs.push({ role: 'tester', content: tested.raw });
    writeJson(join(workDir, 'executed.json'), executed);
  }
  const reportPath = join(workDir, 'report.json');
  writeJson(reportPath, report);
  handoffs.push({ from: 'tester', to: 'done', file: 'report.json', source: testerSource, read: 'is-even.mjs' });

  const receipt = {
    ok: executed.passed === true && report.passed === true,
    agents: agents.map(agent => ({ role: agent.role, name: agent.name, source: agent.source })),
    handoffs,
    plannerSource,
    coderSource,
    testerSource,
    passed: executed.results.filter(item => item.pass).length,
    total: executed.results.length,
    ms: Date.now() - started,
  };
  if (complete) {
    receipt.modelOutputs = modelOutputs;
    receipt.executed = { passed: executed.passed, results: executed.results };
  }
  writeJson(join(workDir, 'receipt.json'), receipt);
  return receipt;
}
