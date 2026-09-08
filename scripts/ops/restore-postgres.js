#!/usr/bin/env node
'use strict';

/**
 * Restore a pg_dump -Fc backup into a disposable database by default.
 *
 * Env:
 *   BACKUP_FILE (required) — path to .dump
 *   RESTORE_DATABASE_URL (required for default disposable restore)
 *   DATABASE_URL — production URL (used only with explicit production confirm)
 *   ALLOW_PRODUCTION_RESTORE=true
 *   CONFIRM_PHRASE=RESTORE_PRODUCTION_CONFIRM
 *
 * Never prints credentials. Exit non-zero on failure.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const {
  resolveRestoreTarget,
  redactSecrets,
  assertRestoreCommandSuccess,
} = require('./lib/production-guards');

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

function main() {
  const backupFile = (process.env.BACKUP_FILE || '').trim();
  if (!backupFile || !fs.existsSync(backupFile)) {
    console.error('BACKUP_FILE is required and must exist');
    process.exit(1);
  }

  const target = resolveRestoreTarget({
    restoreDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    productionDatabaseUrl: process.env.DATABASE_URL,
    allowProductionRestore: process.env.ALLOW_PRODUCTION_RESTORE === 'true',
    confirmPhrase: process.env.CONFIRM_PHRASE,
  });
  if (!target.ok) {
    console.error(target.error);
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(target.targetUrl);
  const env = {
    ...process.env,
    PGHOST: parsed.host,
    PGPORT: parsed.port,
    PGUSER: parsed.user,
    PGPASSWORD: parsed.password,
    PGDATABASE: parsed.database,
  };

  console.log(`Restoring into ${target.mode} database "${parsed.database}" on ${parsed.host}`);

  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const restoreArgs = ['--clean', '--if-exists', '--no-owner', '--no-acl', '-d', parsed.database, backupFile];
  // Allow PG_RESTORE_BIN to point at a .js fixture/wrapper (tests + portable shims).
  let result =
    /\.js$/i.test(pgRestore)
      ? spawnSync(process.execPath, [pgRestore, ...restoreArgs], { env, encoding: 'utf8' })
      : spawnSync(pgRestore, restoreArgs, { env, encoding: 'utf8' });

  if (result.error && result.error.code === 'ENOENT' && process.env.RESTORE_USE_DOCKER === '1') {
    const container = process.env.RESTORE_DOCKER_CONTAINER || 'twenty-automation-db';
    // Stream file into container pg_restore via stdin
    const dump = fs.readFileSync(backupFile);
    result = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${parsed.password}`,
        container,
        'pg_restore',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '-U',
        parsed.user,
        '-d',
        parsed.database,
      ],
      { input: dump, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
    );
  }

  // Fail closed: any non-zero pg_restore exit is a restore failure (ignore stderr wording).
  const check = assertRestoreCommandSuccess(result, 'pg_restore');
  if (!check.ok) {
    console.error(check.error);
    process.exit(check.status || 1);
  }

  console.log(`OK restore completed (mode=${target.mode})`);
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(redactSecrets(err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
