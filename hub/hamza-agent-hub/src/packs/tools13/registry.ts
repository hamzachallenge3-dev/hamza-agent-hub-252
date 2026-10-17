import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../config.js';

export interface Tool13Entry {
  id: string;
  name: string;
  category: string;
  source: string;
  type: string;
  plugin_id: string | null;
  offline_file: string | null;
  tested: string;
  note: string;
  agent_id: string;
  runtime_ready: boolean;
}

export function loadTools13Manifest(): Tool13Entry[] {
  const manifestPath = path.join(ROOT, 'packs/tools13/TOOLS_MANIFEST.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    tools: Array<{
      id: string;
      name: string;
      category: string;
      source: string;
      type: string;
      plugin_id: string | null;
      offline_file: string | null;
      tested: string;
      note: string;
    }>;
  };
  return m.tools.map((t) => {
    const offlineAbs = t.offline_file ? path.join(ROOT, 'packs/tools13', t.offline_file) : null;
    const runtimeReady =
      (t.id === 'seo-audit' && fs.existsSync(path.join(ROOT, 'packs/tools13/runtime/seo-audit/scripts/seo_audit.py'))) ||
      (t.id === 'lapian-notes' && fs.existsSync(path.join(ROOT, 'packs/tools13/runtime/lapian-notes/scripts/film_pack.py'))) ||
      (t.id === 'ecc-68' && fs.existsSync(path.join(ROOT, 'packs/ecc68/agents.json'))) ||
      Boolean(offlineAbs && fs.existsSync(offlineAbs));
    return {
      ...t,
      agent_id: `tool13-${t.id}`,
      runtime_ready: runtimeReady,
    };
  });
}

export function lookupTool13(idOrName: string): Tool13Entry | null {
  const q = idOrName.toLowerCase();
  return (
    loadTools13Manifest().find(
      (t) =>
        t.id === q ||
        t.agent_id === q ||
        t.name.toLowerCase().includes(q) ||
        `tool13-${t.id}` === q
    ) || null
  );
}
