/**
 * Browser actions.
 *
 * Every mutating action returns a verdict, not just "no exception thrown".
 * A click that Playwright accepted but that changed nothing on the page is
 * reported as unverified, so a caller can never present it as a completed
 * submission.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyAction } from '../runtime/verification.js';
import {
  checkAction,
  checkDownload,
  checkUrl,
  detectChallenge,
  scanForInjection,
  wrapUntrusted,
  NON_IDEMPOTENT_ACTIONS,
  type BrowserAction,
  type PolicyDecision,
} from './policy.js';
import {
  audit,
  browserDataDir,
  healthCheck,
  tabCount,
  withLock,
  type BrowserSession,
  type PwLocator,
  type PwPage,
} from './session.js';

export interface ActionResult {
  ok: boolean;
  verified: boolean;
  action: BrowserAction;
  url: string;
  reason: string;
  data?: unknown;
  /** Written whenever an action fails, so failures are inspectable. */
  screenshot?: string | null;
  challenge?: { kind: string; evidence: string } | null;
  injection?: { suspicious: boolean; matches: string[] } | null;
  /**
   * Set when the policy requires a human to authorise this action. The action
   * has NOT run. The caller must park the task and obtain approval.
   */
  needs_approval?: { action: BrowserAction; describe: string; reason: string } | null;
}

/**
 * The policy can mark an action as allowed-but-requiring-approval. That verdict
 * used to be computed and then ignored, because callers only tested
 * `decision.allowed`, so an upload configured to need sign-off ran anyway.
 * Every mutating entry point funnels through here instead.
 */
function approvalGate(action: BrowserAction, describe: string, decision: PolicyDecision, url: string): ActionResult | null {
  if (!decision.requiresApproval) return null;
  return {
    ok: false,
    verified: false,
    action,
    url,
    reason: decision.reason,
    needs_approval: { action, describe, reason: decision.reason },
  };
}

function screenshotDir(): string {
  const dir = path.join(browserDataDir(), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function captureFailure(session: BrowserSession, label: string): Promise<string | null> {
  try {
    const file = path.join(screenshotDir(), `${session.id}-${Date.now()}-${label}.png`);
    const buf = await session.page.screenshot({ type: 'png', fullPage: false });
    fs.writeFileSync(file, buf);
    return file;
  } catch {
    return null;
  }
}

/** Stop the workflow rather than attempting to defeat a human-verification wall. */
async function guardChallenge(session: BrowserSession): Promise<ActionResult | null> {
  let text = '';
  try {
    text = await session.page.evaluate<string>('document.body ? document.body.innerText : ""');
  } catch {
    return null;
  }
  const challenge = detectChallenge(text);
  if (!challenge.found) return null;
  session.halted_reason = `${challenge.kind}: ${challenge.evidence}`;
  audit(session, 'navigate', `halted on ${challenge.kind}`, false, challenge.evidence);
  return {
    ok: false,
    verified: false,
    action: 'navigate',
    url: session.page.url(),
    reason: `stopped for human participation: ${challenge.kind} challenge detected ("${challenge.evidence}"). The Hub does not solve or bypass these.`,
    challenge: { kind: challenge.kind!, evidence: challenge.evidence! },
    screenshot: await captureFailure(session, 'challenge'),
  };
}

export async function navigate(
  session: BrowserSession,
  rawUrl: string,
  opts: { waitFor?: string; timeoutMs?: number } = {}
): Promise<ActionResult> {
  const decision = checkAction('navigate', session.policy);
  if (!decision.allowed) {
    return { ok: false, verified: false, action: 'navigate', url: '', reason: decision.reason };
  }
  const check = await checkUrl(rawUrl, session.policy);
  if (!check.ok) {
    audit(session, 'navigate', 'blocked', false, check.reason);
    return { ok: false, verified: false, action: 'navigate', url: rawUrl, reason: check.reason! };
  }

  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) {
      return { ok: false, verified: false, action: 'navigate' as const, url: rawUrl, reason: health.detail };
    }
    try {
      await session.page.goto(check.url!, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(opts.timeoutMs ?? 30_000, 60_000),
      });
      if (opts.waitFor) {
        await session.page.waitForSelector(opts.waitFor, { timeout: Math.min(opts.timeoutMs ?? 15_000, 60_000) });
      }
      session.action_count += 1;

      const challenge = await guardChallenge(session);
      if (challenge) return challenge;

      const landed = session.page.url();
      // A redirect can leave the allow list; re-check where we actually ended up.
      const after = await checkUrl(landed, session.policy);
      if (!after.ok) {
        await session.page.goto('about:blank').catch(() => undefined);
        audit(session, 'navigate', 'redirect left allow list', false, after.reason);
        return {
          ok: false,
          verified: false,
          action: 'navigate' as const,
          url: landed,
          reason: `navigation redirected to a disallowed host: ${after.reason}`,
        };
      }
      const title = await session.page.title();
      audit(session, 'navigate', 'ok', true, landed);
      return {
        ok: true,
        verified: true,
        action: 'navigate' as const,
        url: landed,
        reason: `loaded (${title.slice(0, 80)})`,
        data: { title },
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      audit(session, 'navigate', 'failed', false, reason);
      return {
        ok: false,
        verified: false,
        action: 'navigate' as const,
        url: rawUrl,
        reason: `navigation failed: ${reason.slice(0, 300)}`,
        screenshot: await captureFailure(session, 'navigate'),
      };
    }
  });
}

