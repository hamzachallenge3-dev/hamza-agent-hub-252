/**
 * The body of `swarm coordinate`. The CLI entry and the command action
 * both call this. It loads the planner, coder, and tester prompts and
 * hands a spec file from one to the next.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHandoff } from './handoff.mjs';
import { swarmUseHubAgent } from './hub-bridge.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function groqComplete() {
  const { createGroqClient, FatalGroqError, redact } = await import('../eval-groq.mjs');
  if (!process.env.GROQ_API_KEY) throw new FatalGroqError('GROQ_API_KEY is unset');
  const client = createGroqClient({ model: GROQ_MODEL });
  await client.confirm();
  const outputs = [];
  const complete = async ({ role, system, prompt, json }) => {
    let content;
    try {
      content = await client.chat(
        [
          { role: 'system', content: String(system || '') },
          { role: 'user', content: prompt },
        ],
        json ? 600 : 500,
        0,
        Boolean(json),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(redact(message));
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`${role} Groq response was empty`);
    }
    outputs.push({ role, model: GROQ_MODEL, content });
    return content;
  };
  return { complete, outputs, stats: () => client.stats() };
}

export async function runCoordinateHandoff({ out, provider } = {}) {
  const workDir = out ? resolve(out) : mkdtempSync(join(tmpdir(), 'ruflo-coordinate-'));
  const selected = provider || 'local';
  if (selected !== 'local' && selected !== 'groq') {
    throw new Error(`Unsupported coordinate provider: ${selected}`);
  }
  const groq = selected === 'groq' ? await groqComplete() : null;
  const receipt = await runHandoff({
    repoRoot,
    workDir,
    task: { kind: 'is-even' },
    complete: groq?.complete,
  });
  const hub = await swarmUseHubAgent({ agentId: 'hub-agent-browse', query: 'planner' });
  return {
    command: 'swarm coordinate',
    workDir,
    provider: selected,
    ...(groq ? { model: GROQ_MODEL, groq: groq.stats() } : {}),
    ...receipt,
    hub,
  };
}
