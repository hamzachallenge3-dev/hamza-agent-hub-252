#!/usr/bin/env node
/**
 * Load and execute one catalog plugin.
 *
 * Hook plugins: import hooks/register.ts and call register(), then
 * session.start and the command the plugin registered.
 * ruflo-core: run its hooks.json entry, precompact-auto, which does not
 * spawn the CLI.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginsRoot = join(repoRoot, 'plugins');

export function catalogNames() {
  return readdirSync(pluginsRoot)
    .filter((name) => existsSync(join(pluginsRoot, name, '.claude-plugin', 'plugin.json')))
    .sort();
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
}

function promiseBag(impl) {
  return new Proxy(impl, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop, receiver);
      return async () => undefined;
    },
  });
}

function createHost(root) {
  const files = new Map();
  const commands = [];
  const store = new Map();
  const dollar = {
    plugin: { root },
    session: promiseBag({
      root: async () => root,
      usage: async () => ({ cost: { usd: 0 }, context: { percent: 0 } }),
    }),
    clock: promiseBag({
      now: async () => Date.now(),
      after: () => Promise.resolve(0),
      every: () => ({ stop() {} }),
    }),
    command: promiseBag({
      register: async (spec) => {
        commands.push(spec?.name || spec);
        return { command: spec?.name };
      },
      list: async () => commands.map((name) => ({ name })),
      run: async () => ({ text: '' }),
    }),
    fs: promiseBag({
      write: async (path, text) => { files.set(path, String(text ?? '')); },
      read: async (path) => {
        if (!files.has(path)) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
        return files.get(path);
      },
      stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      exists: async (path) => files.has(path),
      list: async () => [],
    }),
    store: promiseBag({
      get: async (key) => (store.has(key) ? store.get(key) : null),
      set: async (key, value) => { store.set(key, value); },
    }),
    ui: promiseBag({
      toast() {},
      invalidate() {},
      log() {},
      open: async () => ({ id: 'pane' }),
      close: async () => {},
      panes: async () => [],
      scroll() {},
      focus: async () => {},
      blit() {},
      ask: async () => null,
    }),
    process: promiseBag({
      run: async () => ({ exitCode: 127, stdout: '', stderr: '' }),
      spawn() {
        return { kill() {}, on() {}, stdout: { on() {} }, stderr: { on() {} } };
      },
    }),
    tool: promiseBag({
      list: async () => [],
      call: async () => ({ result: 'ok' }),
      check: async () => ({ allowed: true }),
    }),
    env: promiseBag({ get: async (key) => process.env[key] ?? null }),
    settings: promiseBag({ read: async () => ({}) }),
    http: promiseBag({ fetch: async () => ({ ok: false, status: 0, text: '' }) }),
    prompt: promiseBag({
      submit: async () => {},
      fill: async () => ({ isFilled: false }),
    }),
    agent: promiseBag({ list: async () => [] }),
    ruflo: promiseBag({
      snapshot: async () => ({}),
      lastRoute: async () => null,
      segment: async () => [],
    }),
  };
  return { dollar: promiseBag(dollar), files, commands };
}

function createBus(dollar) {
  const handlers = [];
  const on = (event, filterOrFn, maybeFn) => {
    const fn = typeof maybeFn === 'function' ? maybeFn : filterOrFn;
    const filter = typeof maybeFn === 'function' ? filterOrFn : null;
    const entry = { event, filter, fn, recover: null };
    handlers.push(entry);
    return {
      catch(recover) {
        entry.recover = recover;
        return this;
      },
    };
  };
  const matches = (filter, input) => {
    if (!filter || typeof filter !== 'object') return true;
    return Object.entries(filter).every(([key, value]) => input?.[key] === value);
  };
  const emit = async (event, input) => {
    const matched = handlers.filter((handler) => handler.event === event && matches(handler.filter, input));
    let index = 0;
    const next = async (eventInput) => {
      const handler = matched[index++];
      if (!handler) return eventInput;
      try {
        return await handler.fn(dollar, eventInput, next);
      } catch (error) {
        if (typeof handler.recover !== 'function') throw error;
        const failNext = (input) => next(input);
        failNext.error = error;
        return handler.recover(dollar, eventInput, failNext);
      }
    };
    return next(input);
  };
  return { on, emit, handlers };
}

async function withTimeout(work, ms) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runCore(dir, manifest) {
  const script = join(dir, 'scripts', 'ruflo-hook.cjs');
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'precompact-auto'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('precompact-auto timed out'));
    }, 8000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `exit ${code}`));
      else resolve(out.trim());
    });
  });
  return {
    plugin: manifest.name,
    version: manifest.version,
    module: 'scripts/ruflo-hook.cjs',
    export: 'precompact-auto',
    ok: true,
    result: { exit: 0, lines: stdout.split('\n').filter(Boolean).length, head: stdout.split('\n')[0] || '' },
  };
}

async function runCostTracker(dir, manifest) {
  const home = mkdtempSync(join(tmpdir(), 'ruflo-cost-home-'));
  const project = join(home, 'proj');
  mkdirSync(project, { recursive: true });
  const encoded = project.replace(/[/\\:]/g, '-');
  const sessionDir = join(home, '.claude', 'projects', encoded);
  mkdirSync(sessionDir, { recursive: true });
  const session = join(sessionDir, 'session.jsonl');
  writeFileSync(session, `${JSON.stringify({
    sessionId: 'cost-proof',
    cwd: project,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'assistant',
    message: {
      model: 'llama-local',
      usage: { input_tokens: 10, output_tokens: 4 },
    },
  })}\n`);
  const out = join(home, 'summary.json');
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(dir, 'scripts', 'track.mjs')], {
        cwd: project,
        env: {
          ...process.env,
          HOME: home,
          TRACK_CWD: project,
          TRACK_SESSION: session,
          TRACK_DRY_RUN: '1',
          TRACK_OUT: out,
          TRACK_QUIET: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.stdout.on('data', () => {});
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('track.mjs timed out'));
      }, 8000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(err.trim() || `exit ${code}`));
        else resolve(err);
      });
    });
    const summary = JSON.parse(readFileSync(out, 'utf8'));
    return {
      plugin: manifest.name,
      version: manifest.version,
      module: 'scripts/track.mjs',
      export: 'main',
      ok: true,
      result: {
        dryRun: true,
        sessionId: summary.sessionId,
        messages: summary.messageCount,
        total_cost_usd: summary.total_cost_usd,
        stderr: stdout.slice(0, 120),
      },
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function runRegister(dir, manifest) {
  const href = pathToFileURL(join(dir, 'hooks', 'register.ts')).href;
  const loaded = await import(href);
  if (typeof loaded.register !== 'function') {
    throw new Error('hooks/register.ts did not export register');
  }
  const root = mkdtempSync(join(tmpdir(), 'ruflo-plugin-'));
  try {
    const { dollar, files, commands } = createHost(root);
    const bus = createBus(dollar);
    loaded.register(bus.on, {});
    const started = await withTimeout(bus.emit('session.start', {
      surface: 'terminal',
      isInteractive: true,
      cwd: root,
    }), 8000);
    let commandResult = null;
    const commandName = commands.find((name) => typeof name === 'string');
    if (commandName) {
      commandResult = await withTimeout(bus.emit('command.run', {
        command: commandName,
        args: 'status',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      }), 8000);
    }
    const text = commandResult && typeof commandResult.text === 'string' ? commandResult.text : '';
    return {
      plugin: manifest.name,
      version: manifest.version,
      module: 'hooks/register.ts',
      export: 'register',
      ok: true,
      result: {
        handlers: bus.handlers.length,
        commands,
        files: files.size,
        session: started && typeof started === 'object' ? 'returned' : 'ran',
        command: commandName || null,
        text: text.slice(0, 180),
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function exerciseService(name, dir) {
  if (name === 'ruflo-ai-team') {
    const mod = await import(pathToFileURL(join(dir, 'src/server.mjs')).href);
    return { module: 'src/server.mjs', export: 'parseAllowedOrigins', origins: [...mod.parseAllowedOrigins('https://localhost:8443')] };
  }
  if (name === 'ruflo-chatgpt-federation') {
    const mod = await import(pathToFileURL(join(dir, 'src/server.mjs')).href);
    return {
      module: 'src/server.mjs',
      export: 'checkCaller',
      rejectsWrongToken: mod.checkCaller('nope', 'secret') === false,
      acceptsMatchingToken: mod.checkCaller('secret', 'secret') === true,
    };
  }
  if (name === 'ruflo-x-gateway') {
    const server = await import(pathToFileURL(join(dir, 'src/server.mjs')).href);
    const channels = await import(pathToFileURL(join(dir, 'src/channels.mjs')).href);
    return { module: 'src/server.mjs', export: 'VERSION', version: server.VERSION, channel: channels.publicChannelId('swarm') };
  }
  return null;
}

export async function runPlugin(name) {
  const dir = join(pluginsRoot, name);
  const manifest = readManifest(dir);
  try {
    const row = name === 'ruflo-core'
      ? await runCore(dir, manifest)
      : name === 'ruflo-cost-tracker'
        ? await runCostTracker(dir, manifest)
        : await runRegister(dir, manifest);
    const service = await exerciseService(name, dir);
    if (service) row.result = { ...row.result, service };
    return row;
  } catch (err) {
    if (process.env.PLUGIN_CATALOG_STACK === '1' && err instanceof Error) {
      process.stderr.write(`${err.stack}\n`);
    }
    const error = err instanceof Error ? err.message : String(err);
    return {
      plugin: manifest.name,
      version: manifest.version,
      module: name === 'ruflo-core' ? 'scripts/ruflo-hook.cjs' : name === 'ruflo-cost-tracker' ? 'scripts/track.mjs' : 'hooks/register.ts',
      export: name === 'ruflo-core' ? 'precompact-auto' : name === 'ruflo-cost-tracker' ? 'main' : 'register',
      ok: false,
      error: error.split('\n')[0],
    };
  }
}

const requested = process.argv[2];
if (requested && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = requested === '--all' ? catalogNames() : [requested];
  let failed = 0;
  for (const name of names) {
    const row = await runPlugin(name);
    process.stdout.write(`${JSON.stringify(row)}\n`);
    if (!row.ok) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}
