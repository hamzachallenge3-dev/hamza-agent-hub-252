import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createAgentFile,
  instructionsForAgent,
  loadAgentCatalog,
  resolveSpawnAgentType,
  type AgentDefinition,
} from '../src/agents/agent-catalog.js';
import { completeWithSettings } from '../src/providers/model-router.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('agent catalog', () => {
  it('loads every shipped agent file and dispatches each prompt to a local model', async () => {
    const catalog = loadAgentCatalog(repoRoot);
    const broken = catalog.definitions.filter(definition => definition.issues.length > 0);
    expect(broken.map(definition => `${definition.source}: ${definition.issues.join(', ')}`)).toEqual([]);
    expect(catalog.definitions.length).toBeGreaterThan(100);

    const seen: Array<{ system: string; user: string }> = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          messages: Array<{ role: string; content: string }>;
        };
        const system = body.messages.find(message => message.role === 'system')?.content ?? '';
        const user = body.messages.find(message => message.role === 'user')?.content ?? '';
        seen.push({ system, user });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'ack',
          model: 'mock',
          choices: [{ message: { role: 'assistant', content: `ack:${user}` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const failures: string[] = [];
      for (const definition of catalog.definitions) {
        const result = await completeWithSettings({
          version: 1,
          fallbacks: false,
          sourcePath: 'memory',
          providers: [{
            id: 'mock',
            protocol: 'openai',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            model: 'mock',
            enabled: true,
          }],
        }, {
          prompt: `probe:${definition.name}`,
          systemPrompt: definition.instructions,
        });
        const sent = seen.at(-1);
        if (!result.success || result.output !== `ack:probe:${definition.name}`) {
          failures.push(`${definition.source} dispatch failed: ${result.error || result.output}`);
        } else if (!sent?.system.includes(definition.instructions.slice(0, 80))) {
          failures.push(`${definition.source} system prompt was not forwarded`);
        }
      }
      expect(failures).toEqual([]);
      expect(seen).toHaveLength(catalog.definitions.length);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }

    const winners = new Map<string, AgentDefinition>();
    for (const definition of catalog.definitions) {
      if (!winners.has(definition.name)) winners.set(definition.name, definition);
    }
    writeFileSync('/tmp/ruflo-agent-inventory.json', JSON.stringify({
      files: catalog.definitions.length,
      uniqueNames: winners.size,
      duplicates: catalog.duplicates,
      agents: catalog.definitions.map(definition => ({
        name: definition.name,
        source: definition.source,
        description: definition.description,
        claimedCapabilities: definition.claimedCapabilities,
        declaredTools: definition.declaredTools,
        kind: definition.kind,
        shadowed: catalog.duplicates.some(duplicate => duplicate.name === definition.name && duplicate.sources[0] !== definition.source),
      })),
    }, null, 2));
    expect(catalog.duplicates.some(duplicate => duplicate.name === 'researcher')).toBe(true);
    expect(winners.get('coder')?.instructions.length).toBeGreaterThan(40);
    expect(instructionsForAgent(repoRoot, 'Benchmark Suite')).toContain('Benchmark');
    expect(resolveSpawnAgentType(repoRoot, 'Benchmark Suite')).toBe('benchmark-suite');
    expect(resolveSpawnAgentType(repoRoot, 'not a real agent')).toBe('not-a-real-agent');
    expect(resolveSpawnAgentType(repoRoot, 'bench;rm')).toBeNull();
    expect(resolveSpawnAgentType(repoRoot, 'coder')).toBe('coder');
  }, 60_000);

  it('lets a .ruflo agent override a shipped agent of the same name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-agents-'));
    try {
      mkdirSync(join(dir, '.claude', 'agents', 'core'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'agents', 'core', 'coder.md'), `---
name: coder
description: shipped
---

Shipped coder instructions that are long enough to count as a prompt body.
`);
      const template = fileURLToPath(new URL('../../../../templates/agent.md', import.meta.url));
      createAgentFile({
        projectRoot: dir,
        name: 'coder',
        description: 'Custom coder',
        templatePath: template,
      });
      const instructions = instructionsForAgent(dir, 'coder');
      expect(instructions).toContain('Custom coder');
      expect(instructions).not.toContain('Shipped coder instructions');
      expect(() => createAgentFile({
        projectRoot: dir,
        name: '../escape',
        description: 'nope',
        templatePath: template,
      })).toThrow(/Agent name/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates an agent from the script and loads the JSON form', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-new-agent-'));
    try {
      const script = fileURLToPath(new URL('../../../../scripts/new-agent.mjs', import.meta.url));
      const written = execFileSync(process.execPath, [script, 'migration-reviewer', 'Reviews SQL migrations'], {
        env: { ...process.env, RUFLO_AGENT_ROOT: dir },
        encoding: 'utf8',
      }).trim();
      expect(written.endsWith('.ruflo/agents/migration-reviewer.md')).toBe(true);
      const fromScript = loadAgentCatalog(dir).definitions.find(definition => definition.name === 'migration-reviewer');
      expect(fromScript?.issues).toEqual([]);
      expect(fromScript?.description).toBe('Reviews SQL migrations');

      writeFileSync(join(dir, '.ruflo', 'agents', 'json-reviewer.json'), JSON.stringify({
        name: 'json-reviewer',
        description: 'JSON configured reviewer',
        instructions: 'You review JSON configuration and quote the key you think is wrong before suggesting a replacement.',
        tools: ['Read'],
      }));
      const fromJson = loadAgentCatalog(dir).definitions.find(definition => definition.name === 'json-reviewer');
      expect(fromJson?.declaredTools).toEqual(['Read']);
      expect(fromJson?.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
