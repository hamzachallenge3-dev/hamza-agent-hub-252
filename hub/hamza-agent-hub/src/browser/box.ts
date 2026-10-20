/**
 * Browser-Box connection supervisor.
 *
 * A dropped browser used to stay stopped. This keeps one connection, and on
 * failure retries with exponential backoff until it is back or the attempt
 * budget is spent. Status text names config, never a URL or credential.
 */
import { browserAvailability, type PwBrowser } from './session.js';

export type BrowserBoxState = 'connected' | 'reconnecting' | 'stopped';

export interface BrowserBoxStatus {
  component: 'browser-box';
  state: BrowserBoxState;
  connected: boolean;
  attempt: number;
  next_retry_ms: number | null;
  last_error: string | null;
  reason: string;
  missing: string[];
}

export type BrowserBoxProbe = () => Promise<{ ok: boolean; error?: string }>;

const stopped = (reason: string, extra: Partial<BrowserBoxStatus> = {}): BrowserBoxStatus => ({
  component: 'browser-box',
  state: 'stopped',
  connected: false,
  attempt: 0,
  next_retry_ms: null,
  last_error: null,
  reason,
  missing: [],
  ...extra,
});

let status: BrowserBoxStatus = stopped('Browser-Box connection stopped');
let probeImpl: BrowserBoxProbe | null = null;
let sleepImpl: ((ms: number) => Promise<void>) | null = null;
let chain: Promise<BrowserBoxStatus> | null = null;
let timer: NodeJS.Timeout | null = null;
let localBrowser: PwBrowser | null = null;

/** 200ms, 400ms, 800ms, … capped at 30s. Attempt is 1-based. */
export function backoffDelay(attempt: number): number {
  const step = Math.max(1, attempt);
  return Math.min(30_000, 200 * 2 ** (step - 1));
}

function sleep(ms: number): Promise<void> {
  if (sleepImpl) return sleepImpl(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setBrowserBoxProbe(probe: BrowserBoxProbe | null): void {
  probeImpl = probe;
}

export function setBrowserBoxSleep(fn: ((ms: number) => Promise<void>) | null): void {
  sleepImpl = fn;
}

export function resetBrowserBox(): void {
  if (timer) clearInterval(timer);
  timer = null;
  probeImpl = null;
  sleepImpl = null;
  chain = null;
  status = stopped('Browser-Box connection stopped');
  const browser = localBrowser;
  localBrowser = null;
  if (browser) void browser.close().catch(() => undefined);
}

export function browserBoxStatus(): BrowserBoxStatus {
  return { ...status, missing: [...status.missing] };
}

async function defaultProbe(): Promise<{ ok: boolean; error?: string }> {
  const remote = (process.env.HAH_BROWSER_BOX_URL || '').trim();
  if (remote) {
    try {
      const res = await fetch(remote, { redirect: 'error', signal: AbortSignal.timeout(2_000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  }
  const availability = await browserAvailability(true);
  if (!availability.available) return { ok: false, error: availability.reason };
  try {
    if (localBrowser?.isConnected()) return { ok: true };
    const pw = (await import('playwright')) as unknown as {
      chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser> };
    };
    localBrowser = await pw.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    return { ok: localBrowser.isConnected() };
  } catch (err) {
    localBrowser = null;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.slice(0, 160) };
  }
}

function applyFailure(attempt: number, error: string, willRetry: boolean): void {
  const delay = willRetry ? backoffDelay(attempt) : null;
  status = {
    component: 'browser-box',
    state: willRetry ? 'reconnecting' : 'stopped',
    connected: false,
    attempt,
    next_retry_ms: delay,
    last_error: error.slice(0, 200),
    reason: willRetry
      ? `Browser-Box reconnecting: ${error.slice(0, 160)}`
      : `Browser-Box connection stopped: ${error.slice(0, 160)}`,
    missing: (process.env.HAH_BROWSER_BOX_URL || '').trim() ? [] : ['HAH_BROWSER_BOX_URL'],
  };
}

async function connect(maxAttempts: number): Promise<BrowserBoxStatus> {
  const probe = probeImpl ?? defaultProbe;
  const attempts = Math.max(1, Math.min(maxAttempts, 8));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let outcome: { ok: boolean; error?: string };
    try {
      outcome = await probe();
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (outcome.ok) {
      status = {
        component: 'browser-box',
        state: 'connected',
        connected: true,
        attempt,
        next_retry_ms: null,
        last_error: null,
        reason: 'Browser-Box connected',
        missing: [],
      };
      return browserBoxStatus();
    }
    const error = outcome.error || 'unreachable';
    const willRetry = attempt < attempts;
    applyFailure(attempt, error, willRetry);
    if (willRetry) await sleep(backoffDelay(attempt));
  }
  return browserBoxStatus();
}

/** Connect or reconnect. Overlapping calls share one attempt sequence. */
export function ensureBrowserBox(opts?: { maxAttempts?: number }): Promise<BrowserBoxStatus> {
  if (chain) return chain;
  chain = connect(opts?.maxAttempts ?? 3).finally(() => {
    chain = null;
  });
  return chain;
}

/** Background keepalive. A dropped connection is retried with backoff. */
export function startBrowserBox(intervalMs = 15_000): void {
  if (timer) return;
  void ensureBrowserBox({ maxAttempts: 3 });
  timer = setInterval(() => {
    void ensureBrowserBox({ maxAttempts: 3 });
  }, intervalMs);
  timer.unref?.();
}

/**
 * Status for a process that has not tried to connect yet. Does not open a
 * browser or a network connection.
 */
export async function idleBrowserBoxStatus(): Promise<BrowserBoxStatus> {
  if (status.connected || status.attempt > 0) return browserBoxStatus();
  const remote = (process.env.HAH_BROWSER_BOX_URL || '').trim();
  if (remote) return stopped('Browser-Box connection stopped');
  const availability = await browserAvailability();
  if (!availability.available) {
    return stopped(`Browser-Box connection stopped: ${availability.reason}`, {
      last_error: availability.reason,
      missing: ['HAH_BROWSER_BOX_URL'],
    });
  }
  return stopped('Browser-Box connection stopped');
}
