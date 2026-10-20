/**
 * Tool smoke checks.
 *
 * The catalog shipped with `tested: true` on three agents and `false` on the
 * other ninety, and nothing anywhere actually exercised a tool. A flag in a
 * JSON file is not evidence, so verification is derived here instead: every
 * tool the Hub exposes either has an executable check with a real fixture and a
 * real assertion, or is declared external with the dependency that blocks it.
 *
 * A check runs the tool through the same `runTool` dispatch an agent uses, so
 * passing here means the agent path works, not that a mock works.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTool } from './runner.js';
import { MCP_SURFACE_TOOLS, SANDBOX_MCP_TOOLS } from '../runtime/browse.js';

export interface SmokeCheck {
  tool: string;
  /** Arguments that exercise the tool for real, not a no-op. */
  args: Record<string, unknown>;
  /** Returns null when the output proves the tool worked, else the reason it did not. */
  assert: (output: unknown, ok: boolean) => string | null;
  /** Set when the check needs a writable workspace fixture. */
  fixture?: (root: string) => void;
}

/**
 * Tools that cannot be smoke-tested without something this environment does not
 * have. Each names the exact blocker rather than being quietly skipped.
 */
export const EXTERNAL_TOOLS: Record<string, string> = {
  hub_edge_health: 'requires the deployed Cloudflare edge; no network call is made from tests',
  // These three are registered on the MCP server only and are not part of the
  // agent tool dispatch, so `runTool` cannot reach them. Each is exercised
  // against its underlying function elsewhere rather than left unchecked.
  hub_health: 'MCP-server surface only; the same payload is asserted by the /health/live contract test',
  hub_boss_route: 'MCP-server surface only; planWithBoss routing is asserted across the regression and hub suites',
  hub_agent_audit: 'MCP-server surface only; auditAgents and auditSummary are asserted by the agent audit tests in this suite',
  hub_freellmapi_chat: 'requires a reachable FreeLLMAPI gateway; currently BLOCKED',
  run_agent: 'enqueues background work; covered by the queue and contract suites instead',
  task_status: 'reads a live task; covered by the queue and contract suites instead',
  task_result: 'reads a live task; covered by the queue and contract suites instead',
  cancel_task: 'mutates a live task; covered by the queue and contract suites instead',
  dispatch_agent: 'spawns a child task; covered by the orchestration suite instead',
  run_command: 'sandboxed shell, authenticated HTTP path only; covered by the sandbox suite',
  film_pack_prepare: 'requires ffmpeg/ffprobe and a workspace video file',
  browser_session: 'live Chromium; covered by scripts/browser-smoke.ts',
  browser_navigate: 'live Chromium; covered by scripts/browser-smoke.ts',
  browser_snapshot: 'live Chromium; covered by scripts/browser-smoke.ts',
  browser_act: 'live Chromium; covered by scripts/browser-smoke.ts',
  browser_extract: 'live Chromium; covered by scripts/browser-smoke.ts',
  browser_screenshot: 'live Chromium; covered by scripts/browser-smoke.ts',
};

function obj(output: unknown): Record<string, unknown> {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as Record<string, unknown>;
    } catch {
      return { _text: output };
    }
  }
  return (output ?? {}) as Record<string, unknown>;
}

function text(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output ?? '');
}

