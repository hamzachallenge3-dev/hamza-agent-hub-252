import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { assertCatalog, listAgents, PACKS, getAgent } from '../runtime/registry.js';
import { cancelTask, enqueueAgentTask, queueStats, startQueue } from '../runtime/queue.js';
import { getTask, listEvents } from '../storage/db.js';
import { modelStatus } from '../model/client.js';
import { config } from '../config.js';
import {
  freellmapiChat,
  freellmapiEnabled,
  freellmapiStatusSummary,
  probeFreellmapi,
} from '../model/freellmapi.js';
import { buildBossDirectory, planWithBoss } from '../runtime/boss.js';
import { browseAgentDetail, browseEverything } from '../runtime/browse.js';
import { cleanLeads, sheetsToJson, extractContacts } from '../packs/desk/tools.js';
import { forgeDetect, githubUrlTricks, agentMiningQueries } from '../packs/forge/tools.js';
import { loadTools13Manifest, lookupTool13 } from '../packs/tools13/registry.js';
import { seoAuditHtml } from '../packs/tools13/seo.js';
import { redactSecrets } from '../security/redact.js';
import { edgeHealth } from './edge-health.js';
import { tools13Capabilities, validateWorkflow, compactContext, extractLinks } from '../packs/tools13/offline.js';
import { CANCEL, RO, RO_OPEN, SANDBOX_EXEC, WRITE_LOCAL } from './annotations.js';
import { runSandboxCommand, sandboxToolsEnabled } from '../tools/sandbox.js';
import { registerBrowserTools } from './browser-tools.js';
import { webSearch } from '../integrations/search.js';
import { registerBuiltinIntegrations } from '../integrations/adapters.js';
import { getIntegration, integrationStatusReport } from '../integrations/registry.js';
import { auditAgent, auditAgents, auditSummary } from '../runtime/audit.js';
import fs from 'node:fs';

function jsonText(data: unknown) {
  return { content: [{ type: 'text' as const, text: redactSecrets(data) }] };
}

