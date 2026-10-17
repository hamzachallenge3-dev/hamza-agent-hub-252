/**
 * Integration framework.
 *
 * The Hub was hardwired to one model endpoint and one desk URL, so adding any
 * external service meant editing the Boss. An integration is now a plugin
 * adapter that declares its identity, auth requirements, operations, readiness,
 * permissions, limits and costs, and is discovered from a registry the Boss
 * never has to know about.
 *
 * Two rules every adapter obeys:
 *   - a paid tier is never enabled implicitly; `cost.paid` adapters stay
 *     unconfigured without explicit opt-in;
 *   - credentials come from the credential store, never from a literal.
 */

export type IntegrationCategory = 'model' | 'search' | 'development' | 'automation' | 'productivity';

export type IntegrationReadiness = 'READY' | 'LIMITED' | 'BLOCKED' | 'UNTESTED';

export interface IntegrationAuth {
  /** How this provider authenticates. */
  kind: 'none' | 'api_key' | 'bearer' | 'oauth';
  /** Environment variable names that may supply the credential. Values are never read into a response. */
  env: string[];
  /** What the user must do to obtain it. */
  hint: string;
}

export interface IntegrationOperation {
  id: string;
  description: string;
  /** JSON-schema-ish input shape; kept declarative so it can be published. */
  input: Record<string, string>;
  output: Record<string, string>;
  /** Scopes or permissions this operation needs. */
  scopes: string[];
  /** True when the operation changes remote state. */
  mutating: boolean;
  /** True when the operation needs explicit human approval before running. */
  requiresApproval: boolean;
}

export interface IntegrationLimits {
  /** Documented free-tier request ceiling, or null when undocumented. */
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  /** What the Hub does when the limit is hit. */
  onExceeded: string;
}

export interface IntegrationCost {
  /** True when any call on the configured tier can be billed. */
  paid: boolean;
  /** Free-tier description, so the operator can verify it before enabling. */
  freeTier: string;
  /** The env var that must be set to 1 before a paid tier may be used. */
  paidOptInEnv?: string;
}

/** Normalised error shape so every integration fails the same way. */
export interface IntegrationError {
  integration: string;
  operation: string;
  kind:
    | 'not_configured'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'quota_exceeded'
    | 'unavailable'
    | 'timeout'
    | 'bad_request'
    | 'circuit_open'
    | 'needs_approval'
    | 'unknown';
  message: string;
  /** What the caller should do next. */
  recovery: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface IntegrationHealth {
  id: string;
  configured: boolean;
  ok: boolean;
  readiness: IntegrationReadiness;
  latency_ms: number | null;
  detail: string;
  /** Result of the adapter's own smoke test, when it has one. */
  smoke_test?: { ran: boolean; passed: boolean; detail: string };
}

export interface Integration {
  id: string;
  label: string;
  category: IntegrationCategory;
  /** Upstream provider identity, so an operator can verify what is being called. */
  provider: { name: string; homepage: string; docs: string };
  auth: IntegrationAuth;
  operations: IntegrationOperation[];
  limits: IntegrationLimits;
  cost: IntegrationCost;
  /** Capability ids this integration can satisfy for the Boss. */
  capabilities: string[];
  /** True when every required credential/endpoint is present. */
  configured(): boolean;
  /** Live readiness probe. Must never throw. */
  health(timeoutMs?: number): Promise<IntegrationHealth>;
  /** Execute an operation. Must reject with an IntegrationError-shaped object. */
  call?(operation: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export function integrationError(
  integration: string,
  operation: string,
  kind: IntegrationError['kind'],
  message: string,
  recovery: string,
  retryAfterMs?: number
): IntegrationError {
  const retryable = ['rate_limited', 'unavailable', 'timeout', 'circuit_open'].includes(kind);
  return { integration, operation, kind, message: message.slice(0, 500), recovery, retryable, retryAfterMs };
}

/** Map an HTTP status onto the normalised error vocabulary. */
export function kindForStatus(status: number): IntegrationError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exceeded';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}
