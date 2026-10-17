/**
 * Built-in integration adapters.
 *
 * Every adapter here is free-tier only and stays unconfigured until its
 * credential or endpoint is present, so enabling the Hub can never start
 * spending. Free-tier limits are recorded as documented values the operator can
 * verify, and the Hub enforces its own local ceiling underneath them.
 */
import { credential } from './credentials.js';
import {
  checkQuota,
  httpJson,
  probeEndpoint,
  registerIntegration,
  hasCredential,
} from './registry.js';
import { integrationError, type Integration, type IntegrationHealth } from './types.js';
import { allProviders, providerById } from '../model/providers.js';
import { listAgents } from '../runtime/registry.js';
import { rufloIntegration } from './ruflo.js';

function env(names: string[]): string {
  return credential(names);
}

/** Model gateways are adapted from the provider registry so there is one brain. */
function modelIntegration(providerId: string, meta: {
  label: string;
  homepage: string;
  docs: string;
  authEnv: string[];
  authHint: string;
  freeTier: string;
  rpm: number | null;
  rpd: number | null;
}): Integration {
  const provider = () => providerById(providerId)!;
  const integration: Integration = {
    id: `model.${providerId}`,
    label: meta.label,
    category: 'model',
    provider: { name: meta.label, homepage: meta.homepage, docs: meta.docs },
    auth: { kind: meta.authEnv.length ? 'bearer' : 'none', env: meta.authEnv, hint: meta.authHint },
    capabilities: ['model.gateway'],
    operations: [
      {
        id: 'chat',
        description: 'OpenAI-compatible chat completion',
        input: { system: 'string', messages: 'array', tools: 'array', model: 'string' },
        output: { content: 'string', tool_calls: 'array', model: 'string', usage: 'object' },
        scopes: ['inference'],
        mutating: false,
        requiresApproval: false,
      },
      {
        id: 'models',
        description: 'List the model catalog the endpoint exposes',
        input: {},
        output: { data: 'array' },
        scopes: ['inference'],
        mutating: false,
        requiresApproval: false,
      },
    ],
    limits: { requestsPerMinute: meta.rpm, requestsPerDay: meta.rpd, onExceeded: 'fail over to the next free provider, then report BLOCKED' },
    cost: { paid: false, freeTier: meta.freeTier },
    configured: () => provider().configured(),
    async health(timeoutMs = 4_000): Promise<IntegrationHealth> {
      const report = await provider().health(timeoutMs);
      return {
        id: integration.id,
        configured: report.configured,
        ok: report.ok,
        readiness: report.ok ? 'READY' : report.configured ? 'LIMITED' : 'BLOCKED',
        latency_ms: report.latency_ms,
        detail: report.ok ? `${report.models_count ?? 0} model(s) advertised` : report.error ?? report.hint,
        smoke_test: {
          ran: report.configured,
          passed: report.ok,
          detail: report.ok ? 'GET /models returned a catalog' : report.error ?? 'endpoint unreachable',
        },
      };
    },
    async call(operation, input, signal) {
      const quota = checkQuota(integration.id, integration.limits);
      if (!quota.allowed) {
        throw integrationError(integration.id, operation, 'rate_limited', quota.reason!, 'Wait for the window to reset.', quota.retryAfterMs);
      }
      if (operation === 'chat') {
        return provider().chat({
          system: String(input.system ?? ''),
          messages: (input.messages as never) ?? [],
          tools: (input.tools as string[]) ?? [],
          model: input.model ? String(input.model) : undefined,
          signal,
        });
      }
      if (operation === 'models') {
        return provider().health(4_000);
      }
      throw integrationError(integration.id, operation, 'bad_request', `unknown operation ${operation}`, 'Use one of: chat, models.');
    },
  };
  return integration;
}

