/**
 * Browser session lifecycle.
 *
 * Playwright is an optional dependency: the Hub must still boot and report an
 * honest BLOCKED browser status on a host where Chromium was never installed,
 * rather than crashing at import time.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { policyFrom, type BrowserAction, type BrowserPolicyInput } from './policy.js';

/* Minimal structural types so this module compiles without @types/playwright. */
export interface PwPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  close(): Promise<void>;
  screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, opts?: Record<string, unknown>): Promise<unknown>;
  waitForLoadState(state?: string, opts?: Record<string, unknown>): Promise<void>;
  locator(selector: string): PwLocator;
  getByRole(role: string, opts?: Record<string, unknown>): PwLocator;
  getByLabel(text: string, opts?: Record<string, unknown>): PwLocator;
  getByPlaceholder(text: string, opts?: Record<string, unknown>): PwLocator;
  getByText(text: string, opts?: Record<string, unknown>): PwLocator;
  evaluate<T>(fn: string | ((...args: never[]) => T), arg?: unknown): Promise<T>;
  keyboard: { press(key: string): Promise<void> };
  mouse: { wheel(x: number, y: number): Promise<void> };
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  isClosed(): boolean;
  route(pattern: string, handler: (route: PwRoute) => unknown): Promise<void>;
  on(event: string, handler: (...args: never[]) => unknown): void;
}

export interface PwLocator {
  /** Playwright's JS API exposes this as a method, not a property getter. */
  first(): PwLocator;
  click(opts?: Record<string, unknown>): Promise<void>;
  fill(value: string, opts?: Record<string, unknown>): Promise<void>;
  selectOption(value: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  textContent(opts?: Record<string, unknown>): Promise<string | null>;
  count(): Promise<number>;
  setInputFiles(files: string | string[], opts?: Record<string, unknown>): Promise<void>;
  scrollIntoViewIfNeeded(opts?: Record<string, unknown>): Promise<void>;
  isVisible(opts?: Record<string, unknown>): Promise<boolean>;
  getAttribute(name: string, opts?: Record<string, unknown>): Promise<string | null>;
}

export interface PwRoute {
  request(): { url(): string; resourceType(): string };
  abort(reason?: string): Promise<void>;
  continue(): Promise<void>;
}

export interface PwContext {
  newPage(): Promise<PwPage>;
  pages(): PwPage[];
  close(): Promise<void>;
  storageState(opts?: Record<string, unknown>): Promise<unknown>;
  route(pattern: string, handler: (route: PwRoute) => unknown): Promise<void>;
  setDefaultTimeout(ms: number): void;
  on(event: string, handler: (...args: never[]) => unknown): void;
}

export interface PwBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
  isConnected(): boolean;
  contexts(): PwContext[];
}

export interface BrowserSession {
  id: string;
  created_at: number;
  last_used_at: number;
  policy: BrowserPolicyInput;
  /** Set when a 2FA/captcha challenge stopped the workflow. */
  halted_reason: string | null;
  profile_dir: string | null;
  browser: PwBrowser;
  context: PwContext;
  page: PwPage;
  /** Serialises actions so two callers cannot drive the same tab at once. */
  lock: Promise<void>;
  action_count: number;
  crash_count: number;
  audit: AuditEntry[];
}

export interface AuditEntry {
  at: number;
  action: BrowserAction | 'session';
  url: string;
  ok: boolean;
  detail: string;
}

const sessions = new Map<string, BrowserSession>();

export interface BrowserAvailability {
  available: boolean;
  readiness: 'READY' | 'BLOCKED';
  reason: string;
  playwright_version?: string;
  executable?: string;
}

let cachedAvailability: { at: number; value: BrowserAvailability } | null = null;

async function loadPlaywright(): Promise<{ chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser>; executablePath(): string } } | null> {
  try {
    // Dynamic so a host without Playwright still runs the rest of the Hub.
    const mod = (await import('playwright')) as unknown as {
      chromium: { launch(opts?: Record<string, unknown>): Promise<PwBrowser>; executablePath(): string };
    };
    return mod;
  } catch {
    return null;
  }
}