/** Prefer stable semantic selectors over brittle positions. */
export function resolveLocator(page: PwPage, target: { role?: string; name?: string; label?: string; placeholder?: string; text?: string; selector?: string }): PwLocator {
  if (target.selector) return page.locator(target.selector).first();
  if (target.role) return page.getByRole(target.role, target.name ? { name: target.name } : undefined).first();
  if (target.label) return page.getByLabel(target.label).first();
  if (target.placeholder) return page.getByPlaceholder(target.placeholder).first();
  if (target.text) return page.getByText(target.text, { exact: false }).first();
  throw new Error('target needs one of: role+name, label, placeholder, text, selector');
}

export interface Target {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  selector?: string;
}

/** Fingerprint used to tell whether an action actually changed the page. */
async function pageFingerprint(page: PwPage): Promise<string> {
  try {
    return await page.evaluate<string>(
      '(() => { const b = document.body; return [location.href, document.title, b ? b.innerText.length : 0, b ? b.innerHTML.length : 0].join("|"); })()'
    );
  } catch {
    return `err-${Date.now()}`;
  }
}

export interface ActOptions {
  /** Text the caller expects to see if the action truly succeeded. */
  expectText?: string;
  /** Selector the caller expects to appear. */
  expectSelector?: string;
  timeoutMs?: number;
}

async function checkExpectation(page: PwPage, opts: ActOptions): Promise<boolean | null> {
  const timeout = Math.min(opts.timeoutMs ?? 8_000, 30_000);
  if (opts.expectSelector) {
    try {
      await page.waitForSelector(opts.expectSelector, { timeout });
      return true;
    } catch {
      return false;
    }
  }
  if (opts.expectText) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => undefined);
      const text = await page.evaluate<string>('document.body ? document.body.innerText : ""');
      return text.toLowerCase().includes(opts.expectText.toLowerCase());
    } catch {
      return false;
    }
  }
  return null;
}

