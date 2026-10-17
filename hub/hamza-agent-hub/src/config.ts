import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : fallback;
}

/**
 * Whether a request's Origin may be served.
 *
 * A browser omits Origin on same-origin GETs but sends it on same-origin POSTs,
 * so a check that only consults the allow list rejects the Hub's own console
 * the moment it tries to do anything: the default list carries no port, and the
 * served port is not knowable in advance. A request whose Origin is the host it
 * was sent to is not cross-origin at all, so it is allowed on that basis rather
 * than by configuration. Everything else still has to be on the list.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
  return config.allowOrigins.includes(origin);
}

export const config = {
  get root() {
    return ROOT;
  },
  get dataDir() {
    return process.env.HAH_DATA_DIR || path.join(ROOT, 'data');
  },
  get workspacesDir() {
    return process.env.HAH_WORKSPACES_DIR || path.join(ROOT, 'workspaces');
  },
  get dbPath() {
    return process.env.HAH_DB_PATH || path.join(ROOT, 'data', 'hamza-hub.sqlite');
  },
  get concurrency() {
    return Math.min(envInt('HAH_CONCURRENCY', 2), 32);
  },
  get maxPending() { return envInt('HAH_MAX_PENDING', 1000); },
  get maxAttempts() { return Math.min(envInt('HAH_MAX_ATTEMPTS', 3), 10); },
  get rateLimit() { return envInt('HAH_RATE_LIMIT', 120); },
  get maxSteps() {
    return envInt('HAH_MAX_STEPS', 12);
  },
  get taskTimeoutMs() {
    return envInt('HAH_TASK_TIMEOUT_MS', 120_000);
  },
  get modelProvider() {
    return (process.env.HAH_MODEL_PROVIDER || '').toLowerCase().trim();
  },
  get modelUrl() {
    // FreeLLMAPI (open-source free gateway) — default local URL when enabled
    const freellmapiOn =
      this.modelProvider === 'freellmapi' ||
      this.modelProvider === 'lotf' ||
      this.modelProvider === 'free-llm-api' ||
      process.env.HAH_USE_FREELLMAPI === '1' ||
      Boolean(process.env.HAH_FREELLMAPI_URL);
    if (freellmapiOn) {
      return (
        process.env.HAH_FREELLMAPI_URL ||
        process.env.HAH_MODEL_URL ||
        process.env.ECC68_MODEL_URL ||
        'http://127.0.0.1:3001/v1'
      );
    }
    return process.env.HAH_MODEL_URL || process.env.ECC68_MODEL_URL || '';
  },
  get modelName() {
    const freellmapiOn =
      this.modelProvider === 'freellmapi' ||
      this.modelProvider === 'lotf' ||
      this.modelProvider === 'free-llm-api' ||
      process.env.HAH_USE_FREELLMAPI === '1' ||
      Boolean(process.env.HAH_FREELLMAPI_URL);
    if (freellmapiOn) {
      return process.env.HAH_FREELLMAPI_MODEL || process.env.HAH_MODEL_NAME || 'auto';
    }
    return process.env.HAH_MODEL_NAME || 'free-local';
  },
  get modelApiKey() {
    return (
      process.env.HAH_FREELLMAPI_KEY ||
      process.env.HAH_MODEL_API_KEY ||
      ''
    );
  },
  /** Named model profiles — lab copies only; never mutate production GLM/Headroom. */
  get modelProfiles() {
    return {
      glm_lab: process.env.HAH_GLM_LAB_URL || '',
      headroom_lab: process.env.HAH_HEADROOM_LAB_URL || '',
      free: process.env.HAH_MODEL_URL || '',
      freellmapi: process.env.HAH_FREELLMAPI_URL || '',
    };
  },
  get authToken() {
    return process.env.HAH_AUTH_TOKEN || '';
  },
  get host() {
    return process.env.HAH_HOST || '127.0.0.1';
  },
  get port() {
    return envInt('HAH_PORT', 8790);
  },
  get transport() {
    return (process.env.HAH_TRANSPORT || 'stdio') as 'stdio' | 'http';
  },
  get allowOrigins() {
    return (process.env.HAH_ALLOW_ORIGINS || 'http://127.0.0.1,http://localhost')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /** Optional proxy to live Automation Desk — tools also implemented locally. */
  get deskUrl() {
    return process.env.HAH_DESK_URL || 'https://desk.imdifferent01.com';
  },
};

export function modelConfigured(): boolean {
  return Boolean(config.modelUrl);
}