/** Search/research providers. All free tiers; none is enabled without a key. */
function searchIntegration(spec: {
  id: string;
  label: string;
  homepage: string;
  docs: string;
  authEnv: string[];
  authHint: string;
  freeTier: string;
  rpm: number | null;
  rpd: number | null;
  healthUrl: string;
  headers: () => Record<string, string>;
  search: (query: string, signal?: AbortSignal) => Promise<unknown>;
}): Integration {
  const integration: Integration = {
    id: spec.id,
    label: spec.label,
    category: 'search',
    provider: { name: spec.label, homepage: spec.homepage, docs: spec.docs },
    auth: { kind: 'api_key', env: spec.authEnv, hint: spec.authHint },
    capabilities: ['research.web'],
    operations: [
      {
        id: 'search',
        description: 'Web search returning ranked results with source URLs',
        // Source URLs are mandatory output: a research answer without a
        // citation cannot be verified.
        input: { query: 'string', max_results: 'number' },
        output: { results: 'array<{title,url,snippet,published_at}>' },
        scopes: ['search:read'],
        mutating: false,
        requiresApproval: false,
      },
    ],
    limits: { requestsPerMinute: spec.rpm, requestsPerDay: spec.rpd, onExceeded: 'report rate_limited with a retry window; never silently drop results' },
    cost: { paid: false, freeTier: spec.freeTier },
    configured: () => hasCredential(spec.authEnv),
    health: (timeoutMs) => probeEndpoint(integration, spec.healthUrl, spec.headers(), timeoutMs),
    async call(operation, input, signal) {
      if (operation !== 'search') {
        throw integrationError(spec.id, operation, 'bad_request', `unknown operation ${operation}`, 'Use: search.');
      }
      if (!integration.configured()) {
        throw integrationError(spec.id, operation, 'not_configured', `${spec.label} has no credential`, spec.authHint);
      }
      const quota = checkQuota(spec.id, integration.limits);
      if (!quota.allowed) {
        throw integrationError(spec.id, operation, 'rate_limited', quota.reason!, 'Wait for the window to reset.', quota.retryAfterMs);
      }
      return spec.search(String(input.query ?? ''), signal);
    },
  };
  return integration;
}

function githubIntegration(): Integration {
  const authEnv = ['HAH_GITHUB_TOKEN', 'GITHUB_TOKEN'];
  const headers = () => {
    const token = env(authEnv);
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };
  const integration: Integration = {
    id: 'dev.github',
    label: 'GitHub REST API',
    category: 'development',
    provider: { name: 'GitHub', homepage: 'https://github.com', docs: 'https://docs.github.com/rest' },
    auth: {
      kind: 'bearer',
      env: authEnv,
      hint: 'Set HAH_GITHUB_TOKEN to a fine-grained token scoped to the repositories this Hub may read.',
    },
    capabilities: ['forge.inspect'],
    operations: [
      {
        id: 'repo',
        description: 'Read repository metadata',
        input: { owner: 'string', repo: 'string' },
        output: { full_name: 'string', default_branch: 'string', visibility: 'string' },
        scopes: ['contents:read', 'metadata:read'],
        mutating: false,
        requiresApproval: false,
      },
      {
        id: 'issues',
        description: 'List issues and pull requests',
        input: { owner: 'string', repo: 'string', state: 'string' },
        output: { items: 'array<{number,title,state,url}>' },
        scopes: ['issues:read', 'pull_requests:read'],
        mutating: false,
        requiresApproval: false,
      },
      {
        id: 'checks',
        description: 'Read CI check runs for a ref',
        input: { owner: 'string', repo: 'string', ref: 'string' },
        output: { check_runs: 'array<{name,status,conclusion}>' },
        scopes: ['checks:read'],
        mutating: false,
        requiresApproval: false,
      },
    ],
    // Read-only by design. Writing to a repository is an irreversible action on
    // someone else's code, so no mutating operation is exposed here at all.
    limits: { requestsPerMinute: 30, requestsPerDay: 5_000, onExceeded: 'report rate_limited with GitHub\'s Retry-After' },
    cost: { paid: false, freeTier: 'Unauthenticated 60 req/h; authenticated 5000 req/h. No billing on the REST read API.' },
    configured: () => true, // Public reads work without a token, at a lower limit.
    health: (timeoutMs) => probeEndpoint(integration, 'https://api.github.com/rate_limit', headers(), timeoutMs),
    async call(operation, input, signal) {
      const owner = String(input.owner ?? '');
      const repo = String(input.repo ?? '');
      if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
        throw integrationError('dev.github', operation, 'bad_request', 'owner and repo are required', 'Supply a valid owner/repo pair.');
      }
      const quota = checkQuota('dev.github', integration.limits);
      if (!quota.allowed) {
        throw integrationError('dev.github', operation, 'rate_limited', quota.reason!, 'Wait for the window to reset.', quota.retryAfterMs);
      }
      const base = `https://api.github.com/repos/${owner}/${repo}`;
      switch (operation) {
        case 'repo':
          return httpJson({ integration: 'dev.github', operation, url: base, headers: headers(), signal });
        case 'issues': {
          const state = ['open', 'closed', 'all'].includes(String(input.state)) ? String(input.state) : 'open';
          return httpJson({ integration: 'dev.github', operation, url: `${base}/issues?state=${state}&per_page=30`, headers: headers(), signal });
        }
        case 'checks': {
          const ref = String(input.ref ?? 'HEAD').replace(/[^\w./-]/g, '');
          return httpJson({ integration: 'dev.github', operation, url: `${base}/commits/${ref}/check-runs`, headers: headers(), signal });
        }
        default:
          throw integrationError('dev.github', operation, 'bad_request', `unknown operation ${operation}`, 'Use: repo, issues, checks.');
      }
    },
  };
  return integration;
}

