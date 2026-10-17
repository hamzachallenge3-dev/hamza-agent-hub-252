import { loadTools13Manifest } from './registry.js';
import { redactSecrets } from '../../security/redact.js';

/** Local alternatives; these do not pretend to run upstream services. */
export function tools13Capabilities() {
  const local: Record<string, string> = {
    'seo-audit': 'seo_audit_html', 'n8n-library': 'n8n_workflow_validate (local validation only)',
    scrapling: 'html_extract_links (local extraction only)', headroom: 'context_compact (local line dedupe only)',
    'ecc-68': 'run_agent (heuristic scaffold or configured live model)',
  };
  return loadTools13Manifest().map(t => ({
    id:t.id, status:local[t.id] ? 'LOCAL_ALTERNATIVE' : 'BLOCKED',
    runner:local[t.id] ?? null,
    hint: t.id === 'lapian-notes'
      ? 'film_pack_prepare is agent-only; install ffmpeg/ffprobe and provide a workspace video'
      : local[t.id] ? 'No external API calls / يعمل محلياً' : `Install and configure upstream manually: ${t.source}. No service started / الخدمة غير مفعلة`,
  }));
}
export function validateWorkflow(workflow: unknown) {
  const w = workflow as {nodes?: Array<{name?:string;type?:string}>; connections?: Record<string,unknown>;active?:boolean};
  const errors: string[] = [], warnings: string[] = [];
  if (!w || !Array.isArray(w.nodes)) return {ok:false, errors:['nodes array required / قائمة العقد مطلوبة'], warnings};
  const names = new Set<string>();
  for(const node of w.nodes) {
    if (!node || !node.name || !node.type) {errors.push('Each node needs name and type'); continue;}
    if(names.has(node.name)) errors.push(`Duplicate node: ${node.name}`);
    names.add(node.name);
    if(/executeCommand|ssh|httpRequest|code/i.test(node.type)) warnings.push(`Review external/code node: ${node.name}`);
  }
  for(const key of Object.keys(w.connections ?? {})) if(!names.has(key)) errors.push(`Unknown source node: ${key}`);
  if(w.active) warnings.push('Workflow marked active; this tool never activates workflows');
  return {ok:errors.length===0,nodes:w.nodes.length,errors,warnings,executed:false};
}
export function compactContext(text: string, maxLines=200) {
  const lines = redactSecrets(text).split('\n');
  const unique = [...new Set(lines)];
  // Preserve error evidence ahead of low-priority repeated context.
  const important = unique.filter(l => /fatal|error|exception|أخطاء/i.test(l));
  const rest = unique.filter(l => !important.includes(l));
  const selected = [...important,...rest].slice(0,Math.min(1000,Math.max(1,maxLines)));
  return {text:selected.join('\n'),input_lines:lines.length,output_lines:selected.length,truncated:selected.length<unique.length,method:'line dedupe, error-first'};
}
export function extractLinks(html: string) {
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  return {links:[...new Set(links.filter(l => /^(https?:\/\/|\/|#)/i.test(l)))].slice(0,1000), fetched:false};
}
