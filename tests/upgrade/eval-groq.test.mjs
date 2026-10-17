import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDuration,
  classifyGroqStatus,
  paceWaitMs,
  redact,
  createGroqClient,
  DailyLimitError,
} from '../../scripts/eval-groq.mjs';

test('parseDuration reads Groq reset headers', () => {
  assert.equal(parseDuration('825ms'), 825);
  assert.equal(parseDuration('7.66s'), 7660);
  assert.equal(parseDuration('1m26.4s'), 86400);
  assert.equal(parseDuration('2'), 2000);
});

test('classifyGroqStatus separates daily limits from per-minute 429s', () => {
  assert.equal(classifyGroqStatus(429, 'tokens per minute (TPM): Limit 8000'), 'minute');
  assert.equal(classifyGroqStatus(429, 'tokens per day (TPD): Limit 200000'), 'daily');
  assert.equal(classifyGroqStatus(429, 'requests per day (RPD): Limit 1000'), 'daily');
  assert.equal(classifyGroqStatus(403, 'error code: 1010'), 'retry');
  assert.equal(classifyGroqStatus(200, '{}'), 'ok');
  assert.equal(classifyGroqStatus(400, 'bad request'), 'fatal');
});

test('paceWaitMs holds a call that would pass the token cap', () => {
  const now = 10_000;
  const decision = paceWaitMs({
    requests: [9_000],
    tokens: [{ at: 9_000, tokens: 90 }],
    remainingTokens: null,
    tokenResetAt: 0,
  }, 20, now, { rpm: 20, tpm: 100, windowMs: 60_000 });
  assert.equal(decision.wait, 59_000);
});

test('redact removes the live secret and bearer tokens', () => {
  const secret = 'gsk_FAKEFAKEFAKEnotARealKey';
  const text = redact(`Authorization: Bearer ${secret} failed`, secret);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('gsk_'), false);
});

test('a per-minute 429 is retried and a daily 429 stops', async () => {
  let clock = 0;
  let calls = 0;
  const key = 'gsk_FAKEFAKEFAKEnotARealKey';
  const client = createGroqClient({
    model: 'openai/gpt-oss-120b',
    apiKey: key,
    now: () => clock,
    sleep: async ms => { clock += ms; },
    log: () => {},
    caps: { rpm: 20, tpm: 6800, windowMs: 60_000 },
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          headers: { get: name => (name === 'retry-after' ? '1' : null) },
          text: async () => `tokens per minute near ${key}`,
        };
      }
      return {
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
          usage: { total_tokens: 12 },
        }),
      };
    },
  });
  const content = await client.chat([{ role: 'user', content: 'ping' }], 32, 0, false);
  assert.equal(content, 'pong');
  assert.equal(calls, 2);
  assert.equal(clock >= 1000, true);

  const stopped = createGroqClient({
    model: 'openai/gpt-oss-120b',
    apiKey: key,
    now: () => 0,
    sleep: async () => {},
    log: () => {},
    fetch: async () => ({
      status: 429,
      headers: { get: () => null },
      text: async () => `tokens per day (TPD) exhausted ${key}`,
    }),
  });
  await assert.rejects(
    () => stopped.chat([{ role: 'user', content: 'ping' }], 32, 0, false),
    error => {
      assert.equal(error instanceof DailyLimitError, true);
      assert.equal(String(error.message).includes(key), false);
      return true;
    },
  );
});
