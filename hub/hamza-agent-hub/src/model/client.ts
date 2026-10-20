import { tools13Capabilities } from '../packs/tools13/offline.js';
import { planWithBoss } from '../runtime/boss.js';
import { modelTool } from './schemas.js';
import { config, modelConfigured } from '../config.js';
import {
  freellmapiChat,
  probeFreellmapi,
  freellmapiEnabled,
  freellmapiStatusSummary,
} from './freellmapi.js';
import {
  allProviders,
  availableProviders,
  callWithFallback,
  configuredProviders,
  providerHealthReport,
  recordProviderResult,
} from './providers.js';
import { SCAFFOLD_MARKER } from '../runtime/verification.js';
import { engineGap } from './engine.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{id:string;type:'function';function:{name:string;arguments:string}}>;

}

/** Full provider picture, including adapters that are not configured. */
export async function modelHealth(timeoutMs = 3000) {
  const report = await providerHealthReport(timeoutMs);
  const configured = configuredProviders().map((p) => p.id);
  const gap = engineGap();
  const unreachable = gap.configured && !report.any_live
    ? `AI engine not ready: configured provider unreachable${configured.length ? ` (${configured.join(', ')})` : ''}`
    : null;
  return {
    readiness: report.any_live ? ('ready' as const) : ('blocked' as const),
    any_live: report.any_live,
    configured_providers: configured,
    /**
     * Stated plainly so no caller mistakes the fallback for a model: when no
     * provider is live the Hub runs deterministic tools only and marks results
     * COMPLETED_LIMITED.
     */
    degraded_mode: report.any_live ? null : 'no live model: deterministic tools only, results are COMPLETED_LIMITED',
    missing_config: gap.missing_config,
    missing_keys: gap.missing_keys,
    error: report.any_live ? null : (gap.error ?? unreachable),
    providers: report.providers,
  };
}

export function modelStatus() {
  const freellmapi = freellmapiStatusSummary();
  if (!modelConfigured()) {
    return {
      configured: false,
      readiness: 'blocked' as const,
      reason:
        'No live model — set HAH_MODEL_PROVIDER=freellmapi (FreeLLMAPI OSS) or HAH_MODEL_URL; heuristic path available',
      adapters: allProviders().map((p) => ({ id: p.id, label: p.label, configured: p.configured(), free: p.free })),
      freellmapi,
      profiles: {
        glm_lab: Boolean(config.modelProfiles.glm_lab),
        headroom_lab: Boolean(config.modelProfiles.headroom_lab),
        free: Boolean(config.modelProfiles.free),
        freellmapi: Boolean(config.modelProfiles.freellmapi) || freellmapi.enabled,
      },
    };
  }
  return {
    configured: true,
    readiness: 'configured_unverified' as const,
    reason: freellmapiEnabled()
      ? 'FreeLLMAPI (open-source free gateway) configured'
      : 'OpenAI-compatible free endpoint configured',
    provider: freellmapiEnabled() ? 'freellmapi' : 'openai_compatible',
    model: config.modelName,
    base_url: '[configured endpoint]',
    adapters: allProviders().map((p) => ({ id: p.id, label: p.label, configured: p.configured(), free: p.free })),
    freellmapi,
    profiles: {
      glm_lab: Boolean(config.modelProfiles.glm_lab),
      headroom_lab: Boolean(config.modelProfiles.headroom_lab),
      free: Boolean(config.modelProfiles.free),
      freellmapi: freellmapi.enabled,
    },
  };
}

export interface ModelCallResult {
  content: string;
  tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  provider: string;
  routed_via?: string | null;
  model?: string;
  /**
   * True when no live model produced this turn. The executor uses it to grade
   * the run COMPLETED_LIMITED instead of claiming verified analysis.
   */
  degraded: boolean;
  /** Why the live path was not used, for the task event log. */
  degraded_reason?: string;
  attempts?: Array<{ provider: string; ok: boolean; error?: string; ms: number }>;
}

/** Raised when every configured provider failed; the queue retries, then dead-letters. */
export class ModelUnavailableError extends Error {
  readonly attempts: Array<{ provider: string; ok: boolean; error?: string; ms: number }>;
  constructor(message: string, attempts: ModelUnavailableError['attempts']) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.attempts = attempts;
  }
}

