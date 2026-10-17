/**
 * Browser tool dispatch for queued agents.
 *
 * The MCP surface and the agent runtime share one implementation so a mission
 * run by `hub-web-browser` behaves exactly like the same calls made by a client.
 * Sessions are keyed per task, so two concurrent missions cannot steer each
 * other's page.
 */
import {
  closeSession,
  createSession,
  getSession,
  listSessions,
  browserAvailability,
  type BrowserSession,
} from '../browser/session.js';
import {
  click,
  extract,
  navigate,
  press,
  screenshot,
  scrollToBottom,
  selectOption,
  sessionDiagnostics,
  snapshot,
  type as typeText,
  uploadFile,
  type ActOptions,
  type Target,
} from '../browser/actions.js';
import { redactSecrets } from '../security/redact.js';

export const BROWSER_AGENT_TOOLS = [
  'browser_session',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'browser_extract',
  'browser_screenshot',
];

/** task id → session id. One page per mission keeps sessions isolated. */
const taskSessions = new Map<string, string>();

function sessionForTask(taskId: string): BrowserSession | null {
  const id = taskSessions.get(taskId);
  if (!id) return null;
  const session = getSession(id);
  if (!session) {
    taskSessions.delete(taskId);
    return null;
  }
  return session;
}

export async function releaseTaskSession(taskId: string): Promise<void> {
  const id = taskSessions.get(taskId);
  if (!id) return;
  taskSessions.delete(taskId);
  await closeSession(id);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined;
}

function target(args: Record<string, unknown>): Target {
  return {
    selector: str(args.selector),
    role: str(args.role),
    name: str(args.name),
    label: str(args.label),
    placeholder: str(args.placeholder),
    text: str(args.text),
  };
}

function actOptions(args: Record<string, unknown>): ActOptions {
  return {
    expectText: str(args.expect_text),
    expectSelector: str(args.expect_selector),
    timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
  };
}

function fail(name: string, message: string) {
  return { ok: false, name, output: redactSecrets({ ok: false, verified: false, reason: message }) };
}

export async function runBrowserTool(
  name: string,
  args: Record<string, unknown>,
  taskId: string
): Promise<{ ok: boolean; name: string; output: string }> {
  if (name === 'browser_session') {
    const op = String(args.op ?? 'status');
    if (op === 'status') {
      const availability = await browserAvailability();
      return { ok: true, name, output: redactSecrets({ ...availability, open_sessions: listSessions().length }) };
    }
    if (op === 'open') {
      const domains = Array.isArray(args.allow_domains) ? args.allow_domains.map(String) : [];
      if (!domains.length) {
        return fail(name, 'allow_domains is required: a session with no allow list can reach nothing');
      }
      await releaseTaskSession(taskId);
      try {
        const session = await createSession({
          profile: str(args.profile),
          policy: {
            allowDomains: domains,
            denyDomains: Array.isArray(args.deny_domains) ? args.deny_domains.map(String) : undefined,
            allowActions: Array.isArray(args.allow_actions) ? (args.allow_actions.map(String) as never) : undefined,
            allowDownloads: typeof args.allow_downloads === 'boolean' ? args.allow_downloads : undefined,
            allowUploads: typeof args.allow_uploads === 'boolean' ? args.allow_uploads : undefined,
          },
        });
        taskSessions.set(taskId, session.id);
        return { ok: true, name, output: redactSecrets({ session_id: session.id, policy: session.policy }) };
      } catch (err) {
        // A missing Chromium is reported as BLOCKED with the install command,
        // never as a visited page.
        return fail(name, err instanceof Error ? err.message : String(err));
      }
    }
    if (op === 'close') {
      await releaseTaskSession(taskId);
      return { ok: true, name, output: redactSecrets({ closed: true }) };
    }
    if (op === 'diagnostics') {
      const session = sessionForTask(taskId);
      if (!session) return fail(name, 'no open browser session for this task');
      return { ok: true, name, output: redactSecrets(sessionDiagnostics(session)) };
    }
    return fail(name, `unsupported op: ${op}`);
  }

  const session = sessionForTask(taskId);
  if (!session) {
    return fail(name, 'no open browser session: call browser_session with op="open" and an allow_domains list first');
  }

  try {
    switch (name) {
      case 'browser_navigate': {
        const url = str(args.url);
        if (!url) return fail(name, 'url is required');
        const result = await navigate(session, url, {
          waitFor: str(args.wait_for),
          timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
        });
        return { ok: result.ok, name, output: redactSecrets(result) };
      }
      case 'browser_snapshot': {
        const result = await snapshot(session);
        return { ok: result.ok, name, output: redactSecrets(result) };
      }
      case 'browser_act': {
        const action = String(args.action ?? 'click');
        const opts = actOptions(args);
        const value = str(args.value);
        let result;
        switch (action) {
          case 'click':
            result = await click(session, target(args), opts);
            break;
          case 'type':
            if (value === undefined) return fail(name, 'value is required for type');
            result = await typeText(session, target(args), value, opts);
            break;
          case 'select':
            if (value === undefined) return fail(name, 'value is required for select');
            result = await selectOption(session, target(args), value, opts);
            break;
          case 'press':
            if (!value) return fail(name, 'value (key name) is required for press');
            result = await press(session, value, opts);
            break;
          case 'scroll':
            result = await scrollToBottom(session, typeof args.rounds === 'number' ? args.rounds : 3);
            break;
          case 'upload':
            if (!value) return fail(name, 'value (workspace file path) is required for upload');
            result = await uploadFile(session, target(args), value);
            break;
          default:
            return fail(name, `unsupported action: ${action}`);
        }
        return { ok: result.ok, name, output: redactSecrets(result) };
      }
      case 'browser_extract': {
        const kind = String(args.kind ?? 'text');
        if (!['text', 'links', 'table', 'attributes'].includes(kind)) {
          return fail(name, `unsupported extract kind: ${kind}`);
        }
        const result = await extract(session, kind as 'text', {
          selector: str(args.selector),
          attribute: str(args.attribute),
        });
        return { ok: result.ok, name, output: redactSecrets(result) };
      }
      case 'browser_screenshot': {
        const result = await screenshot(session, args.full_page === true);
        return { ok: result.ok, name, output: redactSecrets(result) };
      }
      default:
        return fail(name, `unknown browser tool: ${name}`);
    }
  } catch (err) {
    return fail(name, err instanceof Error ? err.message : String(err));
  }
}
