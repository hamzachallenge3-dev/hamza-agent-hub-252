/**
 * Hub calls Ruflo's local planner, coder, and tester.
 * The handoff writes spec.json, is-even.mjs, and report.json.
 */
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../config.js';
import { integrationError, type Integration } from './types.js';

export async function callRufloAgent(input: { workDir?: string; role?: string } = {}) {
  const workDir = input.workDir || mkdtempSync(path.join(tmpdir(), 'hub-ruflo-'));
  const bridge = path.resolve(ROOT, '../../scripts/swarm/hub-bridge.mjs');
  const mod = await import(pathToFileURL(bridge).href) as {
    hubCallRufloAgent: (args: { repoRoot: string; workDir: string; role?: string }) => Promise<unknown>;
  };
  return mod.hubCallRufloAgent({
    repoRoot: path.resolve(ROOT, '../..'),
    workDir,
    role: input.role,
  });
}

export function rufloIntegration(): Integration {
  const integration: Integration = {
    id: 'automation.ruflo',
    label: 'Ruflo swarm agents',
    category: 'automation',
    provider: {
      name: 'Ruflo',
      homepage: 'https://github.com/ruvnet/ruflo',
      docs: 'scripts/swarm/handoff.mjs',
    },
    auth: { kind: 'none', env: [], hint: 'Local Ruflo agents. No credential.' },
    capabilities: ['swarm.handoff'],
    operations: [
      {
        id: 'run',
        description: 'Run the Ruflo planner, coder, and tester handoff',
        input: { workDir: 'string', role: 'string' },
        output: { receipt: 'object' },
        scopes: ['local'],
        mutating: false,
        requiresApproval: false,
      },
    ],
    limits: { requestsPerMinute: null, requestsPerDay: null, onExceeded: 'local workers only' },
    cost: { paid: false, freeTier: 'Local workers. No model call.' },
    configured: () => true,
    async health() {
      return {
        id: integration.id,
        configured: true,
        ok: true,
        readiness: 'READY',
        latency_ms: 0,
        detail: 'local handoff',
      };
    },
    async call(operation, input) {
      if (operation !== 'run') {
        throw integrationError(integration.id, operation, 'bad_request', `unknown operation ${operation}`, 'Use: run.');
      }
      return callRufloAgent({
        workDir: input.workDir ? String(input.workDir) : undefined,
        role: input.role ? String(input.role) : undefined,
      });
    },
  };
  return integration;
}
