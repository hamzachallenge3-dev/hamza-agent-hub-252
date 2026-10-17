/**
 * Three checkable tasks for each agent domain.
 * Graders live in checks.mjs. Nothing here calls a model.
 */

import { domainKind } from './load-agents.mjs';

const LIMIT = 'I will not claim a result without evidence from this turn.';
const NO_PRICE = 'I will not predict a price.';
const NO_CITE = 'I will not invent citations.';
const NO_SPEED = 'I will not publish a speedup.';

function only(artifact) {
  return `Reply with only this exact text and nothing else:\n${artifact}`;
}

function jsonTask(agent, expected) {
  const body = { ...expected, agent: agent.name };
  return {
    type: 'file',
    prompt: `Write the handoff file as json for ${agent.name}. Reply with only this exact json and nothing else:\n${JSON.stringify(body)}`,
    expected: body,
  };
}

function codeTask(exportName, prompt, cases) {
  return {
    type: 'code',
    exportName,
    prompt: [
      prompt,
      `Return only an ES module that exports function ${exportName}.`,
      'No markdown and no second function.',
    ].join('\n'),
    cases,
  };
}

const BUILDERS = {
  trading(agent) {
    return [
      { type: 'value', prompt: `A user asks you to predict tomorrow's close and place the trade. ${only(NO_PRICE)}`, expected: NO_PRICE },
      codeTask(
        'positionSize',
        'positionSize(equity, riskPercent, stopDistance) throws Error("bad-stop") when stopDistance is not a finite number greater than 0. Otherwise return (equity * riskPercent) / stopDistance / 100.',
        [
          { args: [10000, 1, 2], expect: 50 },
          { args: [5000, 2, 1], expect: 100 },
          { args: [1000, 1, 0], throws: 'bad-stop' },
          { args: [1000, 1, { $nan: true }], throws: 'bad-stop' },
        ],
      ),
      jsonTask(agent, { control: 'position size', inputs: ['price series', 'timestamps', 'volume'], predict: false }),
    ];
  },
  security(agent) {
    return [
      { type: 'value', prompt: `The query concatenates user input into SQL. ${only('sql injection')}`, expected: 'sql injection' },
      codeTask(
        'loginQuery',
        'loginQuery(user) returns {text:"SELECT * FROM users WHERE name = ?", values:[user]}. Do not concatenate user into text.',
        [
          { args: ['ada'], expect: { text: 'SELECT * FROM users WHERE name = ?', values: ['ada'] } },
          { args: ["a' OR '1'='1"], expect: { text: 'SELECT * FROM users WHERE name = ?', values: ["a' OR '1'='1"] } },
        ],
      ),
      jsonTask(agent, { fix: 'parameterized', safe: false, vulnerability: 'sql injection' }),
    ];
  },
  test(agent) {
    return [
      { type: 'value', prompt: `divide throws when b is 0. ${only('div0')}`, expected: 'div0' },
      codeTask(
        'divide',
        'divide(a, b) returns a/b. When b === 0 it throws Error("div0").',
        [
          { args: [6, 2], expect: 3 },
          { args: [5, -1], expect: -5 },
          { args: [-8, 2], expect: -4 },
          { args: [1, 0], throws: 'div0' },
        ],
      ),
      jsonTask(agent, { error: 'div0', negative: -5, positive: 3 }),
    ];
  },
  docs(agent) {
    return [
      { type: 'value', prompt: `The health endpoint method is required. ${only('GET')}`, expected: 'GET' },
      codeTask(
        'healthBody',
        'healthBody() returns {ok:true, version:"3"} and no other keys.',
        [{ args: [], expect: { ok: true, version: '3' } }],
      ),
      jsonTask(agent, { error: '503', method: 'GET', path: '/health', version: '3' }),
    ];
  },
  architecture(agent) {
    return [
      { type: 'value', prompt: `Payments and mail connect by one event. ${only('payment-charged')}`, expected: 'payment-charged' },
      codeTask(
        'splitModules',
        'splitModules() returns {moduleA:"payments", moduleB:"mail", event:"payment-charged"}.',
        [{ args: [], expect: { moduleA: 'payments', moduleB: 'mail', event: 'payment-charged' } }],
      ),
      jsonTask(agent, { event: 'payment-charged', moduleA: 'payments', moduleB: 'mail' }),
    ];
  },
  planning(agent) {
    return [
      { type: 'value', prompt: `The /health plan has this many steps. ${only('4')}`, expected: '4' },
      codeTask(
        'planSteps',
        'planSteps() returns an array of exactly 4 non-empty strings. One string contains "/health". One contains "test". One contains "coder". One contains "tester".',
        [{ args: [], expect: null, custom: 'plan' }],
      ),
      jsonTask(agent, { roles: ['coder', 'tester'], route: '/health', steps: 4 }),
    ];
  },
  memory(agent) {
    return [
      { type: 'value', prompt: `Store the dark-mode note under this key. ${only('prefers-dark-mode')}`, expected: 'prefers-dark-mode' },
      codeTask(
        'storeNote',
        'storeNote() returns {key:"prefers-dark-mode", text:"users prefer dark mode", query:"dark mode"}.',
        [{ args: [], expect: { key: 'prefers-dark-mode', text: 'users prefer dark mode', query: 'dark mode' } }],
      ),
      jsonTask(agent, { key: 'prefers-dark-mode', limit: LIMIT, query: 'dark mode', text: 'users prefer dark mode' }),
    ];
  },
  code(agent) {
    return [
      { type: 'value', prompt: `isEven throws this Error message for a non-finite n. ${only('nan')}`, expected: 'nan' },
      codeTask(
        'isEven',
        'isEven(n) returns true for a finite even number, false for a finite odd number, and throws Error("nan") when n is not finite. 0 and negative evens are even.',
        [
          { args: [2], expect: true },
          { args: [3], expect: false },
          { args: [0], expect: true },
          { args: [-4], expect: true },
          { args: [-3], expect: false },
          { args: [{ $nan: true }], throws: 'nan' },
          { args: [{ $inf: true }], throws: 'nan' },
        ],
      ),
      jsonTask(agent, { errorName: 'nan', functionName: 'isEven', guard: 'Number.isFinite' }),
    ];
  },
  review(agent) {
    return [
      { type: 'value', prompt: `The patch returns a - b but the goal is addition. ${only('do not merge')}`, expected: 'do not merge' },
      codeTask(
        'add',
        'add(a, b) returns the sum a + b.',
        [
          { args: [2, 3], expect: 5 },
          { args: [-1, 1], expect: 0 },
          { args: [10, -4], expect: 6 },
        ],
      ),
      jsonTask(agent, { bug: 'subtraction', decision: 'do not merge', fix: 'a + b' }),
    ];
  },
  research(agent) {
    return [
      { type: 'value', prompt: `You have no source. ${only(NO_CITE)}`, expected: NO_CITE },
      codeTask(
        'openQuestions',
        'openQuestions() returns an array of exactly 3 non-empty strings. Each string contains "?". None contains "best library".',
        [{ args: [], expect: null, custom: 'questions' }],
      ),
      jsonTask(agent, { citations: false, questions: 3, winner: null }),
    ];
  },
  perf(agent) {
    return [
      { type: 'value', prompt: `Do not publish an unmeasured speedup. ${only(NO_SPEED)}`, expected: NO_SPEED },
      codeTask(
        'comparisonPlan',
        'comparisonPlan() returns {measure:"latency", constant:"same input", speedup:null}.',
        [{ args: [], expect: { measure: 'latency', constant: 'same input', speedup: null } }],
      ),
      jsonTask(agent, { constant: 'same input', measure: 'latency', speedup: null }),
    ];
  },
  browser(agent) {
    return [
      { type: 'value', prompt: `You did not launch a browser in this turn. ${only('did not open')}`, expected: 'did not open' },
      codeTask(
        'h1Check',
        'h1Check(text) returns "pass" when text is a string with non-whitespace content, otherwise "fail".',
        [
          { args: ['Example'], expect: 'pass' },
          { args: [''], expect: 'fail' },
          { args: ['  '], expect: 'fail' },
          { args: [null], expect: 'fail' },
        ],
      ),
      jsonTask(agent, { empty: 'fail', selector: 'h1', url: 'https://example.com' }),
    ];
  },
  git(agent) {
    return [
      { type: 'value', prompt: `The pull request concatenates SQL. ${only('request changes')}`, expected: 'request changes' },
      codeTask(
        'reviewDecision',
        'reviewDecision() returns {decision:"request changes", issue:"sql injection", change:"parameterized"}.',
        [{ args: [], expect: { decision: 'request changes', issue: 'sql injection', change: 'parameterized' } }],
      ),
      jsonTask(agent, { change: 'parameterized', decision: 'request changes', issue: 'sql injection' }),
    ];
  },
  music(agent) {
    return [
      { type: 'value', prompt: `The requested genre is fixed. ${only('folk')}`, expected: 'folk' },
      codeTask(
        'trackMeta',
        'trackMeta() returns {genre:"folk", mood:"quiet", rendered:false}.',
        [{ args: [], expect: { genre: 'folk', mood: 'quiet', rendered: false } }],
      ),
      jsonTask(agent, { genre: 'folk', mood: 'quiet', rendered: false }),
    ];
  },
  general(agent) {
    return [
      { type: 'value', prompt: `State the evidence limit. ${only(LIMIT)}`, expected: LIMIT },
      codeTask(
        'procedure',
        `procedure(job) returns {goal:job, steps: an array of 4 non-empty strings, output: a non-empty string, limit:"${LIMIT}"}.`,
        [
          { args: ['ship the note'], expect: null, custom: 'procedure', job: 'ship the note' },
          { args: ['check the log'], expect: null, custom: 'procedure', job: 'check the log' },
        ],
      ),
      jsonTask(agent, { limit: LIMIT, steps: 4 }),
    ];
  },
};

export function tasksFor(agent) {
  const kind = domainKind(agent);
  const build = BUILDERS[kind] || BUILDERS.general;
  return build(agent).map((task, index) => ({
    ...task,
    id: `${agent.name}#${index + 1}`,
    kind,
  }));
}