async function mutate(
  session: BrowserSession,
  action: Extract<BrowserAction, 'click' | 'type' | 'select' | 'press'>,
  run: (page: PwPage) => Promise<void>,
  describe: string,
  opts: ActOptions
): Promise<ActionResult> {
  const decision = checkAction(action, session.policy);
  if (!decision.allowed) {
    return { ok: false, verified: false, action, url: '', reason: decision.reason };
  }
  const gated = approvalGate(action, describe, decision, session.page.url());
  if (gated) {
    audit(session, action, 'needs_approval', false, decision.reason);
    return gated;
  }
  if (session.halted_reason) {
    return {
      ok: false,
      verified: false,
      action,
      url: session.page.url(),
      reason: `session halted and needs human participation: ${session.halted_reason}`,
    };
  }

  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) return { ok: false, verified: false, action, url: '', reason: health.detail };

    const before = await pageFingerprint(session.page);
    try {
      await run(session.page);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      audit(session, action, 'failed', false, reason);
      return {
        ok: false,
        verified: false,
        action,
        url: session.page.url(),
        reason: `${describe} failed: ${reason.slice(0, 300)}`,
        screenshot: await captureFailure(session, action),
      };
    }
    session.action_count += 1;

    const challenge = await guardChallenge(session);
    if (challenge) return { ...challenge, action };

    const expectationMet = await checkExpectation(session.page, opts);
    const after = await pageFingerprint(session.page);
    const verdict = verifyAction({
      action: describe,
      domChanged: before !== after,
      expectation: opts.expectSelector ?? opts.expectText ?? null,
      expectationMet,
    });
    audit(session, action, verdict.reason, verdict.ok);
    return {
      ok: verdict.ok,
      verified: verdict.verified,
      action,
      url: session.page.url(),
      reason: verdict.reason,
      screenshot: verdict.ok ? null : await captureFailure(session, action),
    };
  });
}

export function click(session: BrowserSession, target: Target, opts: ActOptions = {}): Promise<ActionResult> {
  return mutate(
    session,
    'click',
    async (page) => {
      const loc = resolveLocator(page, target);
      await loc.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      await loc.click({ timeout: Math.min(opts.timeoutMs ?? 10_000, 30_000) });
    },
    `click ${describeTarget(target)}`,
    opts
  );
}

export function type(
  session: BrowserSession,
  target: Target,
  value: string,
  opts: ActOptions = {}
): Promise<ActionResult> {
  return mutate(
    session,
    'type',
    async (page) => {
      const loc = resolveLocator(page, target);
      await loc.fill(value, { timeout: Math.min(opts.timeoutMs ?? 10_000, 30_000) });
    },
    `type into ${describeTarget(target)}`,
    opts
  );
}

export function selectOption(
  session: BrowserSession,
  target: Target,
  value: string,
  opts: ActOptions = {}
): Promise<ActionResult> {
  return mutate(
    session,
    'select',
    async (page) => {
      const loc = resolveLocator(page, target);
      await loc.selectOption(value, { timeout: Math.min(opts.timeoutMs ?? 10_000, 30_000) });
    },
    `select ${value} in ${describeTarget(target)}`,
    opts
  );
}

export function press(session: BrowserSession, key: string, opts: ActOptions = {}): Promise<ActionResult> {
  return mutate(session, 'press', async (page) => page.keyboard.press(key), `press ${key}`, opts);
}

function describeTarget(t: Target): string {
  return t.selector ?? (t.role ? `${t.role}"${t.name ?? ''}"` : t.label ?? t.placeholder ?? t.text ?? 'target');
}

export interface Snapshot {
  url: string;
  title: string;
  /** Accessibility-style list of interactive elements with stable refs. */
  elements: Array<{ ref: string; role: string; name: string; selector: string; visible: boolean }>;
  text: string;
  injection: { suspicious: boolean; matches: string[] };
}

const SNAPSHOT_SCRIPT = `(() => {
  const out = [];
  const nodes = document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [onclick]');
  let i = 0;
  for (const el of nodes) {
    if (i >= 120) break;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.innerText || el.value || '').trim().slice(0, 80);
    let selector = '';
    if (el.id) selector = '#' + CSS.escape(el.id);
    else if (el.getAttribute('name')) selector = el.tagName.toLowerCase() + '[name="' + el.getAttribute('name').replace(/"/g, '') + '"]';
    else if (el.getAttribute('data-testid')) selector = '[data-testid="' + el.getAttribute('data-testid').replace(/"/g, '') + '"]';
    out.push({ ref: 'e' + (++i), role: role, name: name, selector: selector, visible: visible });
  }
  return JSON.stringify({ title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 20000), elements: out });
})()`;

