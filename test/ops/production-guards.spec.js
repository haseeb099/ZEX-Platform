'use strict';

const {
  validatePlatformImageRef,
  resolveRestoreTarget,
  redactSecrets,
  assertBackupArtifact,
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
});
