/**
 * Root-cause fixes for the operator status check:
 * named engine gaps, Agent Reach enablement, Browser-Box retry,
 * truthful task status, dispatch preflight, and one status report.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  ensureBrowserBox,
  resetBrowserBox,
  setBrowserBoxProbe,
  setBrowserBoxSleep,
} from '../src/browser/box.js';
import { engineGap, initializeEngine, resetEngineCache } from '../src/model/engine.js';
import { agentReachStatus } from '../src/packs/tools13/agent-reach.js';
import { enqueueAgentTask, startQueue, stopQueue } from '../src/runtime/queue.js';
import { dispatchNeeds, preflightDispatch } from '../src/runtime/preflight.js';
import { collectHealth } from '../src/runtime/health.js';
import { gradeRun } from '../src/runtime/verification.js';
import { STATE_TO_LEGACY } from '../src/runtime/states.js';
import { closeDb, getTask } from '../src/storage/db.js';

const SECRET = 'synthetic-openrouter-key-value';
let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'hah-health-'));
  vi.stubEnv('HAH_DB_PATH', path.join(base, 'db.sqlite'));
  vi.stubEnv('HAH_WORKSPACES_DIR', path.join(base, 'workspaces'));
  vi.stubEnv('HAH_DATA_DIR', path.join(base, 'data'));
  vi.stubEnv('HAH_AUTO_FREELLMAPI', '0');
  vi.stubEnv('HAH_MODEL_URL', '');
  vi.stubEnv('HAH_MODEL_PROVIDER', '');
  vi.stubEnv('HAH_FREELLMAPI_URL', '');
  vi.stubEnv('HAH_OLLAMA_URL', '');
  vi.stubEnv('HAH_OPENROUTER_URL', '');
  vi.stubEnv('HAH_OPENROUTER_KEY', '');
  vi.stubEnv('OPENROUTER_API_KEY', '');
  vi.stubEnv('HAH_HF_URL', '');
  vi.stubEnv('HAH_HF_TOKEN', '');
  vi.stubEnv('HUGGINGFACEHUB_API_TOKEN', '');
  vi.stubEnv('HAH_MODEL_API_KEY', '');
  vi.stubEnv('HAH_BROWSER_BOX_URL', '');
  vi.stubEnv('HAH_AGENT_REACH', '');
  vi.stubEnv('HAH_AGENT_REACH_PUBLIC_WEB', '1');
  vi.stubEnv('HAH_AGENT_REACH_BIN', '');
  fs.mkdirSync(path.join(base, 'data'), { recursive: true });
  resetEngineCache();
  resetBrowserBox();
});

afterEach(async () => {
  await stopQueue();
  closeDb();
  resetBrowserBox();
  resetEngineCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

async function until(id: string, status: string) {
  for (let i = 0; i < 200; i++) {
    if (getTask(id)?.status === status) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(getTask(id)?.status).toBe(status);
}

describe('AI engine names the missing piece', () => {
  it('says which config names are absent and includes no secret values', () => {
    const gap = engineGap();
    expect(gap.configured).toBe(false);
    expect(gap.error).toMatch(/missing config/);
    expect(gap.missing_config).toEqual(
      expect.arrayContaining(['HAH_MODEL_URL', 'HAH_OLLAMA_URL', 'HAH_OPENROUTER_URL', 'HAH_HF_URL'])
    );
    expect(gap.missing_keys).toEqual([]);
    expect(JSON.stringify(gap)).not.toContain(SECRET);
  });

  it('says which key names are absent when a provider is selected without a key', () => {
    vi.stubEnv('HAH_MODEL_PROVIDER', 'openrouter');
    const gap = engineGap();
    expect(gap.configured).toBe(false);
    expect(gap.error).toMatch(/missing key/);
    expect(gap.missing_keys).toEqual(expect.arrayContaining(['HAH_OPENROUTER_KEY', 'OPENROUTER_API_KEY']));
    expect(JSON.stringify(gap)).not.toContain(SECRET);
  });

  it('treats a present key as configured and does not echo the value when the provider is down', async () => {
    vi.stubEnv('HAH_MODEL_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', SECRET);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`gateway down ${SECRET}`)));
    const status = await initializeEngine(200, true);
    expect(status.configured).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.state).toBe('not_ready');
    expect(status.error).toMatch(/unreachable/);
    expect(status.error).toMatch(/openrouter_free/);
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });
});

describe('Agent Reach is enableable', () => {
  it('is enabled by default when the public web channel exists', () => {
    const status = agentReachStatus();
    expect(status.enabled).toBe(true);
    expect(status.state).toBe('enabled');
    expect(status.reason).toMatch(/public_web/);
    expect(status.missing).toEqual([]);
  });

  it('stays off when HAH_AGENT_REACH is 0, and names what is missing when nothing is present', () => {
    vi.stubEnv('HAH_AGENT_REACH', '0');
    const forced = agentReachStatus();
    expect(forced.enabled).toBe(false);
    expect(forced.state).toBe('not_enabled');
    expect(forced.reason).toMatch(/HAH_AGENT_REACH/);

    vi.stubEnv('HAH_AGENT_REACH', '');
    vi.stubEnv('HAH_AGENT_REACH_PUBLIC_WEB', '0');
    vi.stubEnv('PATH', base);
    const absent = agentReachStatus();
    expect(absent.enabled).toBe(false);
    expect(absent.reason).toMatch(/missing/);
    expect(absent.missing).toEqual(expect.arrayContaining(['public_web', 'agent-reach', 'HAH_AGENT_REACH_BIN']));
  });
});

describe('Browser-Box retries with backoff', () => {
  it('waits 200ms then 400ms and reconnects after dropped attempts', async () => {
    expect(backoffDelay(1)).toBe(200);
    expect(backoffDelay(2)).toBe(400);
    expect(backoffDelay(20)).toBe(30_000);
    const delays: number[] = [];
    let attempts = 0;
    setBrowserBoxSleep(async (ms) => {
      delays.push(ms);
    });
    setBrowserBoxProbe(async () => {
      attempts += 1;
      if (attempts < 3) return { ok: false, error: 'connection dropped' };
      return { ok: true };
    });
    const connected = await ensureBrowserBox({ maxAttempts: 3 });
    expect(connected.connected).toBe(true);
    expect(connected.state).toBe('connected');
    expect(connected.reason).toBe('Browser-Box connected');
    expect(delays).toEqual([200, 400]);
    expect(JSON.stringify(connected)).not.toContain('http');
  });

  it('stops after the attempt budget and can be brought back on the next try', async () => {
    setBrowserBoxSleep(async () => undefined);
    setBrowserBoxProbe(async () => ({ ok: false, error: 'connection dropped' }));
    const stopped = await ensureBrowserBox({ maxAttempts: 3 });
    expect(stopped.connected).toBe(false);
    expect(stopped.state).toBe('stopped');
    expect(stopped.attempt).toBe(3);
    expect(stopped.reason).toMatch(/connection stopped/);
    expect(stopped.missing).toContain('HAH_BROWSER_BOX_URL');

    setBrowserBoxProbe(async () => ({ ok: true }));
    const again = await ensureBrowserBox({ maxAttempts: 1 });
    expect(again.connected).toBe(true);
    expect(again.state).toBe('connected');
  });
});

describe('task status stays truthful', () => {
  it('does not complete a run whose step failed or reported BLOCKED', () => {
    const failed = gradeRun({
      evidence: ['tool:workspace_write:fail'],
      toolLog: [
        { tool: 'clean_leads', ok: true, output: '{"count":1}' },
        { tool: 'workspace_write', ok: false, output: 'disk full' },
      ],
      artifacts: [],
      output: 'done',
      scaffoldOnly: true,
    });
    expect(failed.state).toBe('FAILED');
    expect(failed.verified).toBe(false);
    expect(STATE_TO_LEGACY[failed.state]).toBe('failed');

    const blocked = gradeRun({
      evidence: ['model:heuristic:step0'],
      toolLog: [{ tool: 'hub_tools13_lookup', ok: true, output: '{"status":"BLOCKED"}' }],
      artifacts: [],
      output: '{"status":"BLOCKED","reason":"upstream unavailable"}',
      scaffoldOnly: true,
    });
    expect(blocked.state).toBe('BLOCKED');
    expect(STATE_TO_LEGACY[blocked.state]).toBe('failed');
    expect(STATE_TO_LEGACY[blocked.state]).not.toBe('completed');
  });
});

describe('preflight refuses dispatch', () => {
  it('requires the engine for a reasoning agent and the browser for a video task', () => {
    expect(dispatchNeeds('ecc-planner', 'plan the release')).toEqual({ engine: true, browser: false });
    expect(dispatchNeeds('desk-lead-cleaner', 'clean these leads')).toEqual({ engine: false, browser: false });
    expect(dispatchNeeds('desk-lead-cleaner', 'generate a video on TAAFT').browser).toBe(true);
  });

  it('marks a reasoning task failed and BLOCKED, naming the missing config', async () => {
    startQueue();
    const { task_id } = enqueueAgentTask({
      agent_id: 'ecc-planner',
      task: 'plan the release',
      workspace_id: 'preflight',
      idempotency_key: 'preflight-engine',
    });
    await until(task_id, 'failed');
    const task = getTask(task_id)!;
    expect(task.state).toBe('BLOCKED');
    expect(task.status).not.toBe('completed');
    expect(task.error).toMatch(/missing config/);
    expect(task.error).toMatch(/HAH_MODEL_URL/);
    expect(JSON.parse(task.output!).status).toBe('BLOCKED');
    expect(JSON.parse(task.output!).missing).toContain('HAH_MODEL_URL');
  });

  it('still completes deterministic work, and refuses a browser task when the box is down', async () => {
    setBrowserBoxSleep(async () => undefined);
    setBrowserBoxProbe(async () => ({ ok: false, error: 'connection dropped' }));
    startQueue();
    const clean = enqueueAgentTask({
      agent_id: 'desk-lead-cleaner',
      task: 'clean a@example.com and a@example.com',
      workspace_id: 'preflight',
      idempotency_key: 'preflight-clean',
    });
    await until(clean.task_id, 'completed');
    expect(getTask(clean.task_id)?.state).toMatch(/^COMPLETED_/);

    const video = enqueueAgentTask({
      agent_id: 'desk-lead-cleaner',
      task: 'generate a video on TAAFT',
      workspace_id: 'preflight',
      idempotency_key: 'preflight-video',
    });
    await until(video.task_id, 'failed');
    const refused = getTask(video.task_id)!;
    expect(refused.state).toBe('BLOCKED');
    expect(refused.status).not.toBe('completed');
    expect(refused.error).toMatch(/connection stopped/);
    expect(JSON.parse(refused.output!).component).toBe('browser-box');
  });

  it('allows a browser task through once the box is connected', async () => {
    setBrowserBoxProbe(async () => ({ ok: true }));
    const report = await preflightDispatch({ agentId: 'desk-lead-cleaner', task: 'generate a video on TAAFT' });
    expect(report.ok).toBe(true);
    expect(report.required.browser).toBe(true);
  });
});

describe('one status report', () => {
  it('reports the four components from the same facts dispatch uses', async () => {
    const report = await collectHealth(200);
    expect(report.service).toBe('hamza-agent-hub');
    expect(report.ok).toBe(false);
    expect(report.components.hub.state).toBe('connected');
    expect(report.components.hub.agents).toBeGreaterThan(90);
    expect(report.components.ai_engine.ready).toBe(false);
    expect(report.components.ai_engine.error).toBe(engineGap().error);
    expect(report.components.agent_reach.enabled).toBe(agentReachStatus().enabled);
    expect(report.components.browser_box.connected).toBe(false);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('prints that report from the status command', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, HAH_AGENT_REACH_PUBLIC_WEB: '1', HAH_AUTO_FREELLMAPI: '0' };
    for (const key of [
      'HAH_MODEL_URL', 'HAH_MODEL_PROVIDER', 'HAH_FREELLMAPI_URL', 'HAH_OLLAMA_URL',
      'HAH_OPENROUTER_URL', 'HAH_HF_URL', 'HAH_OPENROUTER_KEY', 'OPENROUTER_API_KEY',
      'HAH_HF_TOKEN', 'HUGGINGFACEHUB_API_TOKEN', 'HAH_MODEL_API_KEY', 'HAH_BROWSER_BOX_URL',
      'HAH_AGENT_REACH', 'HAH_AGENT_REACH_BIN', 'HAH_USE_FREELLMAPI',
    ]) {
      env[key] = '';
    }
    const result = spawnSync(
      process.execPath,
      ['--experimental-sqlite', '--import', 'tsx', 'src/index.ts', 'status'],
      { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env, encoding: 'utf8', timeout: 20_000 }
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      components: {
        hub: { state: string; agents: number };
        ai_engine: { ready: boolean; error: string };
        agent_reach: { enabled: boolean };
        browser_box: { connected: boolean };
      };
    };
    expect(report.ok).toBe(false);
    expect(report.components.hub.state).toBe('connected');
    expect(report.components.hub.agents).toBeGreaterThan(90);
    expect(report.components.ai_engine.ready).toBe(false);
    expect(report.components.ai_engine.error).toMatch(/HAH_MODEL_URL/);
    expect(report.components.agent_reach.enabled).toBe(true);
    expect(report.components.browser_box.connected).toBe(false);
    expect(result.stdout).not.toContain(SECRET);
  });
});
