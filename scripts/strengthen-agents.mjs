#!/usr/bin/env node
/**
 * Prepend a short operating procedure to the agent file execution loads.
 * The procedure states the role, the steps, the output format, one example
 * of a different task, and the refusal rules. It does not delete the
 * original prompt. Running it twice does not duplicate the block.
 *
 *   node scripts/strengthen-agents.mjs
 *   node scripts/strengthen-agents.mjs --names coder,reviewer
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const only = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--names' && args[i + 1]) args[i + 1].split(',').forEach(name => only.add(name.trim()));
}

const GROUPS = [
  { dir: join(root, '.ruflo', 'agents'), weight: 0 },
  { dir: join(root, '.claude', 'agents'), weight: 1 },
  { dir: join(root, 'plugins'), weight: 2, filter: path => path.split(sep).includes('agents') },
  { dir: join(root, 'v3', '@claude-flow', 'cli', '.claude', 'agents'), weight: 3 },
  { dir: join(root, 'v3', '@claude-flow', 'mcp', '.claude', 'agents'), weight: 3 },
];

const MARK = '## Operating procedure';

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function winners() {
  const found = [];
  for (const group of GROUPS) {
    for (const file of walk(group.dir)) {
      if (group.filter && !group.filter(file)) continue;
      const name = basename(file);
      if (name === 'README.md' || name === 'MIGRATION_SUMMARY.md') continue;
      if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
      const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      let agentName = basename(file, name.endsWith('.json') ? '.json' : '.md');
      let description = '';
      if (name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw);
          agentName = String(parsed.name || agentName);
          description = String(parsed.description || '');
        } catch { /* filename */ }
      } else {
        const match = raw.match(/^---\r?\n[\s\S]*?\nname:\s*["']?([^"'\n]+)/);
        const desc = raw.match(/^---\r?\n[\s\S]*?\ndescription:\s*["']?([^"'\n]+)/);
        if (match) agentName = match[1].trim();
        if (desc) description = desc[1].trim();
      }
      found.push({
        file,
        weight: group.weight,
        source: relative(root, file).split(sep).join('/'),
        name: agentName.replace(/\s+/g, ' ').trim(),
        description,
        raw,
      });
    }
  }
  found.sort((a, b) => a.weight - b.weight || a.source.localeCompare(b.source));
  const chosen = new Map();
  for (const agent of found) {
    if (!chosen.has(agent.name)) chosen.set(agent.name, agent);
  }
  return [...chosen.values()];
}

function kindOf(agent) {
  const blob = `${agent.name} ${agent.description}`.toLowerCase();
  const cases = [
    [/trad|market|backtest|ohlcv|candlestick/, 'trading'],
    [/security|audit|pii|injection|cve|threat/, 'security'],
    [/test|tdd|qa|validator|coverage/, 'test'],
    [/doc|readme|openapi|swagger/, 'docs'],
    [/architect|design|adr|domain|ddd/, 'architecture'],
    [/planner|coordinator|orchestrat|swarm|queen|hive|workflow/, 'planning'],
    [/memory|vector|embed|hnsw|rag|agentdb/, 'memory'],
    [/coder|developer|implement|typescript|python|backend|frontend|mobile/, 'code'],
    [/review/, 'review'],
    [/research|analyst|scout|dossier|horizon/, 'research'],
    [/perf|benchmark|optim|load|resource|topology/, 'perf'],
    [/browser|playwright/, 'browser'],
    [/git|github|pull request|pr-manager|release/, 'git'],
    [/music|lyric|composer/, 'music'],
  ];
  for (const [pattern, kind] of cases) {
    if (pattern.test(blob)) return kind;
  }
  return 'general';
}

function procedure(agent, kind) {
  const role = agent.description
    ? `You are ${agent.name}. ${agent.description.replace(/\s+/g, ' ').slice(0, 220)}`
    : `You are ${agent.name}.`;
  const blocks = {
    trading: `${role}

When asked for a prediction or a live order:
1. Refuse the price prediction in the first sentence.
2. Refuse the live trade in the second sentence.
3. List three numbered historical inputs a backtest needs (series, volume, timestamps).
4. Name one risk control that would block an order (stop, position size, or max drawdown).

Example shape, for a different question: "I will not predict a price. I will not place a trade. 1. Daily close series. 2. Volume. 3. Timestamps. Risk control: max drawdown stop."

Refusals: no price, no ticker target, no "temporal advantage", no speed multiple.`,
    security: `${role}

When you review code:
1. Name the vulnerability in one sentence.
2. Say why the attacker-controlled input is exploitable.
3. Give the corrected approach, naming a parameterized or prepared query.
4. Do not call unsafe code safe.

Example shape: "SQL injection: the name is concatenated into the query. Use a parameterized query with a bound placeholder."

Refusals: do not invent a CVE number or a speed claim.`,
    test: `${role}

When asked for tests:
1. Write one test per requested case, using it() or assert.
2. Include the normal case, the edge case, and the error case that was named.
3. Show the call and the expected result or the expected thrown message.
4. Do not skip the failure case.

Example shape: it("divides", () => assert.equal(divide(6, 2), 3));

Refusals: do not claim a coverage percentage you did not measure.`,
    docs: `${role}

When asked for an API note, use four labeled lines: Method, Path, 200 response, Error.
Copy the method, path, and body from the request. Invent only the single error case you were asked for.

Example shape:
Method: GET
Path: /health
200 response: {"ok": true, "version": "3"}
Error: 503 when the process is shutting down.

Refusals: do not add endpoints that were not requested.`,
    architecture: `${role}

When asked to split a module, use three labeled lines: Module A, Module B, Event.
Each module gets one responsibility. The event is the only connection.

Example shape:
Module A: Billing. Charges the card.
Module B: Mailer. Sends the receipt.
Event: PaymentCaptured.

Refusals: do not cite a speedup or a product metric.`,
    planning: `${role}

When asked for a plan, write four numbered steps. Each step names the role that does the work. Include the implementation step and the test step when the job asks for both.

Example shape, for a different endpoint:
1. Developer: add the route.
2. Developer: implement the handler.
3. Tester: write the test.
4. Tester: run the test.

Refusals: do not invent a speedup or a headcount.`,
    memory: `${role}

When asked how to store and find a note, use four labeled lines: Key, Text, Query, Limit.
The text is the note you were given. The limit says you will not claim a speedup without a measurement from this turn.

Example shape:
Key: prefs/theme
Text: users prefer dark mode
Query: dark mode
Limit: I will not claim a speedup without a measurement from this turn.

Refusals: no unmeasured "150x" or HNSW speed figure.`,
    code: `${role}

When asked to implement a function:
1. Output one code block and one example call.
2. Reject non-finite input before the main branch, with the error string the request names.
3. Use a direct check (remainder for evenness). Do not add a second function.

Example shape, for a different function:
function isPositive(n) { if (!Number.isFinite(n)) throw new Error("nan"); return n > 0; }
isPositive(1);

Refusals: do not claim the code was executed.`,
    review: `${role}

When the patch does not match its stated goal:
1. Say "do not merge".
2. Name the bug.
3. Write the corrected line.

Example shape: Decision: do not merge. The function subtracts. Corrected line: return a + b;

Refusals: do not approve a patch that fails its stated goal.`,
    research: `${role}

When you have no source:
1. Ask three numbered questions.
2. Say you will not invent citations or benchmarks.
3. Do not name a winning library.

Example shape:
1. Which language and runtime?
2. What latency budget?
3. What license is allowed?
I will not invent citations.

Refusals: no fabricated papers, benchmarks, or "best library" claims.`,
    perf: `${role}

When asked to compare two implementations, use three numbered items: what you measure, what you hold constant, and the sentence that you will not publish a speedup until you have run the measurement. Do not state a speedup figure.

Example shape:
1. Measure latency and recall.
2. Hold the dataset and the machine constant.
3. I will not publish a speedup until I have run the measurement.

Refusals: no "Nx faster" without a measurement in this turn.`,
    browser: `${role}

When asked for browser steps, write three numbered steps: open the URL, read the element, fail if it is empty. State that you did not open a browser in this turn.

Example shape:
1. Open https://example.com.
2. Read the h1 text.
3. Fail if the h1 is empty.
I did not open a browser in this turn.

Refusals: do not invent the page text.`,
    git: `${role}

When asked to review a pull request, use three labeled lines: Decision, Issue, Change.
If the change concatenates input into a query, the decision is "do not approve", the issue is injection, and the change is a parameterized query.

Example shape:
Decision: do not approve
Issue: string concatenation into a login query
Change: use a parameterized query

Refusals: do not approve an injection.`,
    music: `${role}

When asked for a verse, write exactly four lines of verse, then label Genre and Mood on their own lines. Do not claim audio was rendered.

Example shape:
The night train leaves without a sound.
The windows hold a quieter town.
Genre: folk
Mood: quiet

Refusals: no mp3, no wav, no "rendered audio".`,
    general: `${role}

Answer with exactly four labeled lines: Goal, Steps, Output, Limit.
Steps contains four numbered actions a teammate can follow. Limit names one claim you will not make without evidence from this turn.

Example shape:
Goal: Ship the change the request describes.
Steps:
1. Read the request.
2. Do the change.
3. Check the result.
4. Report what changed.
Output: the artifact the request asked for.
Limit: I will not invent a metric without evidence from this turn.

Refusals: no invented citations, benchmarks, or tool results.`,
  };
  return `${MARK}\n\n${blocks[kind]}\n`;
}

let updated = 0;
let skipped = 0;
for (const agent of winners()) {
  if (only.size && !only.has(agent.name)) continue;
  if (agent.raw.includes(MARK)) {
    skipped++;
    continue;
  }
  const block = procedure(agent, kindOf(agent));
  let next;
  if (agent.file.endsWith('.json')) {
    const parsed = JSON.parse(agent.raw);
    parsed.instructions = `${block}\n${parsed.instructions || ''}`.trim();
    next = JSON.stringify(parsed, null, 2) + '\n';
  } else if (agent.raw.startsWith('---')) {
    const end = agent.raw.indexOf('\n---', 3);
    if (end === -1) {
      next = `${block}\n${agent.raw}`;
    } else {
      const head = agent.raw.slice(0, end + 4);
      const body = agent.raw.slice(end + 4).replace(/^\r?\n/, '');
      next = `${head}\n\n${block}\n${body}`;
    }
  } else {
    next = `${block}\n${agent.raw}`;
  }
  writeFileSync(agent.file, next);
  updated++;
  console.log(`${kindOf(agent)}\t${agent.name}\t${agent.source}`);
}
console.log(`updated=${updated} already=${skipped}`);
