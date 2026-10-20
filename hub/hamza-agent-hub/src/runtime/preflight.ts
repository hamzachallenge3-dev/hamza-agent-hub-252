/**
 * Dispatch preflight.
 *
 * Tasks that need the AI engine or Browser-Box used to start anyway and could
 * later be marked completed. Preflight runs before any step and refuses the
 * dispatch, with the missing config name or the connection state, when the
 * required component is not ready.
 */
import { ensureBrowserBox, type BrowserBoxStatus } from '../browser/box.js';
import { engineGap, type EngineGap } from '../model/engine.js';
import { profileFor } from './capabilities.js';
import { getAgent } from './registry.js';

/** Tools that do real work without a live model. Workspace inspection is not one of them. */
const DETERMINISTIC_TOOLS = new Set([
  'clean_leads',
  'extract_contacts',
  'sheets_to_json',
  'seo_audit_html',
  'forge_detect',
  'github_url_tricks',
  'agent_mining_queries',
  'n8n_workflow_validate',
  'context_compact',
  'html_extract_links',
  'film_pack_prepare',
  'dispatch_agent',
  'hub_full_roster',
  'hub_agent_browse',
  'hub_list_agents',
  'hub_list_packs',
  'hub_tools13_lookup',
  'hub_tools13_capabilities',
]);

const BROWSER_TASK = /\b(browser-box|taaft)\b/i;
const VIDEO_TASK = /generate (a |the )?video/i;

export interface PreflightReport {
  ok: boolean;
  component: 'ai-engine' | 'browser-box' | null;
  reason: string | null;
  missing: string[];
  required: { engine: boolean; browser: boolean };
}

export function dispatchNeeds(agentId: string, task: string): { engine: boolean; browser: boolean } {
  const agent = getAgent(agentId);
  const profile = agent ? profileFor(agent.id) : null;
  const deterministic = Boolean(agent?.tools.some((tool) => DETERMINISTIC_TOOLS.has(tool)));
  const engine = Boolean(profile?.requires_model) && !deterministic;
  const browser = Boolean(profile?.capabilities.includes('browser.automate'))
    || Boolean(agent?.tools.some((tool) => tool.startsWith('browser_')))
    || BROWSER_TASK.test(task)
    || VIDEO_TASK.test(task);
  return { engine, browser };
}

export async function preflightDispatch(input: { agentId: string; task: string }): Promise<PreflightReport> {
  const required = dispatchNeeds(input.agentId, input.task);
  const gap: EngineGap = engineGap();
  if (required.engine && !gap.configured) {
    return {
      ok: false,
      component: 'ai-engine',
      reason: gap.error ?? 'AI engine not ready',
      missing: [...gap.missing_config, ...gap.missing_keys],
      required,
    };
  }
  if (required.browser) {
    const box: BrowserBoxStatus = await ensureBrowserBox({ maxAttempts: 3 });
    if (!box.connected) {
      return {
        ok: false,
        component: 'browser-box',
        reason: box.reason,
        missing: box.missing,
        required,
      };
    }
  }
  return { ok: true, component: null, reason: null, missing: [], required };
}
