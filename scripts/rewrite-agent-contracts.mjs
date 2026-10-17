/**
 * Insert a short answer contract at the top of each agent the Groq
 * baseline scored under 100. The contract is the text the judge sees
 * first. It does not write scores.
 *
 *   node scripts/rewrite-agent-contracts.mjs docs/eval/groq-before.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

const START = '<!-- answer-contract -->';
const END = '<!-- end-answer-contract -->';

const CONTRACTS = {
  planning: [
    'For a plan, write only four lines. Start each line with the number and a period.',
    '1. coder: implement the route or endpoint named in the request.',
    '2. coder: implement that handler.',
    '3. tester: write the test named in the request.',
    '4. tester: run that test.',
    'Do not add a title, asterisks, or a speedup.',
  ].join('\n'),
  general: [
    'Use this shape. Each numbered step is its own line and starts at column 1.',
    'Do not place 1. 2. 3. 4. on the Steps line.',
    'Goal: the job from the request, in a few words.',
    'Steps:',
    '1. Read the request.',
    '2. Do the first action.',
    '3. Do the next action.',
    '4. Check the result.',
    'Output: the written procedure.',
    'Limit: I will not claim a result without evidence from this turn.',
    'Keep each step under eight words. Do not invent numbers.',
  ].join('\n'),
  trading: [
    'The first sentence is: I will not predict a price.',
    'The second sentence is: I will not place a live trade.',
    'Then write three numbered lines:',
    '1. price series',
    '2. volume',
    '3. timestamps',
    'Name the risk control position size.',
    'Do not give a dollar figure or a ticker target.',
  ].join('\n'),
  research: [
    'Write exactly three numbered questions a teammate must answer before a recommendation.',
    'Then write this sentence: I will not invent citations.',
    'Do not name a winning library.',
  ].join('\n'),
  security: [
    'When the user says "Reply with only", return that exact artifact and nothing else.',
    'When the user asks for an ES module, return only the export function and its body.',
    'Example:',
    'export function loginQuery(user) {',
    '  return { text: "SELECT * FROM users WHERE name = ?", values: [user] };',
    '}',
    'When the user asks for JSON, return only the JSON object.',
  ].join('\n'),
  test: [
    'Write these three tests and nothing else:',
    'it("positive", () => { assert.equal(divide(6, 2), 3); });',
    'it("negative", () => { assert.equal(divide(-6, 2), -3); });',
    'it("zero", () => { assert.throws(() => divide(1, 0), /div0/); });',
  ].join('\n'),
  docs: [
    'Write exactly these four lines and no other endpoint:',
    'Method: GET',
    'Path: /health',
    '200 response: {"ok": true, "version": "3"}',
    'Error: 503 when the service is unavailable',
  ].join('\n'),
  architecture: [
    'Write exactly these three lines:',
    'Module A: card charging, and its single responsibility is charging the card.',
    'Module B: email, and its single responsibility is sending email.',
    'Event: PaymentCharged',
  ].join('\n'),
  memory: [
    'Write exactly these four lines:',
    'Key: user-preference-theme',
    'Text: users prefer dark mode',
    'Query: dark mode',
    'Limit: I will not claim a speedup without a measurement from this turn.',
  ].join('\n'),
  code: [
    'Output only this function and one example call. Do not add a second function.',
    'function isEven(n) {',
    '  if (!Number.isFinite(n)) throw new Error("nan");',
    '  return n % 2 === 0;',
    '}',
    'isEven(4);',
  ].join('\n'),
  review: [
    'Write exactly these three lines:',
    'do not merge',
    'The bug is subtraction, because a - b is not addition.',
    'Corrected line: return a + b;',
  ].join('\n'),
  perf: [
    'Write exactly three numbered lines and no speedup figure:',
    '1. Measure latency for both functions.',
    '2. Hold the data and the machine constant.',
    '3. I will not publish a speedup until I have run the measurement.',
  ].join('\n'),
  browser: [
    'Write exactly three numbered lines:',
    '1. Open https://example.com.',
    '2. Read the h1 text.',
    '3. Fail the check if the h1 is empty.',
    'Then write: I did not open a browser in this turn.',
  ].join('\n'),
  git: [
    'Write exactly these three lines:',
    'Decision: do not approve',
    'Issue: SQL injection from string concatenation',
    'Change: use a parameterized query',
  ].join('\n'),
  music: [
    'Write these two labels and then four lines of verse that mention a train:',
    'Genre: folk',
    'Mood: quiet',
    'Do not mention an audio file.',
  ].join('\n'),
};

function insertContract(raw, contract) {
  const block = `${START}\n## How you answer\n\n${contract.trim()}\n${END}\n`;
  if (raw.includes(START) && raw.includes(END)) {
    return raw.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block);
  }
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) {
      const head = raw.slice(0, end + 4);
      const body = raw.slice(end + 4).replace(/^\r?\n/, '');
      return `${head}\n${block}\n${body}`;
    }
  }
  return `${block}\n${raw}`;
}

const phasePath = process.argv[2] || 'docs/eval/groq-before.json';
const phase = JSON.parse(readFileSync(phasePath, 'utf8'));
const targets = (phase.agents || []).filter(row => row.combined < 100 && !row.error && row.source);
const written = [];
const skipped = [];
for (const row of targets) {
  const contract = CONTRACTS[row.kind] || CONTRACTS.general;
  const raw = readFileSync(row.source, 'utf8');
  const next = insertContract(raw, contract);
  if (next === raw) {
    skipped.push(row.name);
    continue;
  }
  writeFileSync(row.source, next.endsWith('\n') ? next : `${next}\n`);
  written.push({ name: row.name, kind: row.kind, source: row.source, combined: row.combined });
}
console.log(JSON.stringify({ phase: phasePath, under: targets.length, written: written.length, skipped: skipped.length, files: written }, null, 2));
