const SENSITIVE_KEYS = new Set([
  'apikey',
  'twentyapikey',
  'webhooksecret',
  'masterkey',
  'master_key',
  'admin_api_key',
  'clearbitapikey',
  'apolloapikey',
  'hunterapikey',
  'authorization',
  'bearertoken',
  'password',
  'secret',
]);

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return normalized.endsWith('apikey') || normalized.endsWith('secret');
}

/** Deep-redact known secret field names from objects before logging or serializing. */
export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(item => redactValue(item));
  if (typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested);
  }
  return result;
}

export { REDACTED };
