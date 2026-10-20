#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { createHamzaHubServer } from './mcp/tools.js';
import { createHttpApp } from './mcp/http.js';
import { getDb, closeDb } from './storage/db.js';
import { assertCatalog } from './runtime/registry.js';
import { stopQueue } from './runtime/queue.js';
import { runAllSmokeChecks } from './tools/smoke.js';
import { redactSecrets } from './security/redact.js';
import { initializeEngine } from './model/engine.js';
import { ensureBrowserBox, startBrowserBox } from './browser/box.js';
import { collectHealth } from './runtime/health.js';

async function main() {
  const command = process.argv[2];
  if (command === 'status' || command === 'health') {
    await initializeEngine(2_000, true);
    await ensureBrowserBox({ maxAttempts: 3 });
    const report = await collectHealth(500);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  getDb(); assertCatalog();
  const engine = await initializeEngine(2_000, true);
  if (engine.error) console.error(engine.error);
  startBrowserBox();
  const listener = config.transport === 'http'
    ? createHttpApp().listen(config.port, config.host)
    : null;
  const server = listener ? null : createHamzaHubServer();
  if (server) await server.connect(new StdioServerTransport());
  // Measure the tools once at startup so routing and the roster report what
  // actually ran rather than the catalog's `tested` flag. Deliberately not
  // awaited: the Hub serves traffic immediately and reports declared readiness
  // until the checks land, which is the honest ordering.
  void runAllSmokeChecks().catch(() => undefined);
  const shutdown = async () => {
    listener?.close(); await server?.close(); await stopQueue(); closeDb();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
main().catch((err) => {
  const detail = redactSecrets(err instanceof Error ? err.message : String(err));
  console.error(`Hub startup failed: ${detail}`);
  process.exitCode = 1;
});
