'use strict';

/**
 * Fail closed if image ref is missing or uses a forbidden floating tag.
 * @param {string | undefined | null} imageRef
 * @returns {{ ok: true, image: string } | { ok: false, error: string }}
 */
function validatePlatformImageRef(imageRef) {
  const raw = (imageRef || '').trim();
  if (!raw) {
    return {
      ok: false,
      error: 'ZEX_PLATFORM_IMAGE is required (immutable registry/image:tag). Never use :latest.',
    };
  }
  if (/\s/.test(raw)) {
    return { ok: false, error: 'ZEX_PLATFORM_IMAGE must not contain whitespace' };
  }
  const lower = raw.toLowerCase();
  if (lower.endsWith(':latest') || lower === 'latest' || /\/latest$/.test(lower)) {
    return { ok: false, error: 'ZEX_PLATFORM_IMAGE must not use the floating tag "latest"' };
  }
  // Require an explicit tag or digest
  const hasDigest = raw.includes('@sha256:');
  const lastSlash = raw.lastIndexOf('/');
  const namePart = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
  const hasTag = !hasDigest && namePart.includes(':');
  if (!hasDigest && !hasTag) {
    return {
      ok: false,
      error: 'ZEX_PLATFORM_IMAGE must include an explicit tag or @sha256 digest',
    };
  }
  return { ok: true, image: raw };
}

/**
 * Resolve restore target DB URL. Defaults to disposable URL; production target requires confirmation.
 * @param {{
 *   restoreDatabaseUrl?: string,
 *   productionDatabaseUrl?: string,
 *   allowProductionRestore?: boolean,
 *   confirmPhrase?: string,
 * }} opts
 */
function resolveRestoreTarget(opts = {}) {
  const disposable = (opts.restoreDatabaseUrl || '').trim();
  const production = (opts.productionDatabaseUrl || '').trim();
  const allowProd = Boolean(opts.allowProductionRestore);
  const phrase = (opts.confirmPhrase || '').trim();

  if (!disposable && !allowProd) {
    return {
      ok: false,
      error:
        'RESTORE_DATABASE_URL is required. Destructive production restore is not the default.',
    };
  }

  if (allowProd) {
    if (phrase !== 'RESTORE_PRODUCTION_CONFIRM') {
      return {
        ok: false,
        error:
          'Production restore requires ALLOW_PRODUCTION_RESTORE=true and CONFIRM_PHRASE=RESTORE_PRODUCTION_CONFIRM',
      };
    }
    if (!production) {
      return { ok: false, error: 'DATABASE_URL (production) required when allowing production restore' };
    }
    return { ok: true, targetUrl: production, mode: 'production' };
  }

  if (production && disposable && disposable === production) {
    return {
      ok: false,
      error: 'RESTORE_DATABASE_URL must not equal production DATABASE_URL unless production restore is confirmed',
    };
  }

  return { ok: true, targetUrl: disposable, mode: 'disposable' };
}

/** Redact secrets from strings before logging. */
function redactSecrets(text) {
  if (!text) return text;
  return String(text)
    .replace(/(postgres(?:ql)?:\/\/)([^:@/]+):([^@]+)@/gi, '$1$2:***@')
    .replace(/(redis(?:s)?:\/\/)([^:@/]+):([^@]+)@/gi, '$1$2:***@')
    .replace(/([?&](?:password|pwd|secret|token|apikey|api_key)=)[^&\s]+/gi, '$1***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._\-]+\b/gi, '$1***');
}

function assertBackupArtifact(filePath, stats, minBytes = 64) {
  if (!stats || !stats.isFile()) {
    return { ok: false, error: `Backup is not a file: ${filePath}` };
  }
  if (stats.size < minBytes) {
    return { ok: false, error: `Backup file too small (${stats.size} bytes): ${filePath}` };
  }
  return { ok: true, size: stats.size };
}

/**
 * Fail closed on any non-zero pg_restore exit. Do not reinterpret stderr wording.
 * @param {{ status?: number | null, stderr?: string | Buffer, error?: Error }} result
 * @param {string} [label]
 */
function assertRestoreCommandSuccess(result, label = 'pg_restore') {
  if (result && result.status === 0) {
    return { ok: true };
  }
  const status = result && result.status != null ? result.status : 1;
  const detail = redactSecrets(
    (result && result.stderr && result.stderr.toString()) ||
      (result && result.error && result.error.message) ||
      `${label} failed with exit status ${status}`,
  );
  return { ok: false, status: status || 1, error: detail || `${label} failed` };
}

/**
 * Validate pg_restore --list output for a custom-format (-Fc) dump.
 * Size alone is never sufficient — structural list must succeed.
 * @param {{ status?: number | null, stdout?: string | Buffer, stderr?: string | Buffer, error?: Error }} result
 */
function assertCustomFormatDumpList(result) {
  if (!result || result.status !== 0) {
    const detail = redactSecrets(
      (result && result.stderr && result.stderr.toString()) ||
        (result && result.error && result.error.message) ||
        'pg_restore --list failed',
    );
    return {
      ok: false,
      error: `Backup structural validation failed (pg_restore --list): ${detail}`,
    };
  }
  const out = ((result.stdout && result.stdout.toString()) || '').trim();
  if (!out) {
    return { ok: false, error: 'Backup structural validation failed: empty pg_restore --list output' };
  }
  // Custom-format TOC typically includes archive header and numbered entries.
  const hasHeader = /Archive created by pg_dump/i.test(out) || /TOC Entries/i.test(out);
  const hasEntry = /^\d+;\s+\d+\s+\d+/m.test(out);
  if (!hasHeader && !hasEntry) {
    return {
      ok: false,
      error: 'Backup structural validation failed: pg_restore --list output is not a custom-format TOC',
    };
  }
  return { ok: true, listBytes: out.length };
}

module.exports = {
  validatePlatformImageRef,
  resolveRestoreTarget,
  redactSecrets,
  assertBackupArtifact,
  assertRestoreCommandSuccess,
  assertCustomFormatDumpList,
};
