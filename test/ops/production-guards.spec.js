'use strict';

const {
  validatePlatformImageRef,
  resolveRestoreTarget,
  redactSecrets,
  assertBackupArtifact,
  assertRestoreCommandSuccess,
  assertCustomFormatDumpList,
} = require('../../scripts/ops/lib/production-guards');

describe('production-guards (ZEX-27)', () => {
  describe('validatePlatformImageRef', () => {
    it('fails closed when missing', () => {
      const r = validatePlatformImageRef('');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/required/i);
    });

    it('rejects latest', () => {
      expect(validatePlatformImageRef('ghcr.io/org/zex-platform:latest').ok).toBe(false);
      expect(validatePlatformImageRef('latest').ok).toBe(false);
    });

    it('rejects untagged image', () => {
      expect(validatePlatformImageRef('ghcr.io/org/zex-platform').ok).toBe(false);
    });

    it('accepts immutable tag', () => {
      const r = validatePlatformImageRef(
        'ghcr.io/org/zex-platform:72e88e95c86a3b5f004d27cf662bbb79146cb87c',
      );
      expect(r.ok).toBe(true);
    });

    it('accepts digest pin', () => {
      const r = validatePlatformImageRef(
        'ghcr.io/org/zex-platform@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('resolveRestoreTarget', () => {
    it('defaults to disposable URL', () => {
      const r = resolveRestoreTarget({
        restoreDatabaseUrl: 'postgresql://u:p@localhost:5432/restore_test',
        productionDatabaseUrl: 'postgresql://u:p@localhost:5432/prod',
      });
      expect(r.ok).toBe(true);
      expect(r.mode).toBe('disposable');
    });

    it('rejects missing disposable target by default', () => {
      const r = resolveRestoreTarget({});
      expect(r.ok).toBe(false);
    });

    it('rejects disposable URL equal to production without confirm', () => {
      const url = 'postgresql://u:p@localhost:5432/same';
      const r = resolveRestoreTarget({
        restoreDatabaseUrl: url,
        productionDatabaseUrl: url,
      });
      expect(r.ok).toBe(false);
    });

    it('requires strong phrase for production restore', () => {
      const bad = resolveRestoreTarget({
        allowProductionRestore: true,
        productionDatabaseUrl: 'postgresql://u:p@localhost:5432/prod',
        confirmPhrase: 'yes',
      });
      expect(bad.ok).toBe(false);

      const good = resolveRestoreTarget({
        allowProductionRestore: true,
        productionDatabaseUrl: 'postgresql://u:p@localhost:5432/prod',
        confirmPhrase: 'RESTORE_PRODUCTION_CONFIRM',
      });
      expect(good.ok).toBe(true);
      expect(good.mode).toBe('production');
    });
  });

  describe('redactSecrets', () => {
    it('does not echo passwords from URLs', () => {
      const out = redactSecrets('postgresql://zex:super-secret@db:5432/zex');
      expect(out).not.toContain('super-secret');
      expect(out).toContain('***');
    });
  });

  describe('assertBackupArtifact', () => {
    it('detects empty/too-small backups', () => {
      expect(assertBackupArtifact('x.dump', { isFile: () => true, size: 10 }).ok).toBe(false);
      expect(assertBackupArtifact('x.dump', { isFile: () => true, size: 1000 }).ok).toBe(true);
    });
  });

  describe('assertRestoreCommandSuccess (fail-closed)', () => {
    it('succeeds only when status is exactly 0', () => {
      expect(assertRestoreCommandSuccess({ status: 0 }).ok).toBe(true);
    });

    it('fails when pg_restore exits non-zero even if stderr has no ERROR:', () => {
      const r = assertRestoreCommandSuccess({
        status: 1,
        stderr: 'pg_restore: warning: errors ignored on restore: 3\n',
      });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(1);
      expect(r.error).not.toMatch(/ERROR:/i);
      expect(String(r.error)).toMatch(/warning|errors ignored|pg_restore/i);
    });

    it('fails when status is non-zero with empty stderr', () => {
      const r = assertRestoreCommandSuccess({ status: 1, stderr: '' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(1);
    });

    it('fails when status is non-zero with WARNING only', () => {
      const r = assertRestoreCommandSuccess({
        status: 1,
        stderr: 'WARNING: something odd happened\n',
      });
      expect(r.ok).toBe(false);
    });
  });

  describe('assertCustomFormatDumpList', () => {
    it('rejects non-zero list exit even for large dumps', () => {
      const r = assertCustomFormatDumpList({
        status: 1,
        stdout: '',
        stderr: 'unrecognized archive format',
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/structural validation failed/i);
    });

    it('rejects empty TOC output', () => {
      expect(assertCustomFormatDumpList({ status: 0, stdout: '   ' }).ok).toBe(false);
    });

    it('accepts a valid custom-format TOC listing', () => {
      const toc = `
;
; Archive created by pg_dump version: 16.0
;     dbname: zex_fixture
;
; Selected TOC Entries:
;
2210; 1259 16400 TABLE public Tenant postgres
`;
      const r = assertCustomFormatDumpList({ status: 0, stdout: toc });
      expect(r.ok).toBe(true);
    });
  });
});

describe('restore-postgres.js fail-closed (ZEX-27 regression)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');

  const restoreScript = path.join(__dirname, '../../scripts/ops/restore-postgres.js');
  const fakeWarn = path.join(__dirname, 'fixtures/fake-pg-restore-warn-exit.js');
  const fakeOk = path.join(__dirname, 'fixtures/fake-pg-restore-ok.js');

  function runRestore(fakeScript) {
    const dump = path.join(os.tmpdir(), `zex27-restore-reg-${Date.now()}.dump`);
    fs.writeFileSync(dump, Buffer.alloc(128, 1));
    const r = spawnSync(process.execPath, [restoreScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BACKUP_FILE: dump,
        RESTORE_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/zex_restore_test',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/zex_prod_not_used',
        PG_RESTORE_BIN: fakeScript,
        RESTORE_USE_DOCKER: '0',
      },
    });
    try {
      fs.unlinkSync(dump);
    } catch {
      /* ignore */
    }
    return r;
  }

  it('exits non-zero when pg_restore exits non-zero without ERROR: in stderr', () => {
    const r = runRestore(fakeWarn);
    expect(r.status).not.toBe(0);
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    expect(combined).not.toMatch(/OK restore completed/i);
    expect(combined.toLowerCase()).not.toContain('super-secret');
  });

  it('reports success only when pg_restore exits 0', () => {
    const r = runRestore(fakeOk);
    expect(r.status).toBe(0);
    expect(`${r.stdout || ''}`).toMatch(/OK restore completed/i);
  });
});
