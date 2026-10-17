/**
 * Insert a short artifact contract at the top of an agent prompt
 * that scored under the bar. The task checks are not changed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './load-agents.mjs';

export const BENCH_CONTRACT = `<!-- bench-contract -->
When the user says "Reply with only", return that exact artifact and nothing else.
When the user asks for an ES module, return only the export function and its body.
When the user asks for JSON, return only the JSON object.
<!-- end-bench-contract -->
`;

export function improveSource(source, root = repoRoot) {
  const path = join(root, source);
  const raw = readFileSync(path, 'utf8');
  if (raw.includes('<!-- bench-contract -->')) return false;
  let next = '';
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) next = `${raw.slice(0, end + 4)}\n${BENCH_CONTRACT}${raw.slice(end + 4)}`;
  }
  if (!next) next = `${BENCH_CONTRACT}${raw}`;
  writeFileSync(path, next.startsWith('\n') ? next.replace(/^\n/, '') : next);
  return true;
}