/** Honest readiness: the package *and* a real browser binary must both exist. */
export async function browserAvailability(force = false): Promise<BrowserAvailability> {
  if (!force && cachedAvailability && Date.now() - cachedAvailability.at < 30_000) {
    return cachedAvailability.value;
  }
  let value: BrowserAvailability;
  const pw = await loadPlaywright();
  if (!pw) {
    value = {
      available: false,
      readiness: 'BLOCKED',
      reason: 'playwright is not installed; run: npm install playwright && npx playwright install chromium',
    };
  } else {
    let executable = '';
    try {
      executable = pw.chromium.executablePath();
    } catch (err) {
      executable = '';
      value = {
        available: false,
        readiness: 'BLOCKED',
        reason: `chromium executable path unavailable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (executable && fs.existsSync(executable)) {
      let version = 'unknown';
      try {
        const pkg = await import('playwright/package.json', { with: { type: 'json' } });
        version = (pkg.default as { version?: string }).version ?? 'unknown';
      } catch {
        /* version is cosmetic */
      }
      value = {
        available: true,
        readiness: 'READY',
        reason: 'chromium present',
        playwright_version: version,
        executable,
      };
    } else {
      value = {
        available: false,
        readiness: 'BLOCKED',
        reason: executable
          ? `chromium binary missing at ${executable}; run: npx playwright install chromium`
          : 'chromium binary not found; run: npx playwright install chromium',
      };
    }
  }
  cachedAvailability = { at: Date.now(), value };
  return value;
}

export function browserDataDir(): string {
  return process.env.HAH_BROWSER_DIR || path.join(config.dataDir, 'browser');
}

/**
 * Profile encryption key. Persistent login state is only as safe as this file,
 * so it is created 0600 and never returned through any tool.
 */
function profileKey(): Buffer {
  const envKey = process.env.HAH_BROWSER_PROFILE_KEY;
  if (envKey) return crypto.createHash('sha256').update(envKey).digest();
  const keyPath = path.join(browserDataDir(), 'profile.key');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32));
    fs.chmodSync(keyPath, 0o600);
  }
  return fs.readFileSync(keyPath);
}

function profilePath(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/i.test(name)) throw new Error('profile name must be 2-49 chars [a-z0-9_-]');
  return path.join(browserDataDir(), 'profiles', `${name}.enc`);
}

/** Encrypt cookies/localStorage at rest (AES-256-GCM). */
export function saveProfile(name: string, storageState: unknown): string {
  const file = profilePath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', profileKey(), iv);
  const plain = Buffer.from(JSON.stringify(storageState), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  fs.writeFileSync(file, Buffer.concat([iv, cipher.getAuthTag(), enc]));
  fs.chmodSync(file, 0o600);
  return file;
}

export function loadProfile(name: string): unknown | null {
  const file = profilePath(name);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', profileKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

export function listProfiles(): Array<{ name: string; saved_at: number }> {
  const dir = path.join(browserDataDir(), 'profiles');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.enc'))
    .map((f) => ({ name: f.replace(/\.enc$/, ''), saved_at: fs.statSync(path.join(dir, f)).mtimeMs }));
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export interface CreateSessionInput {
  policy?: Partial<BrowserPolicyInput>;
  /** Reuse a previously authorised, encrypted login profile. */
  profile?: string;
  headless?: boolean;
}

export async function createSession(input: CreateSessionInput = {}): Promise<BrowserSession> {
  const availability = await browserAvailability();
  if (!availability.available) throw new Error(`browser unavailable: ${availability.reason}`);
  const pw = await loadPlaywright();
  if (!pw) throw new Error('browser unavailable: playwright import failed');

  if (sessions.size >= maxSessions()) {
    throw new Error(`session limit reached (${maxSessions()}); close a session first`);
  }

  const policy = policyFrom(input.policy);
  const browser = await pw.chromium.launch({
    headless: input.headless !== false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });

  const storageState = input.profile ? loadProfile(input.profile) : null;
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: policy.allowDownloads,
    ...(storageState ? { storageState } : {}),
  });
  context.setDefaultTimeout(30_000);

  const id = crypto.randomUUID();
  const page = await context.newPage();

  const session: BrowserSession = {
    id,
    created_at: Date.now(),
    last_used_at: Date.now(),
    policy,
    halted_reason: null,
    profile_dir: input.profile ? profilePath(input.profile) : null,
    browser,
    context,
    page,
    lock: Promise.resolve(),
    action_count: 0,
    crash_count: 0,
    audit: [],
  };
  sessions.set(id, session);
  audit(session, 'session', 'created', true, `profile=${input.profile ?? 'none'}`);
  return session;
}

export function maxSessions(): number {
  const raw = Number.parseInt(process.env.HAH_BROWSER_MAX_SESSIONS || '3', 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 10) : 3;
}

export function getSession(id: string): BrowserSession | null {
  return sessions.get(id) ?? null;
}

export function requireSession(id: string): BrowserSession {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown browser session: ${id}`);
  return s;
}

export async function closeSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  try {
    await s.context.close();
  } catch {
    /* already gone */
  }
  try {
    await s.browser.close();
  } catch {
    /* already gone */
  }
  return true;
}

export async function closeAllSessions(): Promise<void> {
  await Promise.allSettled([...sessions.keys()].map(closeSession));
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    session_id: s.id,
    created_at: s.created_at,
    last_used_at: s.last_used_at,
    url: safeUrl(s),
    actions: s.action_count,
    crashes: s.crash_count,
    halted_reason: s.halted_reason,
    tabs: tabCount(s),
    allow_domains: s.policy.allowDomains,
    allow_actions: s.policy.allowActions,
    downloads: s.policy.allowDownloads,
    uploads: s.policy.allowUploads,
  }));
}

