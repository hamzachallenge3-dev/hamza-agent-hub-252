#!/usr/bin/env node
/**
 * Mark duplicate agent files and remove unproven speed and trading claims
 * from agent prompts. Does not delete upstream text: a duplicate keeps its
 * body and gains a pointer to the file execution actually loads.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const GROUPS = [
  { dir: join(root, '.ruflo', 'agents'), weight: 0 },
  { dir: join(root, '.claude', 'agents'), weight: 1 },
  { dir: join(root, 'plugins'), weight: 2, filter: path => path.split(sep).includes('agents') },
  { dir: join(root, 'plugin'), weight: 2, filter: path => path.split(sep).includes('agents') },
  { dir: join(root, 'v3', '@claude-flow', 'cli', '.claude', 'agents'), weight: 3 },
  { dir: join(root, 'v3', '@claude-flow', 'mcp', '.claude', 'agents'), weight: 3 },
];

const HONEST = 'an HNSW index (do not cite a speedup unless you measured it in this session)';
const TRADE_RULE = [
  '## Hard limits',
  '',
  'You do not predict a future price, place or recommend a live trade, or claim a temporal advantage over market data. Light-travel and "before the quote arrives" stories are not a trading system. You can list the historical inputs a backtest needs and the risk controls that would block an order.',
  '',
].join('\n');

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

function agentFiles() {
  const found = [];
  for (const group of GROUPS) {
    for (const file of walk(group.dir)) {
      if (group.filter && !group.filter(file)) continue;
      const name = basename(file);
      if (name === 'README.md' || name === 'MIGRATION_SUMMARY.md') continue;
      if (!name.endsWith('.md') && !name.endsWith('.json')) continue;
      found.push({ file, weight: group.weight, source: relative(root, file).split(sep).join('/') });
    }
  }
  found.sort((a, b) => a.weight - b.weight || a.source.localeCompare(b.source));
  return found;
}

function agentName(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (file.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string') return parsed.name.trim();
    } catch { /* use filename */ }
    return basename(file, '.json');
  }
  const match = raw.match(/^---\r?\n[\s\S]*?\nname:\s*["']?([^"'\n]+)/);
  return (match ? match[1] : basename(file, '.md')).replace(/\s+/g, ' ').trim();
}

function soften(text) {
  return text
    .replace(/150x\s*[-–]\s*12[,.]?500x(?:\s+faster)?/gi, HONEST)
    .replace(/150x\s*[-–]\s*12500x(?:\s+faster)?/gi, HONEST)
    .replace(/\b150x faster\b/gi, 'indexed search (measure before claiming a speedup)')
    .replace(/\b2\.49x\s*[-–]\s*7\.47x(?:\s+speedup)?/gi, 'a Flash Attention integration (do not cite a speedup unless you measured it)');
}

function markMarkdown(raw, canonical) {
  const banner = `> Duplicate of \`${canonical}\`. Execution uses that file. This copy is kept so the original prompt is not deleted.`;
  if (!raw.startsWith('---')) {
    return banner + '\n\n' + raw;
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return banner + '\n\n' + raw;
  let front = raw.slice(0, end);
  if (!/^duplicateOf:/m.test(front)) {
    front += `\nduplicateOf: ${canonical}\ncanonical: false`;
  }
  let body = raw.slice(end);
  if (!body.includes('Duplicate of `')) {
    body = body.replace(/^\n---\r?\n?/, match => `${match}\n${banner}\n\n`);
  }
  return front + body;
}

function markJson(raw, canonical) {
  const parsed = JSON.parse(raw);
  parsed.duplicateOf = canonical;
  parsed.canonical = false;
  if (typeof parsed.instructions === 'string' && !parsed.instructions.includes('Duplicate of `')) {
    parsed.instructions = `Duplicate of ${canonical}. Execution uses that file.\n\n${parsed.instructions}`;
  }
  return JSON.stringify(parsed, null, 2) + '\n';
}

function rewriteTrading(raw) {
  let next = raw;
  if (next.startsWith('---')) {
    next = next.replace(
      /description:\s*\|[\s\S]*?(?=\n---)/,
      'description: Explains backtest inputs and risk controls. Does not predict prices, place trades, or claim a temporal advantage over market data.\n',
    );
    next = next.replace(
      /description:\s*"[^"]*"/,
      'description: "Explains backtest inputs and risk controls. Does not predict prices, place trades, or claim a temporal advantage over market data."',
    );
  }
  if (!next.includes('## Hard limits')) {
    next = next.replace(/\n---\r?\n/, match => `${match}\n${TRADE_RULE}`);
  }
  next = next.replace(
    /You are a Trading Predictor Agent[\s\S]*?exceed light-speed data transmission times\./,
    'You explain how a historical backtest is specified. You do not predict prices or place trades.',
  );
  return next;
}

const files = agentFiles();
const winners = new Map();
for (const item of files) {
  const name = agentName(item.file);
  if (!winners.has(name)) winners.set(name, item.source);
}

let marked = 0;
let softened = 0;
let trading = 0;
for (const item of files) {
  const name = agentName(item.file);
  const canonical = winners.get(name);
  let raw = readFileSync(item.file, 'utf8');
  const original = raw;
  if (canonical !== item.source) {
    raw = item.file.endsWith('.json') ? markJson(raw, canonical) : markMarkdown(raw, canonical);
    if (raw !== original) marked++;
  }
  const beforeSoften = raw;
  raw = soften(raw);
  if (raw !== beforeSoften) softened++;
  if (basename(item.file) === 'trading-predictor.md' || name === 'trading-predictor') {
    const beforeTrade = raw;
    raw = rewriteTrading(raw);
    if (raw !== beforeTrade) trading++;
  }
  if (raw !== original) writeFileSync(item.file, raw);
}

console.log(JSON.stringify({ files: files.length, names: winners.size, marked, softened, trading }, null, 2));
