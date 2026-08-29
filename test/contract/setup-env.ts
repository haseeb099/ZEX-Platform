import * as fs from 'fs';
import * as path from 'path';

/**
 * Load local `.env` into process.env when keys are unset (CI already provides env).
 * Keeps contract tests runnable against docker-compose Postgres/Redis locally.
 */
function loadDotEnvIfPresent() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent();

process.env.NODE_ENV = 'test';

// Contract tests need env that satisfies Joi even when local .env has short placeholders.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'contract-test-jwt-secret-at-least-32-characters';
}
if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 32) {
  process.env.ADMIN_API_KEY = 'contract-test-admin-api-key-32chars-min';
}
if (!process.env.MASTER_KEY || !/^[0-9a-fA-F]{64}$/.test(process.env.MASTER_KEY)) {
  process.env.MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for CRM contract tests');
}
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required for CRM contract tests');
}

// Normalize boolean-like env strings (local .env may include stray characters).
for (const key of [
  'OTEL_ENABLED',
  'DATABASE_LOGGING',
  'FEATURE_AUTO_OPPORTUNITY',
  'FEATURE_BATCH_SCORING',
]) {
  const raw = process.env[key];
  if (raw === undefined) continue;
  const normalized = raw.trim().replace(/[`'"]/g, '').toLowerCase();
  if (normalized === 'true' || normalized === 'false') {
    process.env[key] = normalized;
  }
}
