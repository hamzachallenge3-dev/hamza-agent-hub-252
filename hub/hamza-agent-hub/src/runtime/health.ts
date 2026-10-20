/**
 * One status report for the components the operator console was guessing at:
 * the hub, the AI engine, Agent Reach, and Browser-Box.
 */
import { browserBoxStatus, idleBrowserBoxStatus, type BrowserBoxStatus } from '../browser/box.js';
import { initializeEngine, type EngineStatus } from '../model/engine.js';
import { agentReachStatus, type AgentReachStatus } from '../packs/tools13/agent-reach.js';
import { listAgents } from './registry.js';

export interface HubHealthReport {
  service: 'hamza-agent-hub';
  ok: boolean;
  components: {
    hub: { state: 'connected'; agents: number };
    ai_engine: EngineStatus;
    agent_reach: AgentReachStatus;
    browser_box: BrowserBoxStatus;
  };
}

export async function collectHealth(timeoutMs = 1500): Promise<HubHealthReport> {
  const engine = await initializeEngine(timeoutMs);
  const current = browserBoxStatus();
  const box = current.connected || current.attempt > 0 ? current : await idleBrowserBoxStatus();
  const reach = agentReachStatus();
  const agents = listAgents().length;
  return {
    service: 'hamza-agent-hub',
    ok: engine.ready && reach.enabled && box.connected,
    components: {
      hub: { state: 'connected', agents },
      ai_engine: engine,
      agent_reach: reach,
      browser_box: box,
    },
  };
}