export async function snapshot(session: BrowserSession): Promise<ActionResult> {
  const decision = checkAction('snapshot', session.policy);
  if (!decision.allowed) return { ok: false, verified: false, action: 'snapshot', url: '', reason: decision.reason };
  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) return { ok: false, verified: false, action: 'snapshot' as const, url: '', reason: health.detail };
    try {
      const raw = await session.page.evaluate<string>(SNAPSHOT_SCRIPT);
      const parsed = JSON.parse(raw) as { title: string; text: string; elements: Snapshot['elements'] };
      const injection = scanForInjection(parsed.text);
      const url = session.page.url();
      const host = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return 'unknown';
        }
      })();
      session.action_count += 1;
      audit(session, 'snapshot', 'ok', true, `${parsed.elements.length} elements`);
      const data: Snapshot = {
        url,
        title: parsed.title,
        elements: parsed.elements,
        // Page text is data, never instructions.
        text: wrapUntrusted(host, parsed.text),
        injection,
      };
      return { ok: true, verified: true, action: 'snapshot' as const, url, reason: 'snapshot taken', data, injection };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        verified: false,
        action: 'snapshot' as const,
        url: session.page.url(),
        reason: `snapshot failed: ${reason.slice(0, 300)}`,
        screenshot: await captureFailure(session, 'snapshot'),
      };
    }
  });
}

export type ExtractKind = 'text' | 'links' | 'table' | 'attributes';

export async function extract(
  session: BrowserSession,
  kind: ExtractKind,
  opts: { selector?: string; attribute?: string } = {}
): Promise<ActionResult> {
  const decision = checkAction('extract', session.policy);
  if (!decision.allowed) return { ok: false, verified: false, action: 'extract', url: '', reason: decision.reason };
  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) return { ok: false, verified: false, action: 'extract' as const, url: '', reason: health.detail };
    const selector = (opts.selector || '').replace(/`/g, '');
    const attribute = (opts.attribute || 'href').replace(/[^a-zA-Z0-9_:-]/g, '');
    let script: string;
    switch (kind) {
      case 'links':
        script = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector || 'a[href]')})].slice(0,300).map(a=>({text:(a.innerText||'').trim().slice(0,120),href:a.href})))`;
        break;
      case 'table':
        script = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector || 'table')})].slice(0,10).map(t=>[...t.querySelectorAll('tr')].slice(0,200).map(r=>[...r.querySelectorAll('th,td')].map(c=>(c.innerText||'').trim().slice(0,200)))))`;
        break;
      case 'attributes':
        script = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector || '*[' + attribute + ']')})].slice(0,300).map(e=>e.getAttribute(${JSON.stringify(attribute)})))`;
        break;
      case 'text':
      default:
        script = selector
          ? `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].slice(0,200).map(e=>(e.innerText||'').trim().slice(0,2000)))`
          : `JSON.stringify([(document.body?document.body.innerText:'').slice(0,20000)])`;
    }
    try {
      const raw = await session.page.evaluate<string>(script);
      const parsed = JSON.parse(raw) as unknown;
      const count = Array.isArray(parsed) ? parsed.length : 0;
      session.action_count += 1;
      audit(session, 'extract', `${kind} ok`, true, `${count} item(s)`);
      return {
        ok: true,
        // Extracting zero rows is a real answer, but it is not evidence the
        // caller's expectation was met.
        verified: count > 0,
        action: 'extract' as const,
        url: session.page.url(),
        reason: count > 0 ? `extracted ${count} ${kind} item(s)` : `selector matched nothing for ${kind}`,
        data: parsed,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        verified: false,
        action: 'extract' as const,
        url: session.page.url(),
        reason: `extract failed: ${reason.slice(0, 300)}`,
        screenshot: await captureFailure(session, 'extract'),
      };
    }
  });
}

