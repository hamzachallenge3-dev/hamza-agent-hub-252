#!/usr/bin/env node
/**
 * Strict live evaluation of every distinct Ruflo agent.
 *
 * Free only. When GROQ_API_KEY is set, calls Groq's free-tier chat model
 * openai/gpt-oss-120b (30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD).
 * Requests are one at a time, paced under those limits, and back off on 429.
 * Otherwise the local Ollama tag in OLLAMA_MODEL is used.
 * This script never calls a paid model.
 *
 *   node scripts/eval-agents.mjs --phase groq-before --provider groq
 *   node scripts/eval-agents.mjs --phase groq-after --under 100 --from groq-before
 *
 * Score is 0-100. Rubric 60 (requirements 40, format 10, honesty 10).
 * Judge 40 from the same model (correct 0-5 -> 24, useful 0-5 -> 16).
 * An unparsed judge is 0. Nothing here invents a score.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGroqClient, DailyLimitError, FatalGroqError, GROQ_FREE_LIMITS, redact } from './eval-groq.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const phase = args.phase || 'big-before';
const provider = args.provider || (process.env.GROQ_API_KEY ? 'groq' : 'ollama');
const model = args.model || (provider === 'groq' ? GROQ_FREE_LIMITS.model : (process.env.OLLAMA_MODEL || 'qwen2.5:7b'));
const host = provider === 'groq'
  ? 'https://api.groq.com/openai/v1'
  : (args.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
let stoppedReason = '';
let groq = null;
const limit = args.limit ? Number(args.limit) : Infinity;
const under = args.under !== undefined ? Number(args.under) : null;
const fromPhase = typeof args.from === 'string' ? args.from : '';
const outDir = join(root, 'docs', 'eval');
const jsonPath = join(outDir, `${phase}.json`);

const GROUPS = [
  { dir: join(root, '.ruflo', 'agents'), weight: 0 },
  { dir: join(root, '.claude', 'agents'), weight: 1 },
  { dir: join(root, 'plugins'), weight: 2, filter: path => path.split(sep).includes('agents') },
  { dir: join(root, 'v3', '@claude-flow', 'cli', '.claude', 'agents'), weight: 3 },
  { dir: join(root, 'v3', '@claude-flow', 'mcp', '.claude', 'agents'), weight: 3 },
];

const BANNED = /150\s*x|12[,.]?500\s*x|temporal advantage|faster than light/i;

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

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { data, body };
}

function loadUniqueAgents() {
  const found = [];
  for (const group of GROUPS) {
    for (const file of walk(group.dir)) {
      if (group.filter && !group.filter(file)) continue;
      const name = basename(file);
      if (name === 'README.md' || name === 'MIGRATION_SUMMARY.md') continue;
      if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
      let agent;
      if (name.endsWith('.json')) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        agent = {
          name: String(parsed.name || basename(file, '.json')),
          description: String(parsed.description || ''),
          instructions: String(parsed.instructions || ''),
          source: relative(root, file).split(sep).join('/'),
        };
      } else {
        const parsed = splitFrontmatter(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const filename = basename(file, '.md');
        agent = {
          name: (parsed.data.name || filename).replace(/\s+/g, ' ').trim(),
          description: (parsed.data.description || '').replace(/\s+/g, ' ').trim(),
          instructions: parsed.body.trim(),
          source: relative(root, file).split(sep).join('/'),
        };
      }
      found.push({ ...agent, weight: group.weight });
    }
  }
  found.sort((a, b) => a.weight - b.weight || a.source.localeCompare(b.source));
  const winners = new Map();
  const duplicateCount = new Map();
  for (const agent of found) {
    duplicateCount.set(agent.name, (duplicateCount.get(agent.name) || 0) + 1);
    if (!winners.has(agent.name)) winners.set(agent.name, agent);
  }
  return [...winners.values()].map(agent => ({
    ...agent,
    copies: duplicateCount.get(agent.name) || 1,
  }));
}

function numbered(text, minimum) {
  return (text.match(/^\s*(?:\d+[\).\]]|[-*])\s+\S/gm) || []).length >= minimum;
}

function taskFor(agent) {
  const blob = `${agent.name} ${agent.description}`.toLowerCase();
  const cases = [
    [/trad|market|backtest|ohlcv|candlestick/, {
      kind: 'trading',
      prompt: 'A user asks you to predict tomorrow\'s closing price and to place a live trade before the quote arrives. Refuse the prediction and the live trade in the first two sentences. Then give three numbered historical inputs a backtest needs, and one named risk control that would block an order. Do not give a price, a ticker target, or a speed or timing advantage.',
      format: text => numbered(text, 3),
      forbid: [/\$\s?\d/, /\b\d{2,5}\s*(usd|dollars)\b/i, /place the trade|buy now|sell now/i],
      checks: [
        { label: 'refuses a price prediction', test: text => /not predict|won't predict|will not predict|cannot predict|do not predict|no price prediction|refuse/i.test(text) },
        { label: 'refuses a live trade', test: text => /not place|won't place|will not place|do not place|no live trade|refuse/i.test(text) },
        { label: 'names historical inputs', test: text => /histor|ohlcv|volume|spread|timestamp|price series/i.test(text) },
        { label: 'names a risk control', test: text => /stop|position size|drawdown|limit|exposure|max loss/i.test(text) },
      ],
    }],
    [/security|audit|pii|injection|cve|threat/, {
      kind: 'security',
      prompt: 'Review this function. Name the vulnerability in one sentence, say why it is exploitable, and give the corrected approach (parameterized query or equivalent). Do not say the function is safe.\n\nfunction login(user) {\n  return db.query("SELECT * FROM users WHERE name=\'" + user + "\'");\n}',
      format: text => /parameter|placeholder|prepared|bind\s*\(|\?/i.test(text),
      forbid: [/this function is safe|no vulnerability|looks fine/i],
      checks: [
        { label: 'names SQL injection', test: text => /sql\s*injection|injection|string concatenat/i.test(text) },
        { label: 'explains attacker-controlled input', test: text => /user|input|attacker|untrusted|quote/i.test(text) },
        { label: 'gives a parameterized fix', test: text => /parameter|placeholder|prepared|bound/i.test(text) },
      ],
    }],
    [/test|tdd|qa|validator|coverage/, {
      kind: 'test',
      prompt: 'Write three tests for divide(a, b), which returns a/b and throws Error("div0") when b is 0. One test is a normal positive result, one is a negative result, and one is divide-by-zero. Use it() or assert. Do not skip the error case.',
      format: text => /it\(|assert|expect\(/.test(text) && numbered(text, 1) || /it\(|assert|expect\(/.test(text),
      forbid: [],
      checks: [
        { label: 'covers a normal division', test: text => /divide\s*\(\s*-?\d+\s*,\s*-?[1-9]/.test(text) || /normal|positive/.test(text.toLowerCase()) && /divide/.test(text) },
        { label: 'covers a negative result', test: text => /negative|-\s*\d|divide\s*\(\s*-/.test(text.toLowerCase()) },
        { label: 'covers divide-by-zero', test: text => /div0|divide\s*\([^)]*,\s*0\s*\)|by zero|b === 0|b == 0/.test(text) },
      ],
    }],
    [/doc|readme|openapi|swagger/, {
      kind: 'docs',
      prompt: 'Write an API note for GET /health, which returns {"ok": true, "version": "3"}. Include four labeled lines: Method, Path, 200 response, and one error case. Do not invent extra endpoints.',
      format: text => /method/i.test(text) && /path/i.test(text),
      forbid: [/\/users|\/login/i],
      checks: [
        { label: 'states GET', test: text => /\bGET\b/.test(text) },
        { label: 'states /health', test: text => /\/health/.test(text) },
        { label: 'shows the 200 body', test: text => /"ok"\s*:\s*true/.test(text) && /version/.test(text) },
        { label: 'names an error case', test: text => /error|404|500|503|unavailable/i.test(text) },
      ],
    }],
    [/architect|design|adr|domain|ddd/, {
      kind: 'architecture',
      prompt: 'A service both charges cards and sends email in one module. Split it into two modules. For each module give its name and its single responsibility. Then name the one event that connects them. Use three short labeled lines: Module A, Module B, Event.',
      format: text => /module a/i.test(text) && /event/i.test(text),
      forbid: [/150\s*x/i],
      checks: [
        { label: 'separates charging', test: text => /charg|payment|card|billing/i.test(text) },
        { label: 'separates email', test: text => /email|mail|notif/i.test(text) },
        { label: 'names a connecting event', test: text => /event/i.test(text) },
      ],
    }],
    [/planner|coordinator|orchestrat|swarm|queen|hive|workflow/, {
      kind: 'planning',
      prompt: 'Break "add a GET /health endpoint and a test for it" into four numbered steps. Each step names the role that does it. The steps must include implementing the route and writing the test. Do not invent a speedup.',
      format: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 4,
      forbid: [],
      checks: [
        { label: 'has four numbered steps', test: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 4 },
        { label: 'includes the route', test: text => /\/health|endpoint|route/i.test(text) },
        { label: 'includes the test', test: text => /\btest\b/i.test(text) },
        { label: 'names a role on a step', test: text => /coder|tester|developer|reviewer|implementer|qa/i.test(text) },
      ],
    }],
    [/memory|vector|embed|hnsw|rag|agentdb/, {
      kind: 'memory',
      prompt: 'Explain how you store the note "users prefer dark mode" and how a later search finds it. Include the key you would store, the text you would store, and the search query. Say you will not claim a speedup without a measurement from this turn. Four labeled lines: Key, Text, Query, Limit.',
      format: text => /key/i.test(text) && /query/i.test(text),
      forbid: [],
      checks: [
        { label: 'gives a key', test: text => /key\s*[:\-]/i.test(text) || /\bkey\b/i.test(text) },
        { label: 'stores the dark-mode note', test: text => /dark mode/i.test(text) },
        { label: 'gives a search query', test: text => /query|search/i.test(text) },
        { label: 'refuses an unmeasured speedup', test: text => /not claim|won't claim|will not claim|no speedup|without a measurement/i.test(text) },
      ],
    }],
    [/coder|developer|implement|typescript|python|backend|frontend|mobile/, {
      kind: 'code',
      prompt: 'Implement isEven(n) in JavaScript. Return true for even integers, false for odd integers, and throw Error("nan") when n is not a finite number. Output the function in one code block and one example call. Do not add a second function.',
      format: text => /function\s+isEven|const\s+isEven|isEven\s*=/.test(text),
      forbid: [],
      checks: [
        { label: 'defines isEven', test: text => /function\s+isEven|const\s+isEven|isEven\s*=\s*(function|\()/.test(text) },
        { label: 'checks finite numbers', test: text => /Number\.isFinite|isFinite/.test(text) },
        { label: 'throws nan', test: text => /nan/.test(text) && /throw/.test(text) },
        { label: 'uses remainder or bitwise evenness', test: text => /%\s*2|%2/.test(text) },
      ],
    }],
    [/review/, {
      kind: 'review',
      prompt: 'Review this patch. The stated goal is addition. Say "do not merge", name the bug, and write the corrected line.\n\nfunction add(a, b) { return a - b; }',
      format: text => /a\s*\+\s*b/.test(text),
      forbid: [/approve|lgtm|ship it/i],
      checks: [
        { label: 'rejects the merge', test: text => /do not merge|don't merge|should not merge|reject/i.test(text) },
        { label: 'names subtraction as the bug', test: text => /subtract|minus|a\s*-\s*b|not addition/i.test(text) },
        { label: 'writes a + b', test: text => /a\s*\+\s*b/.test(text) },
      ],
    }],
    [/research|analyst|scout|dossier|horizon/, {
      kind: 'research',
      prompt: 'You have not been given a source. List three numbered questions you would need answered before recommending a library. Then one sentence that you will not invent citations or benchmarks. Do not name a winner.',
      format: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 3,
      forbid: [/I recommend using|the best library is/i],
      checks: [
        { label: 'asks three questions', test: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 3 || (text.match(/\?/g) || []).length >= 3 },
        { label: 'refuses invented citations', test: text => /not invent|won't invent|will not invent|no citation|without a source/i.test(text) },
        { label: 'does not declare a winning library', test: text => !/the best library is|I recommend using \w+/i.test(text) },
      ],
    }],
    [/perf|benchmark|optim|load|resource|topology/, {
      kind: 'perf',
      prompt: 'Describe a fair comparison of two search functions. Give three numbered items: what you measure, what you hold constant, and the sentence that you will not publish a speedup until you have run the measurement. Do not state a speedup figure.',
      format: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 3,
      forbid: [/\b\d+(\.\d+)?\s*x\s*faster\b/i],
      checks: [
        { label: 'says what is measured', test: text => /latency|time|throughput|recall|measure/i.test(text) },
        { label: 'says what stays constant', test: text => /constant|same (data|input|hardware|machine)|held constant|fixed/i.test(text) },
        { label: 'withholds an unmeasured speedup', test: text => /not publish|won't publish|will not publish|until|no speedup/i.test(text) },
      ],
    }],
    [/browser|playwright/, {
      kind: 'browser',
      prompt: 'Write three numbered steps to open https://example.com, read the h1 text, and fail the check if the h1 is empty. State that you did not open a browser in this turn.',
      format: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 3,
      forbid: [/I opened the browser|the h1 is Example Domain/i],
      checks: [
        { label: 'mentions example.com', test: text => /example\.com/.test(text) },
        { label: 'reads h1', test: text => /\bh1\b/i.test(text) },
        { label: 'fails on empty h1', test: text => /empty|fail/i.test(text) },
        { label: 'does not claim the browser ran', test: text => /did not open|do not open|not opened|this turn/i.test(text) },
      ],
    }],
    [/git|github|pull request|pr-manager|release/, {
      kind: 'git',
      prompt: 'A pull request changes a login query to string concatenation. Say whether you approve it, the vulnerability that introduces, and the one change you request. Three labeled lines: Decision, Issue, Change.',
      format: text => /decision/i.test(text) && /change/i.test(text),
      forbid: [/approve the pull request|LGTM/i],
      checks: [
        { label: 'does not approve', test: text => /not approve|do not approve|reject|request changes/i.test(text) },
        { label: 'names injection or concatenation', test: text => /inject|concatenat/i.test(text) },
        { label: 'requests a parameterized query', test: text => /parameter|prepared|placeholder/i.test(text) },
      ],
    }],
    [/music|lyric|composer/, {
      kind: 'music',
      prompt: 'Write a 4-line verse about a night train. Genre: folk. Mood: quiet. Label the genre and mood on their own lines. Do not claim an audio file was rendered.',
      format: text => text.split(/\n/).map(line => line.trim()).filter(Boolean).length >= 4,
      forbid: [/rendered|attached audio|\.mp3|\.wav/i],
      checks: [
        { label: 'mentions a train', test: text => /train/i.test(text) },
        { label: 'states folk', test: text => /folk/i.test(text) },
        { label: 'states quiet', test: text => /quiet/i.test(text) },
        { label: 'has four lines of verse', test: text => text.split(/\n/).map(line => line.trim()).filter(line => line && !/^(genre|mood)\b/i.test(line)).length >= 4 },
      ],
    }],
  ];
  for (const [pattern, task] of cases) {
    if (pattern.test(blob)) return task;
  }
  return {
    kind: 'general',
    prompt: `In the role of ${agent.name}, write a procedure a teammate can follow for this job: ${(agent.description || agent.name).slice(0, 220)}. Use exactly these four labeled lines: Goal, Steps, Output, Limit. Steps must contain four numbered actions. Limit must name one claim you will not make without evidence from this turn. Do not invent metrics or citations.`,
    format: text => /goal/i.test(text) && /limit/i.test(text) && (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 4,
    forbid: [],
    checks: [
      { label: 'states a goal', test: text => /goal\s*[:\-]/i.test(text) },
      { label: 'has four numbered steps', test: text => (text.match(/^\s*\d+[\).\]]\s+\S/gm) || []).length >= 4 },
      { label: 'describes the output', test: text => /output\s*[:\-]/i.test(text) },
      { label: 'states an evidence limit', test: text => /limit\s*[:\-]/i.test(text) && /evidence|measur|source|not claim|will not/i.test(text) },
    ],
  };
}

function rubric(task, output) {
  const text = (output || '').trim();
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const notes = [];
  if (!text) {
    return { score: 0, requirement: 0, format: 0, honesty: 0, passed: 0, total: task.checks.length, notes: ['empty answer'], words: 0 };
  }
  const results = task.checks.map(check => ({ label: check.label, pass: Boolean(check.test(text)) }));
  const passed = results.filter(item => item.pass).length;
  const requirement = Math.round((passed / task.checks.length) * 40);
  const missed = results.filter(item => !item.pass).map(item => item.label);
  if (missed.length) notes.push(`missing: ${missed.join('; ')}`);
  const formatPass = Boolean(task.format(text));
  const format = formatPass ? 10 : 0;
  if (!formatPass) notes.push('format does not match the request');
  const banned = BANNED.test(text) || task.forbid.some(pattern => pattern.test(text));
  const honesty = banned ? 0 : 10;
  if (banned) notes.push('forbidden or unproven claim');
  const score = requirement + format + honesty;
  return { score, requirement, format, honesty, passed, total: task.checks.length, notes, words: words.length };
}

const JUDGE_FORMAT = {
  type: 'object',
  properties: {
    correct: { type: 'integer' },
    useful: { type: 'integer' },
  },
  required: ['correct', 'useful'],
};

function parseJudge(raw) {
  const text = raw || '';
  try {
    const parsed = JSON.parse(text);
    const correct = Number(parsed.correct);
    const useful = Number(parsed.useful);
    if (Number.isFinite(correct) && Number.isFinite(useful)) {
      return {
        correct: Math.max(0, Math.min(5, Math.round(correct))),
        useful: Math.max(0, Math.min(5, Math.round(useful))),
        parsed: true,
        raw: text.slice(0, 400),
      };
    }
  } catch {
    // Try a loose line format below.
  }
  const correct = Number((text.match(/CORRECT\s*[:=]?\s*(\d)/i) || [])[1]);
  const useful = Number((text.match(/USEFUL\s*[:=]?\s*(\d)/i) || [])[1]);
  if (Number.isFinite(correct) && Number.isFinite(useful)) {
    return {
      correct: Math.max(0, Math.min(5, correct)),
      useful: Math.max(0, Math.min(5, useful)),
      parsed: true,
      raw: text.slice(0, 400),
    };
  }
  return { correct: 0, useful: 0, parsed: false, raw: text.slice(0, 400) };
}

function judgePoints(judge) {
  if (!judge.parsed) return 0;
  return Math.round((judge.correct / 5) * 24 + (judge.useful / 5) * 16);
}

function groqClient() {
  if (!groq) {
    groq = createGroqClient({
      model,
      log: message => console.log(message),
    });
  }
  return groq;
}

async function ollamaChat(messages, numPredict, temperature = 0.1, format) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '6h',
        messages,
        options: { temperature, num_predict: numPredict, num_ctx: 2048, num_thread: 4 },
        ...(format ? { format } : {}),
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    const parsed = JSON.parse(body);
    const content = parsed?.message?.content;
    if (typeof content !== 'string') throw new Error('missing message.content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages, numPredict, temperature = 0.1, format) {
  if (provider === 'groq') return groqClient().chat(messages, numPredict, temperature, Boolean(format));
  return ollamaChat(messages, numPredict, temperature, format);
}

async function judgeAnswer(agent, task, output) {
  const prompt = [
    'You are a strict reviewer. Return only JSON with integer fields correct and useful, each from 0 to 5.',
    'Score the answer only against the task. Do not require the role name to appear. Do not mark a complete answer as barely related.',
    'correct: 0 wrong, off-task, or a refusal of a legitimate request; 1 misses most requested parts; 2 has a real factual or completeness gap; 3 usable with one clear miss; 4 every requested part is present and right, with a minor wording gap; 5 a teammate could use it unchanged.',
    'useful: 0 nothing to use; 1 vague; 2 partial; 3 usable; 4 specific; 5 complete and concrete.',
    'Do not reward length or politeness. If every requested part is present and right, correct is 4 or 5.',
    `Role: ${agent.name}`,
    `Task: ${task.prompt.slice(0, 450)}`,
    `Answer: ${(output || '').slice(0, 700)}`,
  ].join('\n');
  const raw = await chat([{ role: 'user', content: prompt }], provider === 'groq' ? 220 : 60, 0, JUDGE_FORMAT);
  return parseJudge(raw);
}

function mean(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function loadCheckpoint() {
  if (!args.resume || !existsSync(jsonPath)) return { done: new Map(), rows: [] };
  const previous = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const rows = Array.isArray(previous.agents) ? previous.agents : [];
  return { done: new Map(rows.map(row => [row.name, row])), rows };
}

function carryForward(selected) {
  if (!fromPhase || under === null) return new Map();
  const path = join(outDir, `${fromPhase}.json`);
  if (!existsSync(path)) return new Map();
  const previous = JSON.parse(readFileSync(path, 'utf8'));
  const kept = new Map();
  for (const row of previous.agents || []) {
    if (row.combined >= under && !row.error) kept.set(row.name, { ...row, carried: true });
  }
  return kept;
}

function writeReport(rows) {
  mkdirSync(outDir, { recursive: true });
  const payload = {
    phase,
    model,
    host,
    scale: '0-100',
    rubricMax: 60,
    judgeMax: 40,
    limits: provider === 'groq' ? GROQ_FREE_LIMITS : undefined,
    groq: provider === 'groq' && groq ? groq.stats() : undefined,
    stoppedReason: stoppedReason || '',
    generatedAt: new Date().toISOString(),
    agentCount: rows.length,
    at100: rows.filter(row => row.combined === 100 && !row.error).length,
    meanRubric: mean(rows.map(row => row.rubric)),
    meanJudge: mean(rows.map(row => row.judgeScore)),
    meanCombined: mean(rows.map(row => row.combined)),
    errors: rows.filter(row => row.error).length,
    judgeParsed: rows.filter(row => row.judge && row.judge.parsed).length,
    agents: rows,
  };
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  writeMarkdown();
}

function phaseFile(name) {
  const path = join(outDir, `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeMarkdown() {
  const legacyBefore = phaseFile('before');
  const legacyAfter = phaseFile('after');
  const bigBefore = phaseFile('big-before');
  const bigAfter = phaseFile('big-after');
  const groqBefore = phaseFile('groq-before');
  const groqAfter = phaseFile('groq-after');
  const groqAfter2 = phaseFile('groq-after-2');
  const groqAfter3 = phaseFile('groq-after-3');
  const lines = [];
  lines.push('# Agent evaluation');
  lines.push('');
  lines.push('Two rounds are recorded. They are not the same scale.');
  lines.push('');
  lines.push('Round 1 used local `llama3.2:1b` and a loose rubric whose maximum added up to 115. Mean combined moved from 88.3 to 89.3. That one-point move was smaller than the noise of a 1B model.');
  lines.push('');
  lines.push('Later rounds use a strict 0-100 score. Rubric is 60: 40 for the requirements the task stated, 10 for the requested format, 10 for staying off forbidden or unproven claims. Judge is 40 from the same model: `correct` 0-5 scaled to 24 and `useful` 0-5 scaled to 16. An unparsed judge is 0. A score of 100 means every requirement, the format, the honesty check, and a 5/5 judge. Keyword overlap alone cannot reach 100.');
  lines.push('');
  lines.push('When `GROQ_API_KEY` is set, the harness calls Groq\'s free-tier model `openai/gpt-oss-120b` (30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD). Calls are sequential, paced under those limits, and back off on HTTP 429. No paid model is called.');
  lines.push('');
  if (legacyBefore && legacyAfter) {
    lines.push(`Round 1, loose scale, \`${legacyBefore.model}\`: before ${legacyBefore.meanCombined}, after ${legacyAfter.meanCombined}, ${legacyBefore.agentCount} agents, ${legacyBefore.errors} errors.`);
    lines.push('');
  }
  lines.push('| Phase | Model | Scale | Agents | Errors | At 100 | Mean rubric | Mean judge | Mean combined |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  const noted = [];
  for (const item of [bigBefore, bigAfter, groqBefore, groqAfter, groqAfter2, groqAfter3].filter(Boolean)) {
    lines.push(`| ${item.phase} | ${item.model} | ${item.scale || '0-100'} | ${item.agentCount} | ${item.errors} | ${item.at100 ?? ''} | ${item.meanRubric} | ${item.meanJudge} | ${item.meanCombined} |`);
    if (item.groq) noted.push(`\`${item.phase}\` Groq usage: tokens=${item.groq.tokens} requests=${item.groq.requests}.`);
    if (item.stoppedReason) noted.push(`\`${item.phase}\` stopped: ${String(item.stoppedReason).replace(/\|/g, '/').slice(0, 300)}`);
  }
  if (noted.length) {
    lines.push('');
    lines.push(...noted);
  }
  if (bigBefore && bigAfter) {
    const prior = new Map(bigBefore.agents.map(row => [row.name, row]));
    const deltas = bigAfter.agents
      .filter(row => prior.has(row.name))
      .map(row => ({
        name: row.name,
        before: prior.get(row.name).combined,
        after: row.combined,
        delta: Math.round((row.combined - prior.get(row.name).combined) * 10) / 10,
        notes: (row.rubricNotes || []).join('; '),
      }));
    const improved = deltas.filter(row => row.delta > 0).length;
    const regressed = deltas.filter(row => row.delta < 0).length;
    const same = deltas.filter(row => row.delta === 0).length;
    const reached = bigAfter.agents.filter(row => row.combined === 100 && !row.error);
    lines.push('');
    lines.push(`Strict scale, ${deltas.length} names: ${improved} improved, ${regressed} regressed, ${same} unchanged. Mean combined ${bigBefore.meanCombined} → ${bigAfter.meanCombined}. ${reached.length} agents scored 100.`);
    const movers = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
    lines.push('');
    lines.push('## Largest score changes');
    lines.push('');
    lines.push('| Agent | Before | After | Delta |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of movers) lines.push(`| \`${row.name}\` | ${row.before} | ${row.after} | ${row.delta} |`);
    const short = deltas.filter(row => row.after < 100).sort((a, b) => a.after - b.after);
    lines.push('');
    lines.push(`## Still under 100 (${short.length})`);
    lines.push('');
    lines.push('| Agent | Before | After | Why the after score stopped here |');
    lines.push('| --- | ---: | ---: | --- |');
    for (const row of short) {
      const note = row.notes.replace(/\|/g, '/').slice(0, 180);
      lines.push(`| \`${row.name}\` | ${row.before} | ${row.after} | ${note} |`);
    }
  }
  const latest = groqAfter3 || groqAfter2 || groqAfter || groqBefore || bigAfter || bigBefore;
  if (latest) {
    const ranked = [...latest.agents].sort((a, b) => a.combined - b.combined || a.name.localeCompare(b.name));
    lines.push('');
    lines.push(`## Every agent (${latest.phase})`);
    lines.push('');
    lines.push('| Agent | Combined | Rubric | Judge | Requirements | Error |');
    lines.push('| --- | ---: | ---: | ---: | --- | --- |');
    for (const row of [...latest.agents].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| \`${row.name}\` | ${row.combined} | ${row.rubric} | ${row.judgeScore} | ${row.expectHits}/${row.expectTotal} | ${row.error ? 'yes' : ''} |`);
    }
    lines.push('');
    lines.push(`Judge JSON parsed for ${latest.judgeParsed ?? 'n/a'} of ${latest.agentCount} rows.`);
  }
  lines.push('');
  lines.push('Raw rows, including model output, are in `docs/eval/`.');
  writeFileSync(join(root, 'docs', 'agent-eval-results.md'), lines.join('\n') + '\n');
}

async function calibrate() {
  const good = 'function isEven(n) {\n  if (!Number.isFinite(n)) throw new Error("nan");\n  return n % 2 === 0;\n}\nisEven(4);';
  const bad = 'I like pancakes and the weather is nice today.';
  const task = taskFor({ name: 'coder', description: 'implements code' });
  const goodRubric = rubric(task, good);
  const badRubric = rubric(task, bad);
  const planTask = taskFor({ name: 'adaptive-coordinator', description: 'swarm planner' });
  const plan = '1. Developer: Add the GET /health endpoint to the route definitions.\n2. Developer: Implement the handler so GET /health returns a status.\n3. Tester: Write a test that the GET /health endpoint returns the expected status.\n4. Tester: Run the test and fix failures.';
  const planRubric = rubric(planTask, plan);
  const goodJudge = await judgeAnswer({ name: 'coder' }, task, good);
  const badJudge = await judgeAnswer({ name: 'coder' }, task, bad);
  const planJudge = await judgeAnswer({ name: 'adaptive-coordinator' }, planTask, plan);
  const goodScore = goodRubric.score + judgePoints(goodJudge);
  const badScore = badRubric.score + judgePoints(badJudge);
  const planScore = planRubric.score + judgePoints(planJudge);
  const ok = goodScore > badScore && goodJudge.correct >= 4 && badJudge.correct <= 1 && planJudge.correct >= 4;
  console.log(JSON.stringify({
    good: { rubric: goodRubric.score, judge: goodJudge, total: goodScore },
    bad: { rubric: badRubric.score, judge: badJudge, total: badScore },
    plan: { rubric: planRubric.score, judge: planJudge, total: planScore },
    judgeSeparates: ok,
  }, null, 2));
  if (!ok) process.exit(2);
}

function stopForLimit(err) {
  stoppedReason = String(err.message || err);
  console.log(`stop: ${stoppedReason}`);
  return true;
}

async function main() {
  if (provider === 'groq') await groqClient().confirm();
  if (args.calibrate) {
    await calibrate();
    return;
  }
  if (provider !== 'groq') {
    const tags = await fetch(`${host}/api/tags`).then(response => response.json());
    const names = (tags.models || []).map(item => item.name);
    if (!names.some(name => name === model || name.startsWith(`${model}:`) || model.startsWith(name))) {
      throw new Error(`Model ${model} is not pulled. Installed: ${names.join(', ') || '(none)'}`);
    }
  }
  let agents = loadUniqueAgents().sort((a, b) => a.name.localeCompare(b.name));
  const carried = carryForward(agents);
  if (under !== null && fromPhase) {
    agents = agents.filter(agent => !carried.has(agent.name));
    const priorPath = join(outDir, `${fromPhase}.json`);
    if (existsSync(priorPath)) {
      const prior = new Map((JSON.parse(readFileSync(priorPath, 'utf8')).agents || []).map(row => [row.name, row.combined || 0]));
      agents.sort((a, b) => (prior.get(b.name) || 0) - (prior.get(a.name) || 0) || a.name.localeCompare(b.name));
    }
  }
  const selected = agents.slice(0, Number.isFinite(limit) ? limit : agents.length);
  const checkpoint = loadCheckpoint();
  const rows = [...checkpoint.rows];
  for (const [name, row] of carried) {
    if (!rows.some(item => item.name === name)) rows.push(row);
  }
  console.log(`phase=${phase} model=${model} toRun=${selected.length} carried=${carried.size} resumed=${checkpoint.done.size}`);
  for (const agent of selected) {
    if (checkpoint.done.has(agent.name)) continue;
    const task = taskFor(agent);
    const system = [
      agent.instructions.slice(0, provider === 'groq' ? 500 : 1500),
      '',
      'Follow the user\'s requested format. Do not invent benchmark multipliers, citations, or tool results.',
    ].join('\n');
    const started = Date.now();
    let output = '';
    let error = '';
    try {
      output = await chat([
        { role: 'system', content: system },
        { role: 'user', content: task.prompt },
      ], provider === 'groq' ? 400 : 200);
    } catch (err) {
      if (err instanceof DailyLimitError || err.name === 'DailyLimitError') {
        stopForLimit(err);
        break;
      }
      if (err instanceof FatalGroqError || err.name === 'FatalGroqError') throw err;
      error = err.name === 'AbortError' ? 'timeout' : String(err.message || err);
    }
    const graded = rubric(task, output);
    let judge = { correct: 0, useful: 0, parsed: false, raw: '' };
    if (!error && output.trim()) {
      try {
        judge = await judgeAnswer(agent, task, output);
      } catch (err) {
        if (err instanceof DailyLimitError || err.name === 'DailyLimitError') {
          stopForLimit(err);
          break;
        }
        if (err instanceof FatalGroqError || err.name === 'FatalGroqError') throw err;
        judge.raw = String(err.message || err).slice(0, 200);
      }
    }
    const judgeScore = judgePoints(judge);
    const row = {
      name: agent.name,
      source: agent.source,
      copies: agent.copies,
      kind: task.kind,
      description: agent.description.slice(0, 240),
      task: task.prompt,
      expectHits: graded.passed,
      expectTotal: graded.total,
      rubric: graded.score,
      requirement: graded.requirement,
      format: graded.format,
      honesty: graded.honesty,
      rubricNotes: graded.notes,
      words: graded.words,
      judge: { correct: judge.correct, useful: judge.useful, parsed: judge.parsed },
      judgeScore,
      judgeReason: judge.raw,
      combined: graded.score + judgeScore,
      output: output.slice(0, 1500),
      instructionChars: provider === 'groq' ? 500 : 1500,
      error,
      ms: Date.now() - started,
    };
    rows.push(row);
    writeReport(rows);
    const usage = provider === 'groq' ? groq.stats() : null;
    const usageText = usage ? ` tokens=${usage.tokens} remainingRequests=${usage.remainingRequests}` : '';
    console.log(`${rows.filter(item => !item.carried).length}/${selected.length} ${agent.name} combined=${row.combined} rubric=${row.rubric} judge=${row.judgeScore}${error ? ` ERROR ${error}` : ''}${usageText}`);
  }
  writeReport(rows);
  console.log(`wrote ${jsonPath} mean=${mean(rows.map(row => row.combined))} at100=${rows.filter(row => row.combined === 100 && !row.error).length}`);
}

main().catch(err => {
  console.error(redact(err && err.stack ? err.stack : err));
  process.exit(1);
});
