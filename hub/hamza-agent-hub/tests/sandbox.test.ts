import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHamzaHubServer } from '../src/mcp/tools.js';
import { createHttpApp } from '../src/mcp/http.js';
import { stopQueue } from '../src/runtime/queue.js';
import { closeDb } from '../src/storage/db.js';
import { MCP_SURFACE_TOOLS, SANDBOX_MCP_TOOLS } from '../src/runtime/browse.js';
import { runSandboxCommand, sandboxToolsEnabled } from '../src/tools/sandbox.js';

let base: string;
let work: string;
let clients: Client[] = [];
let servers: ReturnType<typeof createHamzaHubServer>[] = [];
let listener: ReturnType<ReturnType<typeof createHttpApp>['listen']> | undefined;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-sandbox-'));
  work = path.join(base, 'work');
  fs.mkdirSync(work, { recursive: true });
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
  vi.stubEnv('HAH_AUTH_TOKEN', 'test-only-authentication-token-32');
  vi.stubEnv('HUB_SANDBOX_USER', os.userInfo().username);
  vi.stubEnv('HUB_SANDBOX_WORK_DIR', work);
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  vi.stubEnv('HAH_FREELLMAPI_URL', '');
  vi.stubEnv('HAH_ENABLE_SANDBOX_TOOLS', '');
  vi.stubEnv('HAH_TRANSPORT', 'stdio');
});

afterEach(async () => {
  for (const c of clients) await c.close();
  for (const s of servers) await s.close();
  clients = [];
  servers = [];
  if (listener) {
    await new Promise<void>((resolve) => listener!.close(() => resolve()));
    listener = undefined;
  }
  await stopQueue();
  closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

it('hides run_command on stdio; exposes it on authenticated HTTP', async () => {
  expect(sandboxToolsEnabled()).toBe(false);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createHamzaHubServer();
  const c = new Client({ name: 'sandbox-stdio', version: '1' });
  servers.push(server);
  clients.push(c);
  await server.connect(a);
  await c.connect(b);
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  expect(names).toEqual([...MCP_SURFACE_TOOLS].sort());
  expect(names).not.toContain('run_command');

  vi.stubEnv('HAH_TRANSPORT', 'http');
  expect(sandboxToolsEnabled()).toBe(true);
  listener = createHttpApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener!.once('listening', resolve);
    listener!.once('error', reject);
  });
  const port = (listener.address() as { port: number }).port;
  const headers = {
    Authorization: 'Bearer test-only-authentication-token-32',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'sandbox-http', version: '1' },
      },
    }),
  });
  expect(init.status).toBe(200);
  const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const tools = (await listed.json()).result.tools.map((t: { name: string }) => t.name).sort();
  expect(tools).toEqual([...MCP_SURFACE_TOOLS, ...SANDBOX_MCP_TOOLS].sort());
});

it('run_command executes as sandbox user with cwd/timeout/output limits', async () => {
  vi.stubEnv('HAH_TRANSPORT', 'http');
  const ok = await runSandboxCommand({ command: 'echo hello-sandbox && pwd && whoami' });
  expect(ok.ok).toBe(true);
  expect(ok.stdout).toContain('hello-sandbox');
  expect(ok.cwd).toBe(fs.realpathSync(work));
  expect(ok.user).toBe(os.userInfo().username);

  await expect(runSandboxCommand({ command: 'true', cwd: '../escape' })).rejects.toThrow(/cwd must stay under/);

  const timed = await runSandboxCommand({ command: 'sleep 5', timeout_ms: 1000 });
  expect(timed.timed_out).toBe(true);
  expect(timed.ok).toBe(false);

  const big = await runSandboxCommand({
    command: 'python3 -c "print(\'x\'*200000)"',
    timeout_ms: 10_000,
  });
  expect(big.truncated).toBe(true);
  expect(Buffer.byteLength(big.stdout, 'utf8')).toBeLessThanOrEqual(70_000);
});

it('bounds what a command may consume, not just how long it runs', async () => {
  vi.stubEnv('HAH_TRANSPORT', 'http');

  // The limits are visible to the command itself, which is the only way to
  // prove they were applied rather than merely configured.
  const limits = await runSandboxCommand({ command: 'ulimit -S -t; ulimit -S -u; ulimit -S -c', timeout_ms: 10_000 });
  expect(limits.ok).toBe(true);
  const [cpu, procs, core] = limits.stdout.trim().split('\n').map((l) => l.trim());
  expect(cpu).toBe('60');
  expect(procs).toBe('512');
  expect(core).toBe('0');

  // A write past the file-size limit fails; without it the box fills up.
  vi.stubEnv('HAH_SANDBOX_FILE_KB', '64');
  const tooBig = await runSandboxCommand({
    command: 'dd if=/dev/zero of=big.bin bs=1024 count=4096 2>&1; echo exit=$?',
    timeout_ms: 20_000,
  });
  expect(tooBig.stdout).not.toContain('exit=0');

  // A limit the kernel rejects must not break an otherwise fine command.
  vi.stubEnv('HAH_SANDBOX_MEMORY_KB', '1');
  const stillRuns = await runSandboxCommand({ command: 'echo survived', timeout_ms: 10_000 });
  expect(stillRuns.stdout).toContain('survived');
});

it('MCP run_command works through authenticated HTTP', async () => {
  vi.stubEnv('HAH_TRANSPORT', 'http');
  listener = createHttpApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener!.once('listening', resolve);
    listener!.once('error', reject);
  });
  const port = (listener.address() as { port: number }).port;
  const headers = {
    Authorization: 'Bearer test-only-authentication-token-32',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'sandbox-call', version: '1' },
      },
    }),
  });
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'run_command', arguments: { command: 'echo mcp-ok' } },
    }),
  });
  const body = await res.json();
  const payload = JSON.parse(body.result.content[0].text);
  expect(payload.ok).toBe(true);
  expect(payload.stdout).toContain('mcp-ok');
});