export const SMOKE_CHECKS: SmokeCheck[] = [
  {
    tool: 'hub_tools13_capabilities',
    args: {},
    assert: (output) => {
      const rows = obj(output) as unknown as Array<{ id: string; status: string }>;
      if (!Array.isArray(rows) || rows.length !== 13) return `expected 13 Tools13 rows, got ${Array.isArray(rows) ? rows.length : 'none'}`;
      if (!rows.every((r) => r.status === 'BLOCKED' || r.status === 'LOCAL_ALTERNATIVE' || r.status === 'ENABLED' || r.status === 'NOT_ENABLED')) return 'a Tools13 row claimed a status outside the honest vocabulary';
      return null;
    },
  },
  {
    tool: 'n8n_workflow_validate',
    args: {
      workflow: {
        nodes: [
          { name: 'Start', type: 'n8n-nodes-base.start' },
          { name: 'Shell', type: 'n8n-nodes-base.executeCommand' },
        ],
        connections: { Start: {} },
        active: true,
      },
    },
    assert: (output) => {
      const r = obj(output);
      if (r.executed !== false) return 'validation must never execute a workflow';
      if (!Array.isArray(r.warnings) || !(r.warnings as string[]).some((w) => /executeCommand|external\/code/i.test(w))) {
        return 'a shell node did not raise a review warning';
      }
      if (!(r.warnings as string[]).some((w) => /never activates/i.test(w))) return 'an active workflow was not flagged';
      return null;
    },
  },
  {
    tool: 'context_compact',
    args: { text: ['keep', 'keep', 'FATAL: disk full', 'noise'].join('\n'), max_lines: 10 },
    assert: (output) => {
      const r = obj(output);
      const lines = String(r.text ?? '').split('\n');
      if (lines[0] !== 'FATAL: disk full') return 'error evidence was not promoted ahead of ordinary context';
      if (lines.filter((l) => l === 'keep').length !== 1) return 'duplicate lines were not collapsed';
      return null;
    },
  },
  {
    tool: 'html_extract_links',
    args: { html: '<a href="https://example.com/a">a</a><a href="https://example.com/a">dup</a><a href="javascript:evil()">x</a>' },
    assert: (output) => {
      const r = obj(output);
      const links = (r.links ?? []) as string[];
      if (r.fetched !== false) return 'extraction must not fetch anything';
      if (links.length !== 1 || links[0] !== 'https://example.com/a') return `expected one deduplicated safe link, got ${JSON.stringify(links)}`;
      return null;
    },
  },
  {
    tool: 'hub_list_packs',
    args: {},
    assert: (output) => (/ecc68/.test(text(output)) ? null : 'pack listing did not include ecc68'),
  },
  {
    tool: 'hub_list_agents',
    args: { pack: 'desk' },
    assert: (output) => (/desk-lead-cleaner/.test(text(output)) ? null : 'desk pack listing did not include desk-lead-cleaner'),
  },
  {
    tool: 'hub_full_roster',
    args: {},
    assert: (output) => (/hub-boss/.test(text(output)) ? null : 'roster did not include the Boss'),
  },
  {
    tool: 'hub_agent_browse',
    args: { query: 'browser', limit: 10 },
    assert: (output) => {
      const body = text(output);
      if (!/hub-web-browser/.test(body)) return 'a browser search did not surface the web automation agent';
      return null;
    },
  },
  {
    tool: 'hub_freellmapi_status',
    args: {},
    assert: (output) => {
      const body = text(output);
      if (/"readiness"\s*:\s*"ready"/.test(body)) return 'claimed a ready gateway with none configured';
      return null;
    },
  },
  {
    tool: 'hub_tools13_lookup',
    args: { id: 'scrapling' },
    assert: (output) => (/scrapling/.test(text(output)) ? null : 'lookup did not return the requested tool'),
  },
  {
    tool: 'hub_integrations',
    args: {},
    assert: (output) => {
      const body = text(output);
      if (!/model\.freellmapi/.test(body)) return 'integration report omitted the model adapters';
      if (/"(value|secret|api_key)"\s*:\s*"[^"]/.test(body)) return 'integration report leaked a credential value';
      return null;
    },
  },
  {
    tool: 'web_search',
    args: { query: 'hamza agent hub smoke probe' },
    assert: (output, ok) => {
      const r = obj(output);
      // No search credential is configured in tests. The honest outcome is a
      // refusal naming the credential, never an invented result list.
      if (ok) return null;
      if (!String(r.setup_hint ?? '').length) return 'a blocked search did not name the credential to configure';
      if (Array.isArray(r.results) && (r.results as unknown[]).length) return 'a blocked search returned fabricated results';
      return null;
    },
  },
  {
    tool: 'clean_leads',
    args: {
      text: 'Contact AMAL@Example.com and sami@example.com',
      csv: 'email\namal@example.com\n',
    },
    assert: (output) => {
      const r = obj(output);
      const emails = (r.emails ?? []) as string[];
      // The same address in two cases is one lead, and the count must say so.
      if (emails.length !== 2) return `expected 2 unique emails, got ${JSON.stringify(emails)}`;
      if (!emails.includes('amal@example.com')) return 'case normalisation did not produce a lowercase address';
      if (r.duplicates_removed !== 1) return `expected 1 duplicate removed, got ${String(r.duplicates_removed)}`;
      return null;
    },
  },
  {
    tool: 'sheets_to_json',
    args: { csv: 'name,email\nAmal,amal@example.com\nSami,sami@example.com' },
    assert: (output) => {
      const r = obj(output);
      const rows = (r.rows ?? r.records ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length !== 2) return `expected 2 parsed rows, got ${Array.isArray(rows) ? rows.length : 'none'}`;
      if (rows[0].email !== 'amal@example.com') return 'header mapping did not produce the expected field';
      return null;
    },
  },
  {
    tool: 'extract_contacts',
    args: {
      html: '<p>Amal &mdash; amal@example.com</p><a href="https://github.com/hamzaloukili">gh</a>',
      url: 'https://example.com/team',
    },
    assert: (output) => {
      const r = obj(output);
      const emails = (r.emails ?? []) as string[];
      const social = (r.social ?? []) as string[];
      if (!emails.includes('amal@example.com')) return `a valid email was not extracted: ${JSON.stringify(emails)}`;
      if (!social.some((s) => /github\.com/.test(s))) return 'a social profile link was not extracted';
      if (r.source_url !== 'https://example.com/team') return 'the source URL was not carried through';
      return null;
    },
  },
  {
    tool: 'seo_audit_html',
    args: { html: '<html><head></head><body><img src="a.png"><h2>sub</h2></body></html>' },
    assert: (output) => {
      const body = text(output);
      // A page with no title, no h1 and an image with no alt must raise findings.
      if (!/title|h1|alt/i.test(body)) return 'an obviously deficient page produced no SEO findings';
      return null;
    },
  },
  {
    tool: 'forge_detect',
    args: { url: 'https://github.com/hamzaloukili/agent-core' },
    assert: (output) => (/github/i.test(text(output)) ? null : 'forge detection did not identify GitHub'),
  },
  {
    tool: 'github_url_tricks',
    args: { url: 'https://github.com/hamzaloukili/agent-core' },
    assert: (output) => (/raw|api|codeload|archive/i.test(text(output)) ? null : 'no alternate GitHub URL forms were produced'),
  },
  {
    // Takes no arguments: it returns a fixed set of discovery queries.
    tool: 'agent_mining_queries',
    args: {},
    assert: (output) => {
      const r = obj(output);
      for (const group of ['skills', 'agents', 'mcp', 'tools']) {
        const queries = r[group] as string[] | undefined;
        if (!Array.isArray(queries) || !queries.length) return `no ${group} discovery queries were returned`;
      }
      return null;
    },
  },
  {
    tool: 'workspace_write',
    args: { path: 'smoke/note.txt', content: 'hamza hub smoke' },
    assert: (_output, ok) => (ok ? null : 'workspace write failed'),
  },
  {
    tool: 'workspace_list',
    args: { path: '.' },
    fixture: (root) => fs.writeFileSync(path.join(root, 'listed.txt'), 'x'),
    assert: (output) => (/listed\.txt/.test(text(output)) ? null : 'a file present on disk was not listed'),
  },
  {
    tool: 'workspace_read',
    args: { path: 'readable.txt' },
    fixture: (root) => fs.writeFileSync(path.join(root, 'readable.txt'), 'content under audit'),
    assert: (output) => (/content under audit/.test(text(output)) ? null : 'file content was not returned'),
  },
  {
    tool: 'workspace_grep',
    args: { pattern: 'needle', path: '.' },
    fixture: (root) => fs.writeFileSync(path.join(root, 'hay.txt'), 'a needle in here'),
    assert: (output) => (/hay\.txt/.test(text(output)) ? null : 'grep did not find a known match'),
  },
  {
    tool: 'workspace_stat',
    args: { path: 'measured.txt' },
    fixture: (root) => fs.writeFileSync(path.join(root, 'measured.txt'), '0123456789'),
    assert: (output) => {
      const r = obj(output);
      if (r.type !== 'file') return `expected a file, got ${String(r.type)}`;
      if (r.size_bytes !== 10) return `expected 10 bytes, got ${String(r.size_bytes)}`;
      return null;
    },
  },
  {
    tool: 'workspace_mkdir',
    args: { path: 'made/nested' },
    assert: (_output, ok) => (ok ? null : 'directory creation failed'),
  },
  {
    tool: 'list_specialists',
    args: {},
    assert: (output) => {
      const body = text(output);
      if (!/ecc-security-reviewer/.test(body)) return 'the specialist directory omitted a known reviewer';
      // The directory is for choosing a delegate; it must not hand out tool grants.
      if (/workspace_write/.test(body)) return 'the specialist directory leaked tool grants';
      return null;
    },
  },
];

