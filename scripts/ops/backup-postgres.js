#!/usr/bin/env node
'use strict';

/**
 * Postgres backup using pg_dump custom format (-Fc).
 * Credentials via DATABASE_URL or PG* env — never echoed.
 *
 * Env:
 *   DATABASE_URL (required unless PGHOST/PGUSER/PGDATABASE set)
 *   BACKUP_DIR (default: ./backups)
 *   ZEX_RELEASE_SHA / ZEX_BACKUP_ENV (metadata labels)
 *
 * Exit non-zero on failure. Writes to BACKUP_DIR (gitignored).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertBackupArtifact, assertCustomFormatDumpList, redactSecrets } = require('./lib/production-guards');

function parseDatabaseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '').split('?')[0],
  };
}

/**
 * Structural validation for pg_dump -Fc: pg_restore --list must succeed.
 * Host binary first; Docker fallback mirrors dump path (BACKUP_USE_DOCKER=1).
 */
function listCustomFormatDump(outPath, env) {
  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  let listResult = spawnSync(pgRestore, ['--list', outPath], { env, encoding: 'utf8' });

  if (listResult.error && listResult.error.code === 'ENOENT' && process.env.BACKUP_USE_DOCKER === '1') {
    const container = process.env.BACKUP_DOCKER_CONTAINER || 'twenty-automation-db';
    const dump = fs.readFileSync(outPath);
    listResult = spawnSync(
      'docker',
      ['exec', '-i', container, 'pg_restore', '--list', '-'],
      { input: dump, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  }

  return listResult;
}

function main() {
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
  fs.mkdirSync(backupDir, { recursive: true });

  const envName = (process.env.ZEX_BACKUP_ENV || process.env.NODE_ENV || 'unknown').replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
  const sha = (process.env.ZEX_RELEASE_SHA || 'unknown').replace(/[^a-fA-F0-9]/g, '').slice(0, 40) || 'unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `zex-platform_${envName}_${sha}_${ts}.dump`;
  const outPath = path.join(backupDir, fileName);
  const metaPath = `${outPath}.json`;

  const env = { ...process.env };
  if (process.env.DATABASE_URL) {
    const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
    env.PGHOST = parsed.host;
    env.PGPORT = parsed.port;
    env.PGUSER = parsed.user;
    env.PGPASSWORD = parsed.password;
    env.PGDATABASE = parsed.database;
  }

  if (!env.PGHOST || !env.PGUSER || !env.PGDATABASE) {
    console.error('DATABASE_URL or PGHOST/PGUSER/PGDATABASE required for backup');
    process.exit(1);
  }

  // Prefer dockerized pg_dump when host binary missing (local Windows/dev parity).
  let result;
  const pgDump = process.env.PG_DUMP_BIN || 'pg_dump';
  const args = ['-Fc', '-f', outPath, '-d', env.PGDATABASE];
  result = spawnSync(pgDump, args, { env, encoding: 'utf8' });

  if (result.error && result.error.code === 'ENOENT' && process.env.BACKUP_USE_DOCKER === '1') {
    const container = process.env.BACKUP_DOCKER_CONTAINER || 'twenty-automation-db';
    const dockerArgs = [
      'exec',
      '-e',
      `PGPASSWORD=${env.PGPASSWORD || ''}`,
      container,
      'pg_dump',
      '-U',
      env.PGUSER,
      '-Fc',
      env.PGDATABASE,
    ];
    result = spawnSync('docker', dockerArgs, { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
    if (result.status === 0 && result.stdout) {
      fs.writeFileSync(outPath, result.stdout);
    }
  }

  if (result.status !== 0) {
    const errText = redactSecrets(
      (result.stderr && result.stderr.toString()) || result.error?.message || 'pg_dump failed',
    );
    console.error(errText);
    process.exit(result.status || 1);
  }

  const stats = fs.statSync(outPath);
  const check = assertBackupArtifact(outPath, stats);
  if (!check.ok) {
    console.error(check.error);
    process.exit(1);
  }

  const listResult = listCustomFormatDump(outPath, env);
  const structural = assertCustomFormatDumpList(listResult);
  if (!structural.ok) {
    console.error(structural.error);
    process.exit(1);
  }

  const meta = {
    createdAt: new Date().toISOString(),
    environment: envName,
    releaseSha: sha,
    format: 'pg_dump-Fc',
    fileName,
    bytes: stats.size,
    database: env.PGDATABASE,
    host: env.PGHOST,
    structuralValidation: 'pg_restore --list',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`OK backup written: ${fileName} (${stats.size} bytes)`);
  console.log('OK structural validation: pg_restore --list');
  console.log(`OK metadata: ${path.basename(metaPath)}`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