export async function screenshot(session: BrowserSession, fullPage = false): Promise<ActionResult> {
  const decision = checkAction('screenshot', session.policy);
  if (!decision.allowed) return { ok: false, verified: false, action: 'screenshot', url: '', reason: decision.reason };
  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) return { ok: false, verified: false, action: 'screenshot' as const, url: '', reason: health.detail };
    try {
      const file = path.join(screenshotDir(), `${session.id}-${Date.now()}.png`);
      const buf = await session.page.screenshot({ type: 'png', fullPage });
      fs.writeFileSync(file, buf);
      session.action_count += 1;
      audit(session, 'screenshot', 'ok', true, file);
      return {
        ok: true,
        verified: true,
        action: 'screenshot' as const,
        url: session.page.url(),
        reason: 'screenshot saved',
        data: { path: file, bytes: buf.length },
      };
    } catch (err) {
      return {
        ok: false,
        verified: false,
        action: 'screenshot' as const,
        url: session.page.url(),
        reason: `screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}

/** Scroll for infinite-scroll pages; reports whether new content actually loaded. */
export async function scrollToBottom(session: BrowserSession, rounds = 3): Promise<ActionResult> {
  const decision = checkAction('scroll', session.policy);
  if (!decision.allowed) return { ok: false, verified: false, action: 'scroll', url: '', reason: decision.reason };
  return withLock(session, async () => {
    const health = await healthCheck(session);
    if (!health.healthy) return { ok: false, verified: false, action: 'scroll' as const, url: '', reason: health.detail };
    let grew = false;
    let last = 0;
    for (let i = 0; i < Math.min(Math.max(rounds, 1), 20); i++) {
      const height = await session.page.evaluate<number>('document.body ? document.body.scrollHeight : 0');
      await session.page.evaluate<void>('window.scrollTo(0, document.body.scrollHeight)');
      await session.page.waitForTimeout(1200);
      const next = await session.page.evaluate<number>('document.body ? document.body.scrollHeight : 0');
      if (next > height) grew = true;
      last = next;
    }
    session.action_count += 1;
    audit(session, 'scroll', grew ? 'loaded more' : 'no growth', true);
    return {
      ok: true,
      verified: grew,
      action: 'scroll' as const,
      url: session.page.url(),
      reason: grew ? `page grew to ${last}px after scrolling` : 'scrolled but no new content loaded',
      data: { height: last, grew },
    };
  });
}

export async function uploadFile(
  session: BrowserSession,
  target: Target,
  absolutePath: string,
  opts: ActOptions = {}
): Promise<ActionResult> {
  const decision = checkAction('upload', session.policy);
  if (!decision.allowed) return { ok: false, verified: false, action: 'upload', url: '', reason: decision.reason };
  // Upload is approval-gated by default. It then runs through the `click`
  // pipeline for verification, and `click` is not approval-gated, so the gate
  // has to be applied to the upload verdict here or it is lost entirely.
  const gated = approvalGate('upload', `upload ${path.basename(absolutePath)}`, decision, session.page.url());
  if (gated) {
    audit(session, 'upload', 'needs_approval', false, decision.reason);
    return gated;
  }
  if (!fs.existsSync(absolutePath)) {
    return { ok: false, verified: false, action: 'upload', url: '', reason: `file not found: ${absolutePath}` };
  }
  return mutate(
    session,
    'click',
    async (page) => {
      const loc = resolveLocator(page, target);
      await loc.setInputFiles(absolutePath, { timeout: Math.min(opts.timeoutMs ?? 15_000, 60_000) });
    },
    `upload ${path.basename(absolutePath)}`,
    opts
  ).then((r) => ({ ...r, action: 'upload' as BrowserAction }));
}

export function downloadAllowed(filename: string, session: BrowserSession) {
  return checkDownload(filename, session.policy);
}

export function isRetryable(action: BrowserAction): boolean {
  return !NON_IDEMPOTENT_ACTIONS.includes(action);
}

export function sessionDiagnostics(session: BrowserSession) {
  return {
    session_id: session.id,
    tabs: tabCount(session),
    max_tabs: session.policy.maxTabs,
    actions: session.action_count,
    crashes: session.crash_count,
    halted_reason: session.halted_reason,
    audit_tail: session.audit.slice(-25),
  };
}
