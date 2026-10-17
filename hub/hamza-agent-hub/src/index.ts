#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { createHamzaHubServer } from './mcp/tools.js';
import { createHttpApp } from './mcp/http.js';
import { getDb, closeDb } from './storage/db.js';
import { assertCatalog } from './runtime/registry.js';
import { stopQueue } from './runtime/queue.js';
import { runAllSmokeChecks } from './tools/smoke.js';

async function main() {
  getDb(); assertCatalog();
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
main().catch(() => { console.error('Hub startup failed; check configuration / فشل بدء التشغيل'); process.exitCode = 1; });
