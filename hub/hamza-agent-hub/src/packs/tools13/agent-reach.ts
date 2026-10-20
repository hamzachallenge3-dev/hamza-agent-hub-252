/**
 * Agent Reach enablement.
 *
 * The tool was hard-coded as not enabled, so a present dependency never turned
 * it on. It is enabled by default when at least one dependency exists, and an
 * explicit HAH_AGENT_REACH=0 turns it off. Missing pieces are reported by name.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface AgentReachDependency {
  name: string;
  present: boolean;
}

export interface AgentReachStatus {
  id: 'agent-reach';
  state: 'enabled' | 'not_enabled';
  enabled: boolean;
  reason: string;
  /** Config names or the CLI name. Never a path that contains a secret, never a value. */
  missing: string[];
  dependencies: AgentReachDependency[];
}

function explicitBinPresent(): boolean {
  const bin = (process.env.HAH_AGENT_REACH_BIN || '').trim();
  if (!bin) return false;
  try {
    return fs.existsSync(bin) && fs.statSync(bin).isFile();
  } catch {
    return false;
  }
}

function cliOnPath(): boolean {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return paths.some((dir) => {
    try {
      return fs.existsSync(path.join(dir, 'agent-reach'));
    } catch {
      return false;
    }
  });
}

/** The in-repo public web channel. No credential is required for this channel. */
export function publicWebChannelAvailable(): boolean {
  return process.env.HAH_AGENT_REACH_PUBLIC_WEB !== '0';
}

export function agentReachDependencies(): AgentReachDependency[] {
  const cli = explicitBinPresent() || cliOnPath();
  return [
    { name: 'public_web', present: publicWebChannelAvailable() },
    { name: 'agent-reach', present: cli },
    { name: 'HAH_AGENT_REACH_BIN', present: explicitBinPresent() },
  ];
}

export function agentReachStatus(): AgentReachStatus {
  const dependencies = agentReachDependencies();
  const forcedOff = process.env.HAH_AGENT_REACH === '0';
  const present = dependencies.filter((dep) => dep.present);
  const missing = dependencies.filter((dep) => !dep.present).map((dep) => dep.name);

  if (forcedOff) {
    return {
      id: 'agent-reach',
      state: 'not_enabled',
      enabled: false,
      reason: 'Agent Reach not enabled: HAH_AGENT_REACH is 0',
      missing: [],
      dependencies,
    };
  }

  if (present.length === 0) {
    return {
      id: 'agent-reach',
      state: 'not_enabled',
      enabled: false,
      reason: `Agent Reach not enabled: missing ${missing.join(', ')}`,
      missing,
      dependencies,
    };
  }

  const channels = present.map((dep) => dep.name).join(', ');
  return {
    id: 'agent-reach',
    state: 'enabled',
    enabled: true,
    reason: `Agent Reach enabled: ${channels}`,
    missing: [],
    dependencies,
  };
}