export interface SmokeResult {
  tool: string;
  ok: boolean;
  detail: string;
  ms: number;
}

/** Runs one check in a throwaway workspace. */
export async function runSmokeCheck(check: SmokeCheck): Promise<SmokeResult> {
  const started = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-smoke-'));
  try {
    check.fixture?.(root);
    const result = await runTool([check.tool], root, { name: check.tool, arguments: check.args });
    const reason = check.assert(result.output, result.ok);
    return { tool: check.tool, ok: reason === null, detail: reason ?? 'verified', ms: Date.now() - started };
  } catch (err) {
    return { tool: check.tool, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

let executed: Map<string, SmokeResult> | null = null;

export async function runAllSmokeChecks(): Promise<SmokeResult[]> {
  const out: SmokeResult[] = [];
  for (const check of SMOKE_CHECKS) out.push(await runSmokeCheck(check));
  executed = new Map(out.map((r) => [r.tool, r]));
  return out;
}

/**
 * Results of the last full run, or null if nothing has been executed yet.
 *
 * Readiness classification has to be synchronous, so it can only use measured
 * evidence once something has actually run. Exposing the cache rather than
 * blocking keeps the honest ordering: declared until measured, never the
 * reverse.
 */
export function executedSmokeResults(): Map<string, SmokeResult> | null {
  return executed;
}

export function resetExecutedSmokeResults(): void {
  executed = null;
}

export function smokeCheckedTools(): string[] {
  return SMOKE_CHECKS.map((c) => c.tool).sort();
}

/**
 * Every tool the Hub exposes anywhere, so nothing can be silently uncovered.
 * Includes the tools agents are granted but which are not on the MCP surface.
 */
export function allExposedTools(): string[] {
  const workspace = ['workspace_read', 'workspace_write', 'workspace_list', 'workspace_grep', 'workspace_stat', 'workspace_mkdir'];
  const extra = ['dispatch_agent', 'film_pack_prepare', 'list_specialists'];
  return [...new Set([...MCP_SURFACE_TOOLS, ...SANDBOX_MCP_TOOLS, ...workspace, ...extra])].sort();
}