function n8nIntegration(): Integration {
  const authEnv = ['HAH_N8N_API_KEY'];
  const baseUrl = () => (env(['HAH_N8N_URL']) || '').replace(/\/$/, '');
  const headers = (): Record<string, string> => {
    const key = env(authEnv);
    return key ? { 'X-N8N-API-KEY': key } : {};
  };
  const integration: Integration = {
    id: 'automation.n8n',
    label: 'n8n workflow automation',
    category: 'automation',
    provider: { name: 'n8n', homepage: 'https://n8n.io', docs: 'https://docs.n8n.io/api/' },
    auth: {
      kind: 'api_key',
      env: authEnv,
      hint: 'Set HAH_N8N_URL to your self-hosted n8n and HAH_N8N_API_KEY to an API key. Self-hosted n8n is free.',
    },
    capabilities: ['workflow.validate'],
    operations: [
      {
        id: 'list_workflows',
        description: 'List workflows defined on the n8n instance',
        input: {},
        output: { data: 'array<{id,name,active}>' },
        scopes: ['workflow:read'],
        mutating: false,
        requiresApproval: false,
      },
      {
        id: 'run_workflow',
        description: 'Trigger a workflow execution',
        input: { workflow_id: 'string', payload: 'object' },
        output: { execution_id: 'string' },
        scopes: ['workflow:execute'],
        mutating: true,
        // Triggering a workflow can send mail, charge a card, or move data.
        requiresApproval: true,
      },
    ],
    limits: { requestsPerMinute: 20, requestsPerDay: 2_000, onExceeded: 'report rate_limited; executions are never retried automatically' },
    cost: { paid: false, freeTier: 'Self-hosted n8n Community Edition is free; n8n Cloud is paid and is not enabled here.' },
    configured: () => Boolean(baseUrl()) && hasCredential(authEnv),
    health: (timeoutMs) =>
      baseUrl()
        ? probeEndpoint(integration, `${baseUrl()}/api/v1/workflows?limit=1`, headers(), timeoutMs)
        : Promise.resolve({
            id: integration.id,
            configured: false,
            ok: false,
            readiness: 'BLOCKED' as const,
            latency_ms: null,
            detail: 'HAH_N8N_URL is not set',
          }),
    async call(operation, input, signal) {
      if (!integration.configured()) {
        throw integrationError(integration.id, operation, 'not_configured', 'n8n endpoint or key missing', integration.auth.hint);
      }
      const quota = checkQuota(integration.id, integration.limits);
      if (!quota.allowed) {
        throw integrationError(integration.id, operation, 'rate_limited', quota.reason!, 'Wait for the window to reset.', quota.retryAfterMs);
      }
      if (operation === 'list_workflows') {
        return httpJson({ integration: integration.id, operation, url: `${baseUrl()}/api/v1/workflows?limit=50`, headers: headers(), signal });
      }
      if (operation === 'run_workflow') {
        // Approval is a decision for the caller, not for an adapter to assume.
        if (input.approved !== true) {
          throw integrationError(
            integration.id,
            operation,
            'needs_approval',
            'run_workflow changes remote state and was not approved',
            'Re-issue the call with approved=true after a human has authorised this specific execution.'
          );
        }
        const id = String(input.workflow_id ?? '').replace(/[^\w-]/g, '');
        if (!id) throw integrationError(integration.id, operation, 'bad_request', 'workflow_id required', 'Supply a workflow id.');
        return httpJson({
          integration: integration.id,
          operation,
          method: 'POST',
          url: `${baseUrl()}/api/v1/workflows/${id}/activate`,
          headers: headers(),
          body: (input.payload as Record<string, unknown>) ?? {},
          signal,
        });
      }
      throw integrationError(integration.id, operation, 'bad_request', `unknown operation ${operation}`, 'Use: list_workflows, run_workflow.');
    },
  };
  return integration;
}

