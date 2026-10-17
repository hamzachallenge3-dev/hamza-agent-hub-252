import { tools13Capabilities, validateWorkflow, compactContext, extractLinks } from '../packs/tools13/offline.js';
import fs from 'node:fs';
import path from 'node:path';
import { assertToolAllowed, resolveSafePath } from '../security/workspace.js';
import { redactSecrets } from '../security/redact.js';
import { cleanLeads, sheetsToJson, extractContacts } from '../packs/desk/tools.js';
import { forgeDetect, githubUrlTricks, agentMiningQueries } from '../packs/forge/tools.js';
import { listAgents, PACKS } from '../runtime/registry.js';
import { buildBossDirectory } from '../runtime/boss.js';
import { browseAgentDetail, browseEverything } from '../runtime/browse.js';
import { freellmapiChat, freellmapiStatusSummary, probeFreellmapi } from '../model/freellmapi.js';
import { loadTools13Manifest, lookupTool13 } from '../packs/tools13/registry.js';
import { seoAuditHtml } from '../packs/tools13/seo.js';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.js';
import { runSandboxCommand, sandboxToolsEnabled } from './sandbox.js';
import { BROWSER_AGENT_TOOLS, runBrowserTool } from './browser.js';
import { webSearch } from '../integrations/search.js';
import { registerBuiltinIntegrations } from '../integrations/adapters.js';
import { integrationStatusReport } from '../integrations/registry.js';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export async function runTool(
  allowed: string[],
  workspaceRoot: string,
  call: ToolCall,
  signal?: AbortSignal,
  context?: {taskId:string;workspaceId:string}
): Promise<{ ok: boolean; name: string; output: string; artifact?: string }> {
  try {
    assertToolAllowed(allowed, call.name);
    if (BROWSER_AGENT_TOOLS.includes(call.name)) {
      // Sessions are keyed per task so concurrent missions cannot share a page.
      return await runBrowserTool(call.name, call.arguments, context?.taskId ?? 'adhoc');
    }
    switch (call.name) {
      case 'run_command': {
        if (!sandboxToolsEnabled()) {
          return { ok: false, name: call.name, output: 'run_command requires authenticated HTTP (HUB_SECRET path)' };
        }
        const result = await runSandboxCommand({
          command: String(call.arguments.command ?? ''),
          cwd: call.arguments.cwd ? String(call.arguments.cwd) : undefined,
          timeout_ms: call.arguments.timeout_ms ? Number(call.arguments.timeout_ms) : undefined,
          signal,
        });
        return { ok: result.ok, name: call.name, output: redactSecrets(result) };
      }
      case 'web_search': {
        const result = await webSearch(String(call.arguments.query ?? ''), signal);
        return { ok: result.ok, name: call.name, output: redactSecrets(result) };
      }
      case 'hub_integrations': {
        registerBuiltinIntegrations();
        return { ok: true, name: call.name, output: redactSecrets(await integrationStatusReport(2_500)) };
      }
      case 'hub_tools13_capabilities': return {ok:true,name:call.name,output:redactSecrets(tools13Capabilities())};
      case 'n8n_workflow_validate': return {ok:true,name:call.name,output:redactSecrets(validateWorkflow(call.arguments.workflow))};
      case 'context_compact': return {ok:true,name:call.name,output:redactSecrets(compactContext(String(call.arguments.text ?? ''),Number(call.arguments.max_lines ?? 200)))};
      case 'html_extract_links': return {ok:true,name:call.name,output:redactSecrets(extractLinks(String(call.arguments.html ?? '')))};
      case 'hub_list_packs':
        return { ok: true, name: call.name, output: JSON.stringify(PACKS, null, 2) };
      case 'hub_list_agents': {
        const pack = call.arguments.pack ? String(call.arguments.pack) : undefined;
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(
            listAgents(pack).map((a) => ({ id: a.id, pack: a.pack, category: a.category, description: a.description })),
            null,
            2
          ),
        };
      }
      case 'hub_full_roster':
        return { ok: true, name: call.name, output: buildBossDirectory() };
      case 'hub_freellmapi_status': {
        const probe = await probeFreellmapi();
        return {
          ok: probe.ok,
          name: call.name,
          output: JSON.stringify({ config: freellmapiStatusSummary(), probe }, null, 2),
        };
      }
      case 'hub_freellmapi_chat': {
        const prompt = String(call.arguments.prompt || call.arguments.message || '');
        if (!prompt.trim()) return { ok: false, name: call.name, output: 'prompt required' };
        try {
          const result = await freellmapiChat({
            system: String(call.arguments.system || 'You are a helpful assistant for Hamza Agent Hub lab.'),
            messages: [{ role: 'user', content: prompt }],
            tools: [],
            model: call.arguments.model ? String(call.arguments.model) : undefined,
          });
          return { ok: true, name: call.name, output: JSON.stringify(result, null, 2) };
        } catch (err) {
          return {
            ok: false,
            name: call.name,
            output: redactSecrets(err instanceof Error ? err.message : String(err)),
          };
        }
      }
      case 'hub_agent_browse': {
        const agentId = call.arguments.agent_id ? String(call.arguments.agent_id) : '';
        if (agentId) {
          const detail = browseAgentDetail(agentId);
          return {
            ok: Boolean(detail.agent),
            name: call.name,
            output: detail.agent
              ? JSON.stringify(detail, null, 2)
              : `unknown agent: ${agentId}`,
          };
        }
        const result = browseEverything({
          query: call.arguments.query ? String(call.arguments.query) : undefined,
          pack: call.arguments.pack ? String(call.arguments.pack) : undefined,
          category: call.arguments.category ? String(call.arguments.category) : undefined,
          limit: call.arguments.limit ? Number(call.arguments.limit) : undefined,
          include_tools13: call.arguments.include_tools13 === false ? false : undefined,
          include_mcp: call.arguments.include_mcp === false ? false : undefined,
        });
        return { ok: true, name: call.name, output: JSON.stringify(result, null, 2) };
      }
      case 'hub_tools13_lookup': {
        const q = String(call.arguments.query || call.arguments.id || '');
        if (!q || q === '*' || q === 'all') {
          return { ok: true, name: call.name, output: JSON.stringify(loadTools13Manifest(), null, 2) };
        }
        const hit = lookupTool13(q);
        return {
          ok: Boolean(hit),
          name: call.name,
          output: hit ? JSON.stringify(hit, null, 2) : `tool13 not found: ${q}`,
        };
      }
      case 'seo_audit_html': {
        const html = String(call.arguments.html || '');
        const url = String(call.arguments.url || 'https://example.com/');
        if (!html.trim()) return { ok: false, name: call.name, output: 'html required' };
        return { ok: true, name: call.name, output: JSON.stringify(seoAuditHtml(html, url), null, 2) };
      }
      case 'film_pack_prepare': {
        const video = String(call.arguments.video_path || '');
        const outRel = String(call.arguments.out_path || 'artifacts/lapian-analysis-pack.zip');
        if (!video) return { ok: false, name: call.name, output: 'video_path required' };
        const script = path.join(ROOT, 'packs/tools13/runtime/lapian-notes/scripts/film_pack.py');
        if (!fs.existsSync(script)) {
          return { ok: false, name: call.name, output: 'film_pack.py missing from tools13 runtime' };
        }
        const outAbs = resolveSafePath(workspaceRoot, outRel);
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        // video path must be inside workspace for safety
        let videoAbs: string;
        try {
          videoAbs = resolveSafePath(workspaceRoot, video);
        } catch {
          return { ok: false, name: call.name, output: 'video_path must be inside the workspace' };
        }
        if (!fs.existsSync(videoAbs)) {
          return {
            ok: false,
            name: call.name,
            output: JSON.stringify({
              ok: false,
              error: 'video file not found in workspace',
              hint: 'Place a video under the workspace then retry. Requires ffmpeg/ffprobe on host.',
            }),
          };
        }
        const interval = Number(call.arguments.interval || 2);
        const maxFrames = Number(call.arguments.max_frames || 36);
        if (!Number.isFinite(interval) || interval < 0.1 || interval > 3600 || !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 120) throw new Error('invalid frame limits');
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn('python3', [script, videoAbs, '--out', outAbs, '--interval', String(interval), '--max-frames', String(maxFrames)], {
            signal, timeout:120_000, stdio:['ignore','pipe','pipe']
          });
          let text = '';
          const collect = (chunk: Buffer) => { text = (text + chunk.toString()).slice(-64_000); };
          child.stdout.on('data', collect); child.stderr.on('data', collect);
          child.on('error', reject);
          child.on('close', code => code === 0 ? resolve(text) : reject(new Error('film pack failed; install ffmpeg/ffprobe')));
        });
        return {ok:true,name:call.name,output:redactSecrets(output),artifact:outRel};
      }
      case 'clean_leads':
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(
            cleanLeads({ text: String(call.arguments.text || ''), csv: String(call.arguments.csv || '') }),
            null,
            2
          ),
        };
      case 'sheets_to_json':
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(
            sheetsToJson({ csv: String(call.arguments.csv || ''), dialect: call.arguments.dialect ? String(call.arguments.dialect) : undefined }),
            null,
            2
          ),
        };
      case 'extract_contacts':
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(
            extractContacts({
              html: String(call.arguments.html || ''),
              url: call.arguments.url ? String(call.arguments.url) : undefined,
            }),
            null,
            2
          ),
        };
      case 'forge_detect':
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(forgeDetect(String(call.arguments.url || '')), null, 2),
        };
      case 'github_url_tricks':
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(githubUrlTricks(String(call.arguments.url || '')), null, 2),
        };
      case 'agent_mining_queries':
        return { ok: true, name: call.name, output: JSON.stringify(agentMiningQueries(), null, 2) };
      case 'workspace_list': {
        const rel = String(call.arguments.path ?? '.');
        const abs = resolveSafePath(workspaceRoot, rel);
        if (!fs.existsSync(abs)) return { ok: false, name: call.name, output: 'path not found' };
        const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
        }));
        return { ok: true, name: call.name, output: JSON.stringify(entries, null, 2) };
      }
      // 68 ECC agents are granted workspace_stat and 32 workspace_mkdir, but
      // neither was ever implemented, so every call returned "unknown tool".
      // The grants are deliberate, so the repair is to implement them under the
      // same path sandbox as the other workspace tools.
      case 'workspace_stat': {
        const rel = String(call.arguments.path ?? '.');
        const abs = resolveSafePath(workspaceRoot, rel);
        if (!fs.existsSync(abs)) return { ok: false, name: call.name, output: 'path not found' };
        const stat = fs.statSync(abs);
        return {
          ok: true,
          name: call.name,
          output: JSON.stringify(
            {
              path: rel,
              type: stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other',
              size_bytes: stat.size,
              modified_at: stat.mtime.toISOString(),
              entries: stat.isDirectory() ? fs.readdirSync(abs).length : null,
            },
            null,
            2
          ),
        };
      }
      case 'workspace_mkdir': {
        const rel = String(call.arguments.path ?? '');
        if (!rel) return { ok: false, name: call.name, output: 'path required' };
        const abs = resolveSafePath(workspaceRoot, rel);
        fs.mkdirSync(abs, { recursive: true });
        return { ok: true, name: call.name, output: `created ${rel}` };
      }
      // Held by five orchestrators so they can see who they may delegate to.
      // Read-only: it exposes no tool grants, only roles and readiness.
      case 'list_specialists': {
        return { ok: true, name: call.name, output: redactSecrets(buildBossDirectory()) };
      }
      case 'workspace_read': {
        const rel = String(call.arguments.path ?? '');
        const abs = resolveSafePath(workspaceRoot, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          return { ok: false, name: call.name, output: 'file not found' };
        }
        if (fs.statSync(abs).size > 1_048_576) throw new Error('file too large');
        return { ok: true, name: call.name, output: redactSecrets(fs.readFileSync(abs, 'utf8')) };
      }
      case 'workspace_write': {
        const rel = String(call.arguments.path ?? '');
        const content = String(call.arguments.content ?? '');
        if (Buffer.byteLength(content) > 1_048_576) throw new Error('content too large');
        const abs = resolveSafePath(workspaceRoot, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, redactSecrets(content), 'utf8');
        return { ok: true, name: call.name, output: `wrote ${rel}`, artifact: rel };
      }
      case 'workspace_grep': {
        const pattern = String(call.arguments.pattern ?? '');
        const rel = String(call.arguments.path ?? '.');
        const abs = resolveSafePath(workspaceRoot, rel);
        if (pattern.length > 200) throw new Error('search pattern too long');
        // Literal matching avoids catastrophic regex backtracking from model input.
        const re = {test: (line: string) => line.toLowerCase().includes(pattern.toLowerCase())};
        const hits: string[] = [];
        const walk = (dir: string, base: string) => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = resolveSafePath(workspaceRoot, path.relative(workspaceRoot, path.join(dir, ent.name)));
            if (hits.length >= 40) return;
            const relPath = path.join(base, ent.name);
            if (ent.isDirectory()) walk(full, relPath);
            else if (ent.isFile()) {
              if (fs.statSync(full).size > 1_048_576) continue;
              const lines = fs.readFileSync(full, 'utf8').split('\n');
              lines.forEach((line, i) => {
                if (re.test(line) && hits.length < 40) hits.push(`${relPath}:${i + 1}:${line.slice(0, 160)}`);
              });
            }
          }
        };
        if (fs.existsSync(abs)) {
          if (fs.statSync(abs).isDirectory()) walk(abs, rel === '.' ? '' : rel);
          else {
            fs.readFileSync(abs, 'utf8')
              .split('\n')
              .forEach((line, i) => {
                if (re.test(line) && hits.length < 40) hits.push(`${rel}:${i + 1}:${line.slice(0, 160)}`);
              });
          }
        }
        return { ok: true, name: call.name, output: redactSecrets(hits.join('\n') || '(no matches)') };
      }
      case 'dispatch_agent': {
        const agentId = String(call.arguments.agent_id || '');
        const subtask = String(call.arguments.subtask || '');
        const target = listAgents().find((a) => a.id === agentId);
        if (!target) return { ok: false, name: call.name, output: `unknown agent ${agentId}` };
        if (['hub-boss','ecc-chief-of-staff'].includes(agentId)) throw new Error('recursive orchestrator dispatch blocked');
        if (!context) throw new Error('dispatch requires task context');
        const {enqueueAgentTask} = await import('../runtime/queue.js');
        const {createHash} = await import('node:crypto');
        const fingerprint = createHash('sha256').update(subtask).digest('hex').slice(0,24);
        const child = enqueueAgentTask({agent_id:agentId,task:subtask,workspace_id:context.workspaceId,
          idempotency_key:`${context.taskId}:${agentId}:${fingerprint}`});
        const assignment = {agent_id:agentId, pack:target.pack, child_task_id:child.task_id, status:child.task.status, subtask};
        const rel = `artifacts/dispatch-${agentId}.json`;
        fs.mkdirSync(resolveSafePath(workspaceRoot,'artifacts'),{recursive:true});
        fs.writeFileSync(resolveSafePath(workspaceRoot,rel),redactSecrets(assignment));
        return {ok:true,name:call.name,output:redactSecrets(assignment),artifact:rel};
      }
      default:
        return { ok: false, name: call.name, output: `unknown tool ${call.name}` };
    }
  } catch (err) {
    return {
      ok: false,
      name: call.name,
      output: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}
