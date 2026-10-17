/**
 * Runs the routing benchmark and prints the measured numbers.
 *
 * `npm run benchmark`. Writes docs/benchmark.json so runs can be compared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runBenchmark } from '../src/runtime/benchmark.js';
import { ROOT } from '../src/config.js';

const report = await runBenchmark();

const out = path.join(ROOT, 'docs', 'benchmark.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), ...report }, null, 2));

for (const result of report.cases) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${result.id}  ${result.primary.padEnd(26)} ${result.routed_capabilities.join(',')}`);
  for (const failure of result.failures) console.log(`        ${failure}`);
}

console.log('');
console.log(`routing accuracy    ${(report.routing_accuracy * 100).toFixed(1)}%  (${report.passed}/${report.total})`);
console.log(`tool success rate   ${(report.tool_success_rate * 100).toFixed(1)}%  (${report.tools.passed}/${report.tools.total})`);
console.log(`latency p50/p95/max ${report.latency_ms.p50}/${report.latency_ms.p95}/${report.latency_ms.max} ms`);
console.log(`limited primaries   ${report.degraded_assignments}/${report.total} (no live model configured)`);
console.log(`\nwritten to ${path.relative(ROOT, out)}`);

if (report.passed !== report.total) process.exitCode = 1;