/**
 * Productivity suites. These are declared but intentionally not auto-connected:
 * the Hub reuses an already-authorised connection via an explicit endpoint, and
 * never creates a second one. Without that endpoint the integration is BLOCKED
 * and says so.
 */
function productivityIntegration(spec: {
  id: string;
  label: string;
  homepage: string;
  docs: string;
  urlEnv: string[];
  authEnv: string[];
  authHint: string;
  operations: Integration['operations'];
}): Integration {
  const baseUrl = () => (env(spec.urlEnv) || '').replace(/\/$/, '');
  const integration: Integration = {
    id: spec.id,
    label: spec.label,
    category: 'productivity',
    provider: { name: spec.label, homepage: spec.homepage, docs: spec.docs },
    auth: { kind: 'oauth', env: [...spec.urlEnv, ...spec.authEnv], hint: spec.authHint },
    capabilities: ['content.write'],
    operations: spec.operations,
    limits: { requestsPerMinute: 10, requestsPerDay: 500, onExceeded: 'report rate_limited; no automatic retry on a send' },
    cost: { paid: false, freeTier: 'Free tier of the existing authorised workspace. The Hub never provisions a paid plan.' },
    configured: () => Boolean(baseUrl()) && hasCredential(spec.authEnv),
    async health(timeoutMs = 4_000) {
      if (!integration.configured()) {
        return {
          id: spec.id,
          configured: false,
          ok: false,
          readiness: 'BLOCKED' as const,
          latency_ms: null,
          detail: `not connected. ${spec.authHint}`,
        };
      }
      return probeEndpoint(integration, baseUrl(), { Authorization: `Bearer ${env(spec.authEnv)}` }, timeoutMs);
    },
  };
  return integration;
}

let registered = false;