function safeUrl(s: BrowserSession): string {
  try {
    return s.page.isClosed() ? '(closed)' : s.page.url();
  } catch {
    return '(unavailable)';
  }
}

export function tabCount(s: BrowserSession): number {
  try {
    return s.context.pages().length;
  } catch {
    return 0;
  }
}

export function audit(
  session: BrowserSession,
  action: BrowserAction | 'session',
  detail: string,
  ok: boolean,
  extra = ''
): void {
  session.audit.push({
    at: Date.now(),
    action,
    url: safeUrl(session),
    ok,
    detail: `${detail}${extra ? ` (${extra})` : ''}`.slice(0, 400),
  });
  if (session.audit.length > 200) session.audit.splice(0, session.audit.length - 200);
}

/**
 * Health probe plus recovery. A crashed page is replaced in place so a long
 * workflow can continue instead of losing the whole session.
 */
export async function healthCheck(session: BrowserSession): Promise<{
  healthy: boolean;
  recovered: boolean;
  detail: string;
}> {
  let connected = false;
  try {
    connected = session.browser.isConnected();
  } catch {
    connected = false;
  }
  if (!connected) {
    session.crash_count += 1;
    audit(session, 'session', 'browser disconnected', false);
    return { healthy: false, recovered: false, detail: 'browser process is gone; create a new session' };
  }
  if (session.page.isClosed()) {
    try {
      session.page = await session.context.newPage();
      session.crash_count += 1;
      audit(session, 'session', 'page recovered after close', true);
      return { healthy: true, recovered: true, detail: 'page was closed and has been reopened' };
    } catch (err) {
      return {
        healthy: false,
        recovered: false,
        detail: `page recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return { healthy: true, recovered: false, detail: 'ok' };
}

/** Run `fn` with exclusive access to the session. */
export async function withLock<T>(session: BrowserSession, fn: () => Promise<T>): Promise<T> {
  const previous = session.lock;
  let release!: () => void;
  session.lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    session.last_used_at = Date.now();
    return await fn();
  } finally {
    release();
  }
}
