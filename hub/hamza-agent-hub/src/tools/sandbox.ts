/**
 * Sandbox shell execution for secret-path HTTP hubs (Kaggle/agentbox).
 * Never expose these tools on unauthenticated stdio.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64_000;
const MAX_COMMAND_CHARS = 4_000;

export function sandboxToolsEnabled(): boolean {
  if (process.env.HAH_ENABLE_SANDBOX_TOOLS === '0') return false;
  if (process.env.HAH_ENABLE_SANDBOX_TOOLS === '1') return true;
  // Secret-path HTTP only: Worker HUB_SECRET → hub.py Bearer → Node HTTP.
  return config.transport === 'http' && config.authToken.length >= 24;
}

export function sandboxUser(): string {
  const raw = (process.env.HUB_SANDBOX_USER || 'agentbox').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(raw)) {
    throw new Error('invalid HUB_SANDBOX_USER');
  }
  return raw;
}

export function sandboxWorkRoot(): string {
  const user = sandboxUser();
  const raw = process.env.HUB_SANDBOX_WORK_DIR || `/home/${user}/work`;
  const resolved = path.resolve(raw);
  if (!path.isAbsolute(resolved)) throw new Error('HUB_SANDBOX_WORK_DIR must be absolute');
  return resolved;
}

export interface SandboxRunOptions {
  command: string;
  cwd?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface SandboxRunResult {
  ok: boolean;
  exit_code: number | null;
  timed_out: boolean;
  user: string;
  cwd: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  launcher: 'direct' | 'runuser' | 'sudo';
}

function resolveWorkCwd(workRoot: string, relOrAbs?: string): string {
  fs.mkdirSync(workRoot, { recursive: true });
  const target = relOrAbs
    ? path.isAbsolute(relOrAbs)
      ? path.resolve(relOrAbs)
      : path.resolve(workRoot, relOrAbs)
    : workRoot;
  const rootReal = fs.existsSync(workRoot) ? fs.realpathSync(workRoot) : workRoot;
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const targetReal = fs.realpathSync(target);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (targetReal !== rootReal && !targetReal.startsWith(prefix)) {
    throw new Error(`cwd must stay under ${workRoot}`);
  }
  return targetReal;
}

function currentUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.LOGNAME || '';
  }
}

/**
 * Resource limits applied inside the sandbox shell.
 *
 * The timeout bounded wall-clock time and the output cap bounded what came
 * back, but nothing bounded what a command could consume while running: a
 * single `run_command` could exhaust memory, spin CPU in a tight loop under the
 * timeout, fill the disk, or fork-bomb the box. These are soft (`ulimit -S`) so
 * a command that needs more fails rather than the shell refusing to start, and
 * each is tolerated if the kernel or shell does not support it — a missing
 * limit must not turn a working command into an error.
 */
function limitPrefix(): string {
  const cpu = envLimit('HAH_SANDBOX_CPU_SECONDS', 60);
  const memoryKb = envLimit('HAH_SANDBOX_MEMORY_KB', 2_097_152);
  const fileKb = envLimit('HAH_SANDBOX_FILE_KB', 262_144);
  const procs = envLimit('HAH_SANDBOX_MAX_PROCS', 512);
  return [
    `ulimit -S -t ${cpu} 2>/dev/null`,
    `ulimit -S -v ${memoryKb} 2>/dev/null`,
    `ulimit -S -f ${fileKb} 2>/dev/null`,
    `ulimit -S -u ${procs} 2>/dev/null`,
    'ulimit -S -c 0 2>/dev/null',
    ':',
  ].join('; ');
}

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The command, preceded by the resource limits it must run under. */
export function limitedCommand(command: string): string {
  return `${limitPrefix()}\n${command}`;
}

function buildLauncher(user: string, command: string): { launcher: SandboxRunResult['launcher']; argv: string[] } {
  const limited = limitedCommand(command);
  if (currentUsername() === user || process.getuid?.() === undefined) {
    // Already the sandbox user (or platform without getuid) — run directly.
    return { launcher: 'direct', argv: ['/bin/bash', '-lc', limited] };
  }
  // Prefer runuser (util-linux); fall back to passwordless sudo.
  return {
    launcher: 'runuser',
    argv: ['/usr/sbin/runuser', '-u', user, '--', '/bin/bash', '-lc', limited],
  };
}

function truncate(buf: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(buf, 'utf8') <= MAX_OUTPUT_BYTES) return { text: buf, truncated: false };
  let out = buf;
  while (Buffer.byteLength(out, 'utf8') > MAX_OUTPUT_BYTES) out = out.slice(0, Math.floor(out.length * 0.9));
  return { text: out + '\n…[truncated]', truncated: true };
}

async function spawnCapture(
  argv: string[],
  cwd: string,
  home: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number | null; timed_out: boolean; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, HOME: home, PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timed_out = false;
    const timer = setTimeout(() => {
      timed_out = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const collect = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const next = (which === 'stdout' ? stdout : stderr) + chunk.toString('utf8');
      const cut = truncate(next);
      if (which === 'stdout') stdout = cut.text;
      else stderr = cut.text;
      truncated = truncated || cut.truncated;
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timed_out, stdout, stderr, truncated });
    });
  });
}

export async function runSandboxCommand(opts: SandboxRunOptions): Promise<SandboxRunResult> {
  if (!sandboxToolsEnabled()) {
    throw new Error('run_command is only available on authenticated HTTP (HUB_SECRET path)');
  }
  const command = String(opts.command ?? '').trim();
  if (!command) throw new Error('command required');
  if (command.length > MAX_COMMAND_CHARS) throw new Error(`command exceeds ${MAX_COMMAND_CHARS} characters`);
  if (command.includes('\0')) throw new Error('command must not contain null bytes');

  const user = sandboxUser();
  const workRoot = sandboxWorkRoot();
  const cwd = resolveWorkCwd(workRoot, opts.cwd);
  const timeoutMs = Math.min(
    Math.max(Number(opts.timeout_ms) || DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );

  const home = path.dirname(workRoot);
  let { launcher, argv } = buildLauncher(user, command);

  const toResult = (
    r: Awaited<ReturnType<typeof spawnCapture>>,
    used: SandboxRunResult['launcher'],
  ): SandboxRunResult => ({
    ok: !r.timed_out && r.code === 0,
    exit_code: r.code,
    timed_out: r.timed_out,
    user,
    cwd,
    stdout: r.stdout,
    stderr: r.stderr,
    truncated: r.truncated,
    launcher: used,
  });

  const viaSudo = async (): Promise<SandboxRunResult> => {
    const sudoArgv = ['/usr/bin/sudo', '-n', '-u', user, '--', '/bin/bash', '-lc', limitedCommand(command)];
    return toResult(await spawnCapture(sudoArgv, cwd, home, timeoutMs, opts.signal), 'sudo');
  };

  try {
    const first = await spawnCapture(argv, cwd, home, timeoutMs, opts.signal);
    const launchFail =
      launcher === 'runuser' &&
      !first.timed_out &&
      first.code !== 0 &&
      /runuser:|may not be used|Authentication failure|permission denied/i.test(
        `${first.stderr}\n${first.stdout}`,
      );
    if (launchFail) return viaSudo();
    return toResult(first, launcher);
  } catch (err) {
    if (launcher === 'runuser') {
      try {
        return await viaSudo();
      } catch (err2) {
        throw new Error(
          `sandbox launch failed (${err instanceof Error ? err.message : String(err)}; sudo: ${
            err2 instanceof Error ? err2.message : String(err2)
          })`,
        );
      }
    }
    throw err;
  }
}