export async function callModel(opts: {
  system: string;
  messages: ModelMessage[];
  tools: string[];
  agentId: string;
  signal?: AbortSignal;
}): Promise<ModelCallResult> {
  const configured = configuredProviders();

  if (configured.length) {
    // A tripped breaker must not downgrade the run to a scaffold: when every
    // provider is breaker-open we retry them anyway (half-open) and let the
    // failure surface as a failure.
    const usable = availableProviders();
    const outcome = await callWithFallback(
      {
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
        signal: opts.signal,
      },
      usable.length ? usable : configured
    );
    for (const attempt of outcome.attempts) recordProviderResult(attempt.provider, attempt.ok);
    if (outcome.response) {
      return {
        content: outcome.response.content,
        tool_calls: outcome.response.tool_calls,
        provider: outcome.response.provider,
        routed_via: outcome.response.routed_via,
        model: outcome.response.model,
        degraded: false,
        attempts: outcome.attempts,
      };
    }
    opts.signal?.throwIfAborted();
    // The operator asked for a live model and every one of them failed. Raising
    // here keeps the queue's retry/dead-letter contract intact; silently
    // returning a scaffold would be the false-completion bug all over again.
    throw new ModelUnavailableError(
      `model unavailable: ${outcome.attempts.length} attempt(s) failed: ${outcome.attempts
        .filter((a) => !a.ok)
        .map((a) => `${a.provider}(${a.error ?? 'error'})`)
        .join(', ')}`,
      outcome.attempts
    );
  }

  // Nothing configured: auto-detect only a local free gateway, never a paid one.
  if (process.env.HAH_AUTO_FREELLMAPI !== '0' && (await localGatewayReady())) {
    try {
      const r = await freellmapiChat({ ...opts });
      return { ...r, provider: 'freellmapi', degraded: false };
    } catch (err) {
      opts.signal?.throwIfAborted();
      cachedProbe = { expires: Date.now() + 15_000, ready: false };
      return {
        ...heuristic(opts),
        degraded: true,
        degraded_reason: `local gateway probe succeeded but the call failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
      };
    }
  }

  return {
    ...heuristic(opts),
    degraded: true,
    degraded_reason: 'no model provider is configured; running deterministic tools only',
  };
}

function heuristic(opts: {
  messages: ModelMessage[];
  tools: string[];
  agentId: string;
}): {
  content: string;
  tool_calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  provider: 'heuristic';
} {
  const capability = tools13Capabilities().find(c=>`tool13-${c.id}` === opts.agentId);
  if (capability?.status === 'BLOCKED' && opts.agentId !== 'tool13-lapian-notes') {
    return {provider:'heuristic',content:JSON.stringify({agent_id:opts.agentId,...capability}),tool_calls:[]};
  }
  const tools = new Set(opts.tools);
  const step = opts.messages.filter((m) => m.role === 'tool').length;
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')?.content || '';

  if (opts.agentId === 'hub-boss' && step === 0 && tools.has('hub_full_roster')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [{ id: 'h0', name: 'hub_full_roster', arguments: {} }],
    };
  }
  if (opts.agentId === 'hub-boss' && step === 1 && tools.has('dispatch_agent')) {
    const original = lastUser.split('Original task:\n')[1]?.split('\n\n')[0] ?? lastUser;
    const plan = planWithBoss(original);
    return {provider:'heuristic',content:'Queueing specialist assignments; offline analysis is a scaffold.',
      tool_calls:plan.decomposition.slice(0,4).map((d,i)=>({id:`dispatch-${i}`,name:'dispatch_agent',arguments:{agent_id:d.agent_id,subtask:d.subtask}}))};
  }
  if (opts.agentId === 'hub-boss' && step >= 2 && !opts.messages.some(m=>m.role==='tool' && m.name==='workspace_write') && tools.has('workspace_write')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [
        {
          id: 'h1',
          name: 'workspace_write',
          arguments: {
            path: 'artifacts/hub-boss-plan.json',
            content: JSON.stringify({ agent: 'hub-boss', task: lastUser.slice(0, 400), aware: 'full-roster' }, null, 2),
          },
        },
      ],
    };
  }

  if (opts.agentId === 'hub-agent-browse' && step === 0 && tools.has('hub_agent_browse')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [{ id: 'b0', name: 'hub_agent_browse', arguments: { query: lastUser.slice(0, 200) } }],
    };
  }
  if (opts.agentId === 'hub-agent-browse' && step === 1 && tools.has('workspace_write')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [
        {
          id: 'b1',
          name: 'workspace_write',
          arguments: {
            path: 'artifacts/agent-browse.md',
            content: `# Agent browse\n\nQuery: ${lastUser.slice(0, 400)}\n\nSee hub_agent_browse tool output for the full catalog hits across packs, agents, tools13, and MCP tools.\n`,
          },
        },
      ],
    };
  }

  if (opts.agentId === 'hub-freellmapi' && step === 0 && tools.has('hub_freellmapi_status')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [{ id: 'f0', name: 'hub_freellmapi_status', arguments: {} }],
    };
  }
  if (opts.agentId === 'hub-freellmapi' && step === 1 && tools.has('workspace_write')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [
        {
          id: 'f1',
          name: 'workspace_write',
          arguments: {
            path: 'artifacts/freellmapi-connection.json',
            content: JSON.stringify(
              {
                agent: 'hub-freellmapi',
                task: lastUser.slice(0, 400),
                provider: 'freellmapi',
                upstream: 'https://github.com/tashfeenahmed/freellmapi',
                next: 'Run scripts/connect-freellmapi.sh with HAH_FREELLMAPI_KEY after FreeLLMAPI is up',
              },
              null,
              2
            ),
          },
        },
      ],
    };
  }

  if (opts.agentId.startsWith('tool13-seo') && step === 0 && tools.has('seo_audit_html')) {
    const htmlMatch = lastUser.match(/```html([\s\S]*?)```/i) || lastUser.match(/<html[\s\S]*<\/html>/i);
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [
        {
          id: 'h1',
          name: 'seo_audit_html',
          arguments: {
            html: htmlMatch?.[1] || htmlMatch?.[0] || '<html lang="en"><head><title>t</title></head><body><h1>Hi</h1></body></html>',
            url: 'https://example.com/',
          },
        },
      ],
    };
  }

  if (opts.agentId.startsWith('desk-') && step === 0) {
    if (tools.has('clean_leads') && /email|lead|@/i.test(lastUser)) {
      return {
        provider: 'heuristic',
        content: '',
        tool_calls: [{ id: 'h1', name: 'clean_leads', arguments: { text: lastUser } }],
      };
    }
    if (tools.has('sheets_to_json') && /csv|,|\t/i.test(lastUser)) {
      const csvMatch = lastUser.match(/```([\s\S]*?)```/) || lastUser.match(/(?:\n|^)([^\n]+,[^\n]+(?:\n[^\n]+)*)/);
      return {
        provider: 'heuristic',
        content: '',
        tool_calls: [{ id: 'h1', name: 'sheets_to_json', arguments: { csv: csvMatch?.[1] || 'week,value\n1,10\n2,12' } }],
      };
    }
    if (tools.has('extract_contacts')) {
      return {
        provider: 'heuristic',
        content: '',
        tool_calls: [{ id: 'h1', name: 'extract_contacts', arguments: { html: lastUser } }],
      };
    }
  }

  if (opts.agentId.startsWith('forge-') && step === 0) {
    if (tools.has('forge_detect') && /https?:\/\//i.test(lastUser)) {
      const url = lastUser.match(/https?:\/\/[^\s)]+/)?.[0] || '';
      return {
        provider: 'heuristic',
        content: '',
        tool_calls: [{ id: 'h1', name: 'forge_detect', arguments: { url } }],
      };
    }
    if (tools.has('agent_mining_queries')) {
      return { provider: 'heuristic', content: '', tool_calls: [{ id: 'h1', name: 'agent_mining_queries', arguments: {} }] };
    }
  }

  if (step === 0 && tools.has('workspace_list')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [{ id: 'h1', name: 'workspace_list', arguments: { path: '.' } }],
    };
  }

  if (step === 1 && tools.has('workspace_write')) {
    return {
      provider: 'heuristic',
      content: '',
      tool_calls: [
        {
          id: 'h2',
          name: 'workspace_write',
          arguments: {
            path: `artifacts/${opts.agentId}-report.json`,
            content: JSON.stringify(
              {
                agent_id: opts.agentId,
                mode: 'heuristic',
                kind: SCAFFOLD_MARKER,
                task_excerpt: lastUser.slice(0, 300),
                status: 'completed_offline',
              },
              null,
              2
            ),
          },
        },
      ],
    };
  }

  return {
    provider: 'heuristic',
    content: JSON.stringify({
      agent_id: opts.agentId,
      // Machine-readable marker so verification can never grade this verified.
      kind: SCAFFOLD_MARKER,
      summary: `Offline scaffold for ${opts.agentId}; specialist analysis requires a live model`,
      task: lastUser.slice(0, 200),
    }, null, 2),
    tool_calls: [],
  };
}

let cachedProbe: { expires: number; ready: boolean } | undefined;
async function localGatewayReady() {
  if (cachedProbe && Date.now() < cachedProbe.expires) return cachedProbe.ready;
  const result = await probeFreellmapi(800);
  const ready = result.ok && (result.models_count ?? 0) > 0;
  cachedProbe = {expires: Date.now() + 15_000, ready};
  return ready;
}