export function createHamzaHubServer(): McpServer {
  startQueue();
  const server = new McpServer({
    name: 'hamza-agent-hub',
    version: '1.2.1',
    title: 'Hamza Agent Hub',
  });

  server.tool(
    'hub_health',
    'Hub runtime/model/storage readiness (no secrets)',
    {},
    RO,
    async () => {
      let ok = false;
      let error: string | null = null;
      try {
        assertCatalog();
        ok = true;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const model = modelStatus();
      const probe = await probeFreellmapi(800);
      return jsonText({
        ok,
        service: 'hamza-agent-hub',
        version: '1.2.1',
        chatgpt_plugin: true,
        packs: PACKS,
        agents: listAgents().length,
        ecc68_agents: listAgents('ecc68').length,
        desk_agents: listAgents('desk').length,
        forge_agents: listAgents('forge').length,
        tools13_agents: listAgents('tools13').length,
        tools13_manifest: loadTools13Manifest().length,
        boss_knows_all: Boolean(getAgent('hub-boss')?.tools.includes('hub_full_roster')),
        agent_browse: Boolean(getAgent('hub-agent-browse')?.tools.includes('hub_agent_browse')),
        hub_agents: listAgents('hub').length,
        freellmapi: freellmapiStatusSummary(),
        freellmapi_live: probe.ok && (probe.models_count ?? 0) > 0,
        automatic_free_gateway: process.env.HAH_AUTO_FREELLMAPI !== '0',
        queue: queueStats(),
        model,
        storage: { db_exists: fs.existsSync(config.dbPath) },
        desk_twin: config.deskUrl,
        production_guard: 'This lab plugin does not mutate production Hamza Agent Hub or GLM/Headroom',
        error,
      });
    }
  );

  server.tool(
    'hub_freellmapi_status',
    'Probe FreeLLMAPI (open-source free LLM gateway) — /v1/models health, catalog sample, connection hints',
    {},
    RO_OPEN,
    async () => jsonText({ config: freellmapiStatusSummary(), probe: await probeFreellmapi() })
  );

  server.tool(
    'hub_freellmapi_chat',
    'Send a one-shot chat completion through FreeLLMAPI (model=auto by default). Lab only — free tiers.',
    {
      prompt: z.string().max(100_000),
      system: z.string().max(100_000).optional(),
      model: z.string().max(100_000).optional(),
    },
    RO_OPEN,
    async ({ prompt, system, model }) => {
      if (!freellmapiEnabled() && !config.modelUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'FreeLLMAPI not enabled. Run scripts/connect-freellmapi.sh or set HAH_MODEL_PROVIDER=freellmapi',
            },
          ],
        };
      }
      try {
        const result = await freellmapiChat({
          system: system || 'You are a helpful assistant for Hamza Agent Hub lab.',
          messages: [{ role: 'user', content: prompt }],
          tools: [],
          model,
        });
        return jsonText(result);
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: redactSecrets(err instanceof Error ? err.message : String(err)) }],
        };
      }
    }
  );

  server.tool('hub_list_packs', 'List Hub packs (hub, desk, ecc68, forge, tools13)', {}, RO, async () =>
    jsonText({ packs: PACKS })
  );

  server.tool(
    'hub_list_agents',
    'List all agents across packs (optional pack filter)',
    { pack: z.string().max(100_000).optional() },
    RO,
    async ({ pack }) => {
      const agents = listAgents(pack).map((a) => ({
        id: a.id,
        pack: a.pack,
        category: a.category,
        description: a.description,
        tools: a.tools,
        model_ready: a.model_ready,
      }));
      return jsonText({ count: agents.length, agents });
    }
  );

  server.tool(
    'hub_boss_route',
    'Preview how hub-boss would differentiate and assign a mission using FULL roster awareness',
    { task: z.string().max(100_000) },
    RO,
    async ({ task }) => jsonText(planWithBoss(task))
  );

  server.tool(
    'hub_full_roster',
    'Return the complete agent directory that hub-boss knows (all packs)',
    {},
    RO,
    async () => jsonText({ count: listAgents().length, directory: buildBossDirectory() })
  );

  server.tool(
    'hub_agent_browse',
    'Browse the Hub CATALOG: packs, all agents (with real capabilities and runtime readiness), tools13, MCP tools. Search by query or capability, or open one agent_id. For browsing actual websites use browser_navigate.',
    {
      query: z.string().max(100_000).optional(),
      pack: z.string().max(100_000).optional(),
      category: z.string().max(100_000).optional(),
      capability: z.string().max(200).optional(),
      agent_id: z.string().max(100_000).optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().min(0).optional(),
      executable_only: z.boolean().optional(),
      include_tools13: z.boolean().optional(),
      include_mcp: z.boolean().optional(),
    },
    RO,
    async (args) => {
      if (args.agent_id) {
        const detail = browseAgentDetail(args.agent_id);
        if (!detail.agent) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `unknown agent: ${args.agent_id}` }],
          };
        }
        return jsonText(detail);
      }
      const result = browseEverything({
        query: args.query,
        pack: args.pack,
        category: args.category,
        capability: args.capability,
        limit: args.limit,
        offset: args.offset,
        executable_only: args.executable_only,
        include_tools13: args.include_tools13,
        include_mcp: args.include_mcp,
      });
      // An invalid filter is a client error, not an empty success.
      if (result.error) {
        return { isError: true, content: [{ type: 'text' as const, text: redactSecrets(result) }] };
      }
      return jsonText(result);
    }
  );

  server.tool(
    'hub_tools13_lookup',
    'List or look up the 13 Hub Boss recovery tools',
    { query: z.string().max(100_000).optional() },
    RO,
    async ({ query }) => {
      if (!query || query === '*' || query === 'all') return jsonText(loadTools13Manifest());
      const hit = lookupTool13(query);
      return hit
        ? jsonText(hit)
        : { isError: true, content: [{ type: 'text' as const, text: `not found: ${query}` }] };
    }
  );

  server.tool(
    'seo_audit_html',
    'Free Marketing SEO Audit on local HTML (tools13) — no Okara, no posting',
    { html: z.string().max(100_000), url: z.string().max(100_000).optional() },
    RO,
    async ({ html, url }) => jsonText(seoAuditHtml(html, url || 'https://example.com/'))
  );

  server.tool(
    'run_agent',
    'Queue an agent from any pack. Use hub-boss to differentiate work across Desk + ECC68 + Forge + Tools13.',
    {
      agent_id: z.string().max(100_000),
      task: z.string().max(100_000),
      workspace_id: z.string().max(100_000),
      idempotency_key: z.string().max(100_000),
    },
    WRITE_LOCAL,
    async (args) => {
      try {
        const result = enqueueAgentTask(args);
        const preview =
          args.agent_id === 'hub-boss' || args.agent_id === 'ecc-chief-of-staff'
            ? planWithBoss(args.task)
            : undefined;
        return jsonText({
          task_id: result.task_id,
          reused: result.reused,
          status: result.task.status,
          agent: getAgent(args.agent_id),
          routing_preview: preview,
        });
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: redactSecrets(err instanceof Error ? err.message : String(err)) }],
        };
      }
    }
  );

  server.tool(
    'task_status',
    'Get task status/progress',
    { task_id: z.string().max(100_000) },
    RO,
    async ({ task_id }) => {
      const task = getTask(task_id);
      if (!task) return { isError: true, content: [{ type: 'text' as const, text: `not found: ${task_id}` }] };
      return jsonText({
        task_id: task.id,
        agent_id: task.agent_id,
        status: task.status,
        progress: task.progress,
        progress_message: task.progress_message,
      });
    }
  );

  server.tool(
    'task_result',
    'Get task output/evidence/artifacts',
    { task_id: z.string().max(100_000) },
    RO,
    async ({ task_id }) => {
      const task = getTask(task_id);
      if (!task) return { isError: true, content: [{ type: 'text' as const, text: `not found: ${task_id}` }] };
      return jsonText({
        task_id: task.id,
        status: task.status,
        output: task.output,
        error: task.error,
        evidence: safe(task.evidence),
        tool_log: safe(task.tool_log),
        artifacts: safe(task.artifacts),
        events: listEvents(task_id).slice(-40),
      });
    }
  );

  server.tool(
    'cancel_task',
    'Cancel a queued/running task',
    { task_id: z.string().max(100_000) },
    CANCEL,
    async ({ task_id }) => {
      try {
        return jsonText(cancelTask(task_id));
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: redactSecrets(err instanceof Error ? err.message : String(err)) }],
        };
      }
    }
  );

  server.tool(
    'clean_leads',
    'Clean and dedupe emails from messy text or CSV (Automation Desk)',
    { text: z.string().max(100_000).optional(), csv: z.string().max(100_000).optional() },
    RO,
    async (args) => jsonText(cleanLeads(args))
  );
  server.tool(
    'sheets_to_json',
    'Convert CSV/TSV spreadsheet text to JSON rows (Automation Desk)',
    { csv: z.string().max(100_000), dialect: z.string().max(100_000).optional() },
    RO,
    async (args) => jsonText(sheetsToJson(args))
  );
  server.tool(
    'extract_contacts',
    'Extract emails, phones and social links from public HTML (Automation Desk)',
    { html: z.string().max(100_000).optional(), url: z.string().max(100_000).optional() },
    RO,
    async (args) => jsonText(extractContacts(args))
  );

  server.tool(
    'forge_detect',
    'Detect code-hosting forge for a URL',
    { url: z.string().max(100_000) },
    RO,
    async ({ url }) => jsonText(forgeDetect(url))
  );
  server.tool(
    'github_url_tricks',
    'Expand a GitHub repo URL into intelligence viewer/API links',
    { url: z.string().max(100_000) },
    RO,
    async ({ url }) => jsonText(githubUrlTricks(url))
  );
  server.tool(
    'agent_mining_queries',
    'Curated GitHub queries to mine agents/skills/MCP',
    {},
    RO,
    async () => jsonText(agentMiningQueries())
  );

  server.tool('hub_edge_health', 'Read public edge health; never uses a secret path', {}, RO_OPEN, async () => jsonText(await edgeHealth()));
  server.tool('hub_tools13_capabilities', 'Honest local runner availability and blocked install hints / حالة الأدوات', {}, RO, async () => jsonText(tools13Capabilities()));
  server.tool('n8n_workflow_validate', 'Validate supplied workflow JSON without execution / تحقق دون تشغيل', {workflow:z.record(z.string().max(100_000),z.unknown())}, RO, async ({workflow}) => jsonText(validateWorkflow(workflow)));
  server.tool('context_compact', 'Local line dedupe retaining errors; not upstream Headroom / ضغط محلي', {text:z.string().max(100_000).max(100_000),max_lines:z.number().int().min(1).max(1000).optional()}, RO, async ({text,max_lines}) => jsonText(compactContext(text,max_lines)));
  server.tool('html_extract_links', 'Extract links from supplied HTML; no crawling / استخراج الروابط محلياً', {html:z.string().max(100_000).max(100_000)}, RO, async ({html}) => jsonText(extractLinks(html)));

  registerBrowserTools(server);

  server.tool(
    'web_search',
    'Search the web through a configured research integration (Tavily, Brave, Exa). Returns results with source URLs. Reports BLOCKED with the exact credential to set when no provider is configured — it never invents results.',
    { query: z.string().min(1).max(2_000) },
    RO_OPEN,
    async ({ query }) => jsonText(await webSearch(query))
  );

  server.tool(
    'hub_agent_audit',
    'Audit agents: responsibility, permitted tools, which of those tools passed an executed smoke check, inputs, outputs, model and API requirements, runtime dependencies, readiness and concrete limitations. Readiness is measured from executed checks, not from a declared flag.',
    { agent_id: z.string().max(200).optional(), readiness: z.enum(['READY', 'LIMITED', 'BLOCKED', 'UNTESTED']).optional() },
    RO,
    async ({ agent_id, readiness }) => {
      if (agent_id) {
        const row = await auditAgent(agent_id);
        if (!row) {
          return { isError: true, content: [{ type: 'text' as const, text: `unknown agent: ${agent_id}` }] };
        }
        return jsonText(row);
      }
      const rows = await auditAgents();
      const filtered = readiness ? rows.filter((r) => r.readiness === readiness) : rows;
      return jsonText({ summary: await auditSummary(), agents: filtered });
    }
  );

  server.tool(
    'hub_integrations',
    'Integration readiness: provider identity, authentication requirement, operations, scopes, rate limits, quota, cost and health. Never returns credential values.',
    { integration_id: z.string().max(200).optional() },
    RO,
    async ({ integration_id }) => {
      registerBuiltinIntegrations();
      if (!integration_id) return jsonText(await integrationStatusReport(2_500));
      const integration = getIntegration(integration_id);
      if (!integration) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `unknown integration: ${integration_id}. List them with no argument.` }],
        };
      }
      return jsonText({
        id: integration.id,
        label: integration.label,
        category: integration.category,
        provider: integration.provider,
        auth: integration.auth,
        capabilities: integration.capabilities,
        operations: integration.operations,
        limits: integration.limits,
        cost: integration.cost,
        configured: integration.configured(),
        health: await integration.health(2_500),
      });
    }
  );

  // Secret-path HTTP only (Worker HUB_SECRET → hub.py). Not registered on stdio.
  if (sandboxToolsEnabled()) {
    server.tool(
      'run_command',
      'Run a shell command as HUB_SANDBOX_USER (default agentbox) under the sandbox work dir; HTTP secret-path only',
      {
        command: z.string().min(1).max(4_000),
        cwd: z.string().max(1_000).optional(),
        timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
      },
      SANDBOX_EXEC,
      async ({ command, cwd, timeout_ms }) => {
        try {
          return jsonText(await runSandboxCommand({ command, cwd, timeout_ms }));
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: redactSecrets(err instanceof Error ? err.message : String(err)) }],
          };
        }
      },
    );
  }

  server.resource('roster', 'hub://roster', {mimeType:'application/json',description:'All packs and agents'}, async uri => ({contents:[{uri:uri.href,mimeType:'application/json',text:redactSecrets(listAgents())}]}));
  server.resource('capabilities', 'hub://capabilities', {mimeType:'application/json',description:'Tools13 availability'}, async uri => ({contents:[{uri:uri.href,mimeType:'application/json',text:redactSecrets(tools13Capabilities())}]}));
  server.prompt('route_mission', 'Route an English or Arabic mission / توجيه المهمة', {task:z.string().max(100_000)}, ({task}) => ({messages:[{role:'user',content:{type:'text',text:redactSecrets(planWithBoss(task))}}]}));
  return server;
}

function safe(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
