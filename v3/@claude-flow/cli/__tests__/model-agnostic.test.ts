import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAnthropicMessages, executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';
import { completeWithSettings, resolveProviderModel } from '../src/providers/model-router.js';
import {
  chatCompletionsUrl,
  loadRufloSettings,
  summarizeSettings,
  type ProviderConfig,
  type RufloSettings,
} from '../src/providers/model-settings.js';

vi.mock('../src/ruvector/model-router.js', () => ({
  recordModelOutcome: vi.fn(),
  recordModelOutcomeByModelId: vi.fn(),
}));

interface SeenRequest {
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

describe('model settings and fallbacks', () => {
  let dir: string;
  let server: ReturnType<typeof createServer>;
  let port: number;
  let seen: SeenRequest[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-models-'));
    seen = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        seen.push({ url: req.url || '', headers: req.headers, body });
        respond(req, res, body);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as { port: number }).port;
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    for (const key of [
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
      'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OLLAMA_API_KEY', 'OLLAMA_BASE_URL',
      'RUFLO_PROVIDER', 'RUFLO_SETTINGS', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
    ]) vi.stubEnv(key, '');
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('joins chat URLs without a second /v1', () => {
    expect(chatCompletionsUrl('https://ollama.com')).toBe('https://ollama.com/v1/chat/completions');
    expect(chatCompletionsUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(chatCompletionsUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(chatCompletionsUrl('http://127.0.0.1:11434/v1/chat/completions')).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('loads one settings file, resolves env refs, and omits secrets from the summary', () => {
    writeFileSync(join(dir, 'ruflo.settings.json'), JSON.stringify({
      fallbacks: true,
      providers: [
        { id: 'groq', preset: 'groq', apiKey: 'env:GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
        { id: 'openai', preset: 'openai', apiKey: '${OPENAI_API_KEY}' },
        { id: 'local', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
      ],
    }));
    const settings = loadRufloSettings(dir, { GROQ_API_KEY: 'gsk_test_secret_value' });
    expect(settings?.providers.map(provider => provider.id)).toEqual(['groq', 'openai', 'local']);
    expect(settings?.providers[0].enabled).toBe(true);
    expect(settings?.providers[0].apiKey).toBe('gsk_test_secret_value');
    expect(settings?.providers[1].enabled).toBe(false);
    expect(settings?.providers[1].skipReason).toContain('OPENAI_API_KEY');
    expect(settings?.providers[2].enabled).toBe(true);
    expect(settings?.providers[2].apiKey).toBeUndefined();
    const summary = JSON.stringify(summarizeSettings(settings!));
    expect(summary).not.toContain('gsk_test_secret_value');
    expect(summary).toContain('"apiKey":"set"');
  });

  it('rejects credentials embedded in a base URL', () => {
    writeFileSync(join(dir, 'ruflo.settings.json'), JSON.stringify({
      providers: [{ id: 'bad', protocol: 'openai', baseUrl: 'http://user:secret@127.0.0.1:9/v1', model: 'x' }],
    }));
    expect(() => loadRufloSettings(dir)).toThrow(/must not contain credentials/);
  });

  it('falls back from a 503 to the next provider and redacts a key echoed by the server', async () => {
    const secret = 'sk-test-secret-value';
    const settings = settingsFor(port, secret);
    const result = await completeWithSettings(settings, { prompt: 'ping', systemPrompt: 'be brief' });
    expect(result.success).toBe(true);
    expect(result.providerId).toBe('backup');
    expect(result.output).toBe('backup-ok');
    expect(result.fallbackHistory?.[0].providerId).toBe('primary');
    expect(result.fallbackHistory?.[0].error).not.toContain(secret);
    expect(result.fallbackHistory?.[0].error).toContain('[redacted]');
    expect(seen.map(request => request.url)).toEqual([
      '/fail/v1/chat/completions',
      '/ok/v1/chat/completions',
    ]);
    expect(seen[1].body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'ping' },
    ]);
  });

  it('does not fall back on a 400 that is about the prompt', async () => {
    const settings: RufloSettings = {
      version: 1,
      fallbacks: true,
      sourcePath: 'memory',
      providers: [
        provider('bad-request', 'openai', `http://127.0.0.1:${port}/bad-request`, 'm'),
        provider('backup', 'openai', `http://127.0.0.1:${port}/ok`, 'm'),
      ],
    };
    const result = await completeWithSettings(settings, { prompt: 'ping' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/API error 400/);
    expect(seen).toHaveLength(1);
  });

  it('speaks Gemini and Anthropic against the local server and keeps the key out of the URL', async () => {
    const secret = 'AIzaSyTestKeyValue1234567890';
    const gemini = await completeWithSettings({
      version: 1,
      fallbacks: false,
      sourcePath: 'memory',
      providers: [provider('gemini', 'gemini', `http://127.0.0.1:${port}`, 'gemini-2.0-flash', secret)],
    }, { prompt: 'ping', systemPrompt: 'sys' });
    expect(gemini.success).toBe(true);
    expect(gemini.output).toBe('gemini-ok');
    expect(seen.at(-1)?.url).toBe('/v1beta/models/gemini-2.0-flash:generateContent');
    expect(seen.at(-1)?.url).not.toContain(secret);
    expect(seen.at(-1)?.headers['x-goog-api-key']).toBe(secret);

    const anthropic = await completeWithSettings({
      version: 1,
      fallbacks: false,
      sourcePath: 'memory',
      providers: [provider('anthropic', 'anthropic', `http://127.0.0.1:${port}`, 'claude-sonnet-4-6', 'sk-ant-test')],
    }, { prompt: 'ping', systemPrompt: 'sys', model: 'sonnet' });
    expect(anthropic.success).toBe(true);
    expect(anthropic.output).toBe('anthropic-ok');
    expect(seen.at(-1)?.url).toBe('/v1/messages');
    const anthropicBody = seen.at(-1)?.body as { model: string; temperature?: number };
    expect(anthropicBody.model).toBe('claude-sonnet-4-6');
    expect(anthropicBody.temperature).toBe(0.7);
  });

  it('keeps a logical Claude tier off a non-Anthropic provider', () => {
    const local = provider('ollama', 'openai', 'http://127.0.0.1:11434/v1', 'llama3.2');
    expect(resolveProviderModel(local, 'sonnet')).toBe('llama3.2');
    expect(resolveProviderModel(local, 'qwen2.5:7b')).toBe('qwen2.5:7b');
  });

  it('callAnthropicMessages uses the settings file, then a fallback provider', async () => {
    writeFileSync(join(dir, 'ruflo.settings.json'), JSON.stringify({
      fallbacks: true,
      providers: [
        { id: 'primary', protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/fail`, model: 'first', apiKey: 'sk-test-secret-value' },
        { id: 'backup', protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/ok`, model: 'second', apiKey: 'env:MISSING_BACKUP_KEY' },
        { id: 'local', protocol: 'openai', baseUrl: `http://127.0.0.1:${port}/ok`, model: 'third' },
      ],
    }));
    const result = await callAnthropicMessages({ prompt: 'ping' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('backup-ok');
    expect(result.model).toBe('mock-third');
    expect(result.providerFallback?.map(item => item.providerId)).toEqual(['primary']);
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-value');
  });

  it('does not rewrite a self-hosted Ollama base that already ends in /v1, and uses a local model tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'local', model: 'llama3.2',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RUFLO_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1');
    const result = await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('llama3.2');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('still sends the cloud model when Ollama is the public endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cloud', model: 'gpt-oss:120b-cloud',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OLLAMA_API_KEY', 'ollama-test');
    const result = await callAnthropicMessages({ prompt: 'ping', provider: 'ollama' });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ollama.com/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-oss:120b-cloud');
  });

  it('uses a persisted OpenRouter entry when no environment key is set', async () => {
    writeFileSync(join(dir, 'claude-flow.config.json'), JSON.stringify({
      agents: { providers: [{ name: 'openrouter', enabled: true, apiKey: 'or-test', baseUrl: `http://127.0.0.1:${port}/ok`, model: 'openai/gpt-4o-mini' }] },
    }));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), headers: {}, body: JSON.parse(String(init.body)) });
      return {
        ok: true,
        json: async () => ({
          id: 'or', model: 'openai/gpt-4o-mini',
          choices: [{ message: { content: 'from-config' }, finish_reason: 'stop' }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await callAnthropicMessages({ prompt: 'ping' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('from-config');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://127.0.0.1:${port}/ok/v1/chat/completions`);
  });

  it('refuses an unknown provider instead of silently calling Anthropic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const result = await callAnthropicMessages({ prompt: 'ping', provider: 'groq' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ruflo.settings.json');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the agent file body as the system prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const agents = join(dir, '.ruflo', 'agents');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'researcher.md'), `---
name: researcher
description: Test researcher
---

UNIQUE_RESEARCHER_SENTINEL You only answer with the sources you were given.
`);
    mkdirSync(join(dir, '.claude-flow', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), JSON.stringify({
      version: '3.0.0',
      agents: {
        worker: {
          agentId: 'worker', agentType: 'researcher', status: 'idle', health: 1,
          taskCount: 0, config: {}, createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }));
    const result = await executeAgentTask({ agentId: 'worker', prompt: 'find the note' });
    expect(result.success).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system[0].text).toContain('UNIQUE_RESEARCHER_SENTINEL');
  });
});

function respond(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
  const url = req.url || '';
  if (url.includes('/fail/')) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'down sk-test-secret-value' }));
    return;
  }
  if (url.includes('/bad-request/')) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad prompt' }));
    return;
  }
  if (url.includes('/v1/messages')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', model: body.model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'anthropic-ok' }],
      usage: { input_tokens: 2, output_tokens: 1 },
    }));
    return;
  }
  if (url.includes(':generateContent')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'gemini-ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'chat_test',
    model: `mock-${body.model}`,
    choices: [{ message: { role: 'assistant', content: 'backup-ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }));
}

function provider(
  id: string,
  protocol: ProviderConfig['protocol'],
  baseUrl: string,
  model: string,
  apiKey?: string,
): ProviderConfig {
  return { id, protocol, baseUrl, model, apiKey, enabled: true };
}

function settingsFor(port: number, secret: string): RufloSettings {
  return {
    version: 1,
    fallbacks: true,
    sourcePath: 'memory',
    providers: [
      provider('primary', 'openai', `http://127.0.0.1:${port}/fail`, 'first', secret),
      provider('backup', 'openai', `http://127.0.0.1:${port}/ok`, 'second', 'backup-key'),
    ],
  };
}

describe('example settings file', () => {
  it('loads with no secrets present and skips providers whose env vars are unset', () => {
    const example = new URL('../../../../ruflo.settings.example.json', import.meta.url);
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-example-'));
    try {
      writeFileSync(join(dir, 'ruflo.settings.json'), readFileSync(example));
      const settings = loadRufloSettings(dir, {});
      const summary = JSON.stringify(summarizeSettings(settings!));
      expect(summary).not.toMatch(/sk-|gsk_|AIza/);
      const byId = Object.fromEntries(settings!.providers.map(provider => [provider.id, provider]));
      expect(byId.ollama.enabled).toBe(true);
      expect(byId.groq.enabled).toBe(false);
      expect(byId.gemini.protocol).toBe('gemini');
      expect(byId.anthropic.protocol).toBe('anthropic');
      expect(byId['local-gateway'].enabled).toBe(false);
      expect(byId['local-gateway'].baseUrl.endsWith('/v1')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