/** Register every built-in adapter exactly once. */
export function registerBuiltinIntegrations(): void {
  if (registered) return;
  registered = true;

  const modelMeta: Record<string, Parameters<typeof modelIntegration>[1]> = {
    freellmapi: {
      label: 'FreeLLMAPI (self-hosted OSS free-tier aggregator)',
      homepage: 'https://github.com/tashfeenahmed/freellmapi',
      docs: 'https://github.com/tashfeenahmed/freellmapi#readme',
      authEnv: ['HAH_FREELLMAPI_KEY'],
      authHint: 'Run scripts/connect-freellmapi.sh, then set HAH_MODEL_PROVIDER=freellmapi. Key optional for a local gateway.',
      freeTier: 'Self-hosted aggregator over upstream free tiers; limits are whatever the upstream providers allow.',
      rpm: 20,
      rpd: 1_000,
    },
    openai_compatible: {
      label: 'Generic OpenAI-compatible endpoint (llama.cpp / vLLM / LM Studio)',
      homepage: 'https://platform.openai.com/docs/api-reference',
      docs: 'https://platform.openai.com/docs/api-reference/chat',
      authEnv: ['HAH_MODEL_API_KEY'],
      authHint: 'Set HAH_MODEL_URL to a local OpenAI-compatible /v1 endpoint. CPU inference needs no key.',
      freeTier: 'Local inference: unlimited and free, bounded only by local CPU.',
      rpm: 60,
      rpd: null,
    },
    ollama: {
      label: 'Ollama local server (CPU)',
      homepage: 'https://ollama.com',
      docs: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
      authEnv: [],
      authHint: 'Run `ollama serve` and set HAH_OLLAMA_URL=http://127.0.0.1:11434/v1',
      freeTier: 'Local inference: unlimited and free, bounded only by local CPU.',
      rpm: 60,
      rpd: null,
    },
    openrouter_free: {
      label: 'OpenRouter free-tier models',
      homepage: 'https://openrouter.ai',
      docs: 'https://openrouter.ai/docs/limits',
      authEnv: ['HAH_OPENROUTER_KEY', 'OPENROUTER_API_KEY'],
      authHint: 'Set HAH_OPENROUTER_KEY. Only ":free" model ids are selected, so no credits are spent.',
      // Verify on the docs page before relying on these; OpenRouter changes them.
      freeTier: 'Free ":free" models: ~20 req/min and a daily cap tied to account credit (verify at openrouter.ai/docs/limits).',
      rpm: 20,
      rpd: 50,
    },
    huggingface: {
      label: 'Hugging Face Inference (free tier)',
      homepage: 'https://huggingface.co',
      docs: 'https://huggingface.co/docs/inference-providers',
      authEnv: ['HAH_HF_TOKEN', 'HUGGINGFACEHUB_API_TOKEN'],
      authHint: 'Set HAH_HF_TOKEN. The free router has a monthly credit allowance and no tool-calling support.',
      freeTier: 'Monthly inference credit allowance on a free account (verify in your HF billing settings).',
      rpm: 10,
      rpd: 200,
    },
  };
  for (const provider of allProviders()) {
    const meta = modelMeta[provider.id];
    if (meta) registerIntegration(modelIntegration(provider.id, meta));
  }

  registerIntegration(
    searchIntegration({
      id: 'search.tavily',
      label: 'Tavily Search',
      homepage: 'https://tavily.com',
      docs: 'https://docs.tavily.com',
      authEnv: ['HAH_TAVILY_KEY', 'TAVILY_API_KEY'],
      authHint: 'Set HAH_TAVILY_KEY. Tavily grants a free monthly credit allowance; verify the current figure in your dashboard.',
      freeTier: 'Free monthly API credits on a developer account (verify at tavily.com pricing).',
      rpm: 10,
      rpd: 300,
      healthUrl: 'https://api.tavily.com/search',
      headers: () => ({ Authorization: `Bearer ${env(['HAH_TAVILY_KEY', 'TAVILY_API_KEY'])}` }),
      search: (query, signal) =>
        httpJson({
          integration: 'search.tavily',
          operation: 'search',
          method: 'POST',
          url: 'https://api.tavily.com/search',
          headers: { Authorization: `Bearer ${env(['HAH_TAVILY_KEY', 'TAVILY_API_KEY'])}` },
          body: { query, max_results: 8, include_answer: false },
          signal,
        }),
    })
  );

  registerIntegration(
    searchIntegration({
      id: 'search.brave',
      label: 'Brave Search API',
      homepage: 'https://brave.com/search/api/',
      docs: 'https://api-dashboard.search.brave.com/app/documentation',
      authEnv: ['HAH_BRAVE_KEY', 'BRAVE_SEARCH_API_KEY'],
      authHint: 'Set HAH_BRAVE_KEY. The Brave "Free" plan allows 1 query/second and a monthly cap; verify in the dashboard.',
      freeTier: 'Free plan: 1 query/second, monthly query cap (verify at api-dashboard.search.brave.com).',
      rpm: 30,
      rpd: 2_000,
      healthUrl: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
      headers: () => ({ 'X-Subscription-Token': env(['HAH_BRAVE_KEY', 'BRAVE_SEARCH_API_KEY']) }),
      search: (query, signal) =>
        httpJson({
          integration: 'search.brave',
          operation: 'search',
          url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
          headers: { 'X-Subscription-Token': env(['HAH_BRAVE_KEY', 'BRAVE_SEARCH_API_KEY']) },
          signal,
        }),
    })
  );

  registerIntegration(
    searchIntegration({
      id: 'search.exa',
      label: 'Exa neural search',
      homepage: 'https://exa.ai',
      docs: 'https://docs.exa.ai',
      authEnv: ['HAH_EXA_KEY', 'EXA_API_KEY'],
      authHint: 'Set HAH_EXA_KEY. Exa grants free starter credits; verify the current allowance in your dashboard.',
      freeTier: 'Free starter credits on signup (verify at exa.ai pricing).',
      rpm: 10,
      rpd: 200,
      healthUrl: 'https://api.exa.ai/search',
      headers: () => ({ 'x-api-key': env(['HAH_EXA_KEY', 'EXA_API_KEY']) }),
      search: (query, signal) =>
        httpJson({
          integration: 'search.exa',
          operation: 'search',
          method: 'POST',
          url: 'https://api.exa.ai/search',
          headers: { 'x-api-key': env(['HAH_EXA_KEY', 'EXA_API_KEY']) },
          body: { query, numResults: 8 },
          signal,
        }),
    })
  );

  registerIntegration(githubIntegration());
  registerIntegration(n8nIntegration());

  registerIntegration(
    productivityIntegration({
      id: 'productivity.google_workspace',
      label: 'Google Workspace (Gmail, Calendar, Drive, Sheets)',
      homepage: 'https://workspace.google.com',
      docs: 'https://developers.google.com/workspace',
      urlEnv: ['HAH_GOOGLE_PROXY_URL'],
      authEnv: ['HAH_GOOGLE_PROXY_TOKEN'],
      authHint:
        'Point HAH_GOOGLE_PROXY_URL at the existing authorised Google connection and set HAH_GOOGLE_PROXY_TOKEN. The Hub reuses that connection and never creates a second one.',
      operations: [
        { id: 'list_messages', description: 'List Gmail messages', input: { query: 'string' }, output: { messages: 'array' }, scopes: ['gmail.readonly'], mutating: false, requiresApproval: false },
        { id: 'send_message', description: 'Send a Gmail message', input: { to: 'string', subject: 'string', body: 'string' }, output: { id: 'string' }, scopes: ['gmail.send'], mutating: true, requiresApproval: true },
        { id: 'list_events', description: 'List calendar events', input: { time_min: 'string', time_max: 'string' }, output: { events: 'array' }, scopes: ['calendar.readonly'], mutating: false, requiresApproval: false },
        { id: 'read_sheet', description: 'Read a Sheets range', input: { spreadsheet_id: 'string', range: 'string' }, output: { values: 'array' }, scopes: ['spreadsheets.readonly'], mutating: false, requiresApproval: false },
      ],
    })
  );

  registerIntegration(
    productivityIntegration({
      id: 'productivity.notion',
      label: 'Notion',
      homepage: 'https://notion.so',
      docs: 'https://developers.notion.com',
      urlEnv: ['HAH_NOTION_URL'],
      authEnv: ['HAH_NOTION_TOKEN'],
      authHint: 'Set HAH_NOTION_URL=https://api.notion.com/v1 and HAH_NOTION_TOKEN to an existing integration token.',
      operations: [
        { id: 'search', description: 'Search pages and databases', input: { query: 'string' }, output: { results: 'array' }, scopes: ['read_content'], mutating: false, requiresApproval: false },
        { id: 'create_page', description: 'Create a page', input: { parent: 'string', title: 'string', content: 'string' }, output: { id: 'string' }, scopes: ['insert_content'], mutating: true, requiresApproval: true },
      ],
    })
  );

  registerIntegration(rufloIntegration());
}

/**
 * Capability coverage across agents and integrations, so a gap report can say
 * whether a missing ability needs an agent, a credential, or both.
 */
export function capabilityCoverage() {
  registerBuiltinIntegrations();
  const agents = listAgents();
  return { agents: agents.length };
}
