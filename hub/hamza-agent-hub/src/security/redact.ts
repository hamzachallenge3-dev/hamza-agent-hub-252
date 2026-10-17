const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s"',}]+/gi,
  /sk-[A-Za-z0-9]{10,}/g,
];
function scrub(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(scrub);
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key,value]) =>
    [key, /^(?:api[_-]?key|token|secret|password|authorization|hub_secret)$/i.test(key) ? '[REDACTED]' : scrub(value)]));
  return input;
}
export function redactSecrets(input: unknown): string {
  let text = typeof input === 'string' ? input : JSON.stringify(scrub(input), null, 2);
  text = text ?? '';
  for (const [name,value] of Object.entries(process.env)) {
    if (/(?:SECRET|TOKEN|API_KEY|PASSWORD|ORIGIN_URL|MODEL_URL|FREELLMAPI_URL)/.test(name) && value && value.length >= 4) text = text.split(value).join('[REDACTED]');
  }
  text = text.replace(/(https?:\/\/[^\s/]+\/)[^\s/]+(\/mcp)/gi,'$1[REDACTED]$2');
  for (const re of SECRET_PATTERNS) text = text.replace(re,'[REDACTED]');
  return text;
}
