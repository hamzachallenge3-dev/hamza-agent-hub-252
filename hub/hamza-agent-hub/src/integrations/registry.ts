/**
 * Integration registry and shared HTTP plumbing.
 *
 * Adapters register themselves here; the Boss asks the registry which
 * integration satisfies a capability. Adding a provider never touches Boss
 * logic.
 */
import { credential, credentialSource } from './credentials.js';
import {
  integrationError,
  kindForStatus,
  type Integration,
  type IntegrationError,
  type IntegrationHealth,
} from './types.js';

const registry = new Map<string, Integration>();

export function registerIntegration(integration: Integration): void {
  registry.set(integration.id, integration);
}

export function listIntegrations(): Integration[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getIntegration(id: string): Integration | null {
  return registry.get(id) ?? null;
}

export function integrationsForCapability(capability: string): Integration[] {
  return listIntegrations().filter((i) => i.capabilities.includes(capability));
}

/**
 * Circuit breaker, shared by every adapter. A provider that has failed three
 * times in a row is skipped for a minute instead of being retried on every call.
 */
const breakers = new Map<string, { failures: number; openUntil: number }>();

export function recordIntegrationResult(id: string, ok: boolean): void {
  const b = breakers.get(id) ?? { failures: 0, openUntil: 0 };
  if (ok) {
    breakers.set(id, { failures: 0, openUntil: 0 });
    return;
  }
  b.failures += 1;
  if (b.failures >= 3) b.openUntil = Date.now() + 60_000;
  breakers.set(id, b);
}

export function integrationBreakerOpen(id: string): boolean {
  const b = breakers.get(id);
  return Boolean(b && b.openUntil > Date.now());
}

export function resetIntegrationBreakers(): void {
  breakers.clear();
}

/** Token-bucket quota per integration, enforced before the request leaves. */
const quotas = new Map<string, { minuteStart: number; minuteCount: number; dayStart: number; dayCount: number }>();

export function checkQuota(
  id: string,
  limits: { requestsPerMinute: number | null; requestsPerDay: number | null }
): { allowed: boolean; reason?: string; retryAfterMs?: number } {
  const now = Date.now();
  const q = quotas.get(id) ?? { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
  if (now - q.minuteStart >= 60_000) {
    q.minuteStart = now;
    q.minuteCount = 0;
  }
  if (now - q.dayStart >= 86_400_000) {
    q.dayStart = now;
    q.dayCount = 0;
  }
  if (limits.requestsPerMinute !== null && q.minuteCount >= limits.requestsPerMinute) {
    quotas.set(id, q);
    return {
      allowed: false,
      reason: `local rate limit reached (${limits.requestsPerMinute}/min) for ${id}`,
      retryAfterMs: 60_000 - (now - q.minuteStart),
    };
  }
  if (limits.requestsPerDay !== null && q.dayCount >= limits.requestsPerDay) {
    quotas.set(id, q);
    return {
      allowed: false,
      reason: `local daily quota reached (${limits.requestsPerDay}/day) for ${id}`,
      retryAfterMs: 86_400_000 - (now - q.dayStart),
    };
  }
  q.minuteCount += 1;
  q.dayCount += 1;
  quotas.set(id, q);
  return { allowed: true };
}

export function quotaUsage(id: string) {
  const q = quotas.get(id);
  return q ? { minute: q.minuteCount, day: q.dayCount } : { minute: 0, day: 0 };
}

export function resetQuotas(): void {
  quotas.clear();
}

export interface HttpJsonOptions {
  integration: string;
  operation: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * One HTTP path for every adapter, so errors are normalised identically and no
 * adapter invents its own retry or error vocabulary.
 */
export async function httpJson<T>(opts: HttpJsonOptions): Promise<T> {
  if (integrationBreakerOpen(opts.integration)) {
    throw integrationError(
      opts.integration,
      opts.operation,
      'circuit_open',
      `${opts.integration} is in a cool-down after repeated failures`,
      'Wait for the breaker to close (60s) or fix the upstream, then retry.'
    );
  }
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!res.ok) {
      recordIntegrationResult(opts.integration, false);
      const kind = kindForStatus(res.status);
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      throw integrationError(
        opts.integration,
        opts.operation,
        kind,
        `HTTP ${res.status} from ${opts.integration}`,
        recoveryFor(kind, opts.integration),
        Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined
      );
    }
    recordIntegrationResult(opts.integration, true);
    return (await res.json()) as T;
  } catch (err) {
    if (isIntegrationError(err)) throw err;
    recordIntegrationResult(opts.integration, false);
    const message = err instanceof Error ? err.message : String(err);
    const kind = /abort|timeout/i.test(message) ? 'timeout' : 'unavailable';
    throw integrationError(opts.integration, opts.operation, kind, message, recoveryFor(kind, opts.integration));
  }
}

export function isIntegrationError(err: unknown): err is IntegrationError {
  return Boolean(err && typeof err === 'object' && 'kind' in err && 'recovery' in err && 'integration' in err);
}

function recoveryFor(kind: IntegrationError['kind'], id: string): string {
  switch (kind) {
    case 'unauthorized':
      return `Set a valid credential for ${id}. Check the integration's auth.env names.`;
    case 'forbidden':
      return `The credential for ${id} lacks the required scope for this operation.`;
    case 'rate_limited':
      return `Back off and retry after the Retry-After window; ${id} enforces a free-tier rate limit.`;
    case 'quota_exceeded':
      return `The free-tier quota for ${id} is exhausted. The Hub will not enable a paid tier automatically.`;
    case 'timeout':
      return `${id} did not respond in time. Retry once; if it persists treat the integration as BLOCKED.`;
    case 'unavailable':
      return `${id} is unreachable. Verify the endpoint and network egress rules.`;
    case 'not_found':
      return `The requested resource does not exist on ${id}. Verify the identifier.`;
    default:
      return `Inspect the error detail and the ${id} integration configuration.`;
  }
}

/** Standard `/health`-style probe for adapters that expose a cheap GET. */
export async function probeEndpoint(
  integration: Integration,
  url: string,
  headers: Record<string, string>,
  timeoutMs = 4_000
): Promise<IntegrationHealth> {
  if (!integration.configured()) {
    return {
      id: integration.id,
      configured: false,
      ok: false,
      readiness: 'BLOCKED',
      latency_ms: null,
      detail: integration.auth.hint,
    };
  }
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    const latency = Date.now() - started;
    if (!res.ok) {
      return {
        id: integration.id,
        configured: true,
        ok: false,
        readiness: res.status === 401 || res.status === 403 ? 'BLOCKED' : 'LIMITED',
        latency_ms: latency,
        detail: `HTTP ${res.status}`,
      };
    }
    return { id: integration.id, configured: true, ok: true, readiness: 'READY', latency_ms: latency, detail: 'reachable' };
  } catch (err) {
    return {
      id: integration.id,
      configured: true,
      ok: false,
      readiness: 'BLOCKED',
      latency_ms: Date.now() - started,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }
}

/**
 * Public status for every integration: identity, auth requirement, operations,
 * readiness, scopes, limits, cost. Never includes a credential value.
 */
export async function integrationStatusReport(timeoutMs = 3_000) {
  const integrations = listIntegrations();
  const health = await Promise.all(integrations.map((i) => i.health(timeoutMs)));
  const byId = new Map(health.map((h) => [h.id, h]));
  return {
    count: integrations.length,
    configured: integrations.filter((i) => i.configured()).length,
    ready: health.filter((h) => h.readiness === 'READY').length,
    integrations: integrations.map((i) => ({
      id: i.id,
      label: i.label,
      category: i.category,
      provider: i.provider,
      auth: {
        kind: i.auth.kind,
        env: i.auth.env,
        hint: i.auth.hint,
        // Presence and origin only — the value never crosses this boundary.
        credential_source: credentialSource(i.auth.env),
      },
      capabilities: i.capabilities,
      operations: i.operations.map((o) => ({
        id: o.id,
        description: o.description,
        input: o.input,
        output: o.output,
        scopes: o.scopes,
        mutating: o.mutating,
        requires_approval: o.requiresApproval,
      })),
      limits: i.limits,
      cost: i.cost,
      quota_usage: quotaUsage(i.id),
      breaker_open: integrationBreakerOpen(i.id),
      configured: i.configured(),
      health: byId.get(i.id) ?? null,
    })),
  };
}

/** Helper for adapters: a credential is present under any of these env names. */
export function hasCredential(names: string[]): boolean {
  return Boolean(credential(names));
}
