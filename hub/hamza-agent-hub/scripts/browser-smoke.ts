/**
 * Live browser smoke test.
 *
 * Run with: npx tsx scripts/browser-smoke.ts
 *
 * Drives a real Chromium page through the same tool dispatch the agent runtime
 * uses, so the output is evidence that the browser capability works rather than
 * a claim that it should.
 */
import { runBrowserTool, releaseTaskSession } from '../src/tools/browser.js';
import { browserAvailability } from '../src/browser/session.js';

const TASK = 'smoke';
let failures = 0;

function report(label: string, ok: boolean, detail: unknown) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok || process.env.VERBOSE) console.log('      ', JSON.stringify(detail).slice(0, 600));
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await runBrowserTool(name, args, TASK);
  return { ok: result.ok, data: JSON.parse(result.output) as Record<string, unknown> };
}

async function main() {
  const availability = await browserAvailability(true);
  report('chromium available', availability.available, availability);
  if (!availability.available) {
    console.log('\nBrowser runtime is BLOCKED. Install with: npx playwright install chromium');
    process.exit(1);
  }

  const noAllow = await call('browser_session', { op: 'open' });
  report('session without allow_domains is refused', !noAllow.ok, noAllow.data);

  const open = await call('browser_session', { op: 'open', allow_domains: ['example.com'] });
  report('session opens with an allow list', open.ok, open.data);

  const offList = await call('browser_navigate', { url: 'https://wikipedia.org/' });
  report('off-allow-list host is blocked', !offList.ok, offList.data.reason);

  const loopback = await call('browser_navigate', { url: 'http://127.0.0.1:8080/' });
  report('loopback address is blocked', !loopback.ok, loopback.data.reason);

  const metadata = await call('browser_navigate', { url: 'http://169.254.169.254/latest/meta-data/' });
  report('cloud metadata address is blocked', !metadata.ok, metadata.data.reason);

  const fileUrl = await call('browser_navigate', { url: 'file:///etc/passwd' });
  report('file: scheme is blocked', !fileUrl.ok, fileUrl.data.reason);

  const nav = await call('browser_navigate', { url: 'https://example.com/' });
  report('navigates to an allowed page', nav.ok, nav.data);

  const snap = await call('browser_snapshot', {});
  const snapshot = snap.data.data as { title?: string; text?: string; elements?: unknown[] } | undefined;
  report('snapshot returns a title', Boolean(snapshot?.title), snapshot?.title);
  report('page text is wrapped as untrusted', Boolean(snapshot?.text?.includes('<untrusted-web-content')), snapshot?.text?.slice(0, 120));
  report('snapshot lists interactive elements', (snapshot?.elements?.length ?? 0) > 0, snapshot?.elements);

  const links = await call('browser_extract', { kind: 'links' });
  report('extracts links', links.ok, links.data.data);

  const text = await call('browser_extract', { kind: 'text' });
  report('extracts page text', JSON.stringify(text.data.data).includes('documentation examples'), text.data.data);

  // Matching nothing is a real answer, but it must never read as verified.
  const empty = await call('browser_extract', { kind: 'text', selector: '#nope' });
  report('empty extraction is reported unverified', empty.ok && empty.data.verified === false, empty.data.reason);

  const shot = await call('browser_screenshot', {});
  report('captures a screenshot file', shot.ok, shot.data.data);

  // A click on something that does not exist must fail, not be reported as done.
  const badClick = await call('browser_act', { action: 'click', selector: '#definitely-not-here', expect_text: 'Submitted' });
  report('unconfirmed click is not reported as success', !badClick.ok && badClick.data.verified === false, badClick.data.reason);

  const diag = await call('browser_session', { op: 'diagnostics' });
  report('diagnostics include the audit trail', diag.ok, diag.data);

  await releaseTaskSession(TASK);
  const afterClose = await call('browser_navigate', { url: 'https://example.com/' });
  report('session is gone after release', !afterClose.ok, afterClose.data.reason);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
