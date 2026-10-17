/**
 * Writes the per-agent audit to docs/agent-audit.json and prints a summary.
 *
 * Run with `npm run audit:agents`. Every number it prints comes from executing
 * the tool smoke checks and reading the capability model, never from a
 * hand-maintained list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { auditAgents, auditSummary } from '../src/runtime/audit.js';
import { tools13Capabilities } from '../src/packs/tools13/offline.js';
import { ROOT } from '../src/config.js';

async function main() {
  const [audit, summary] = await Promise.all([auditAgents(), auditSummary()]);

  const out = path.join(ROOT, 'docs', 'agent-audit.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify({ generated_at: new Date().toISOString(), summary, tools13: tools13Capabilities(), agents: audit }, null, 2)
  );

  console.log(`agents              ${summary.total}`);
  console.log(`  READY             ${summary.ready}`);
  console.log(`  LIMITED           ${summary.limited}`);
  console.log(`  BLOCKED           ${summary.blocked}`);
  console.log(`  UNTESTED          ${summary.untested}`);
  console.log(`all tools executed  ${summary.all_tools_executed}`);
  console.log(`some tools executed ${summary.some_tools_executed}`);
  console.log(`declared only       ${summary.declared_only}`);
  console.log(`declared tested     ${summary.declared_tested}`);
  console.log(`model configured    ${summary.model_ready}`);
  console.log(`tools verified      ${summary.tools.verified}`);
  console.log(`tools external      ${summary.tools.external}`);
  console.log(`packs               ${JSON.stringify(summary.packs)}`);

  const byReason = new Map<string, number>();
  for (const row of audit) byReason.set(row.readiness_reason, (byReason.get(row.readiness_reason) ?? 0) + 1);
  console.log('\nreadiness reasons:');
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${reason}`);
  }

  console.log(`\nwritten to ${path.relative(ROOT, out)}`);
}

await main();
