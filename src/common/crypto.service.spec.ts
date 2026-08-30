import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const validMasterKey = '0c3195a8c93513790c7d5dc3df85e3ab1bdcded9fee05fb9e3d37c818975acfc';

  function createCrypto(masterKey: string) {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'MASTER_KEY') return masterKey;
        throw new Error(key);
      },
    } as ConfigService;
    return new CryptoService(config);
  }

  it('accepts a valid 64-hex master key decoding to exactly 32 bytes', () => {
    const crypto = createCrypto(validMasterKey);
    const encrypted = crypto.encrypt('test');
    expect(crypto.decrypt(encrypted)).toBe('test');
  });

  it('rejects invalid hex master key at construction', () => {
    expect(() => createCrypto('not-hex-key-that-is-still-sixty-four-characters-long!!')).toThrow(
      /64 hex characters/,
    );
  });

  it('rejects hex key with wrong decoded length', () => {
    expect(() => createCrypto('abcd')).toThrow(/64 hex characters/);
  });

  it('round-trips encrypt/decrypt', () => {
    const crypto = createCrypto(validMasterKey);
    const plain = 'sk_live_example_secret_value';
    const encrypted = crypto.encrypt(plain);
    expect(encrypted).not.toEqual(plain);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(crypto.decrypt(encrypted)).toEqual(plain);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const crypto = createCrypto(validMasterKey);
    const a = crypto.encrypt('same-plaintext');
    const b = crypto.encrypt('same-plaintext');
    expect(a).not.toEqual(b);
    expect(crypto.decrypt(a)).toBe('same-plaintext');
    expect(crypto.decrypt(b)).toBe('same-plaintext');
  });

  it('fails decrypt on tampered auth tag', () => {
    const crypto = createCrypto(validMasterKey);
    const encrypted = crypto.encrypt('secret');
    const [iv, tag, payload] = encrypted.split(':');
    const tamperedTag = tag.slice(0, -2) + (tag.endsWith('ff') ? '00' : 'ff');
    expect(() => crypto.decrypt(`${iv}:${tamperedTag}:${payload}`)).toThrow();
  });

  it('fails decrypt on empty or malformed ciphertext', () => {
    const crypto = createCrypto(validMasterKey);
    expect(() => crypto.decrypt('')).toThrow(/Invalid ciphertext format/);
    expect(() => crypto.decrypt('only-one-part')).toThrow(/Invalid ciphertext format/);
    expect(() => crypto.decrypt('aa:bb')).toThrow(/Invalid ciphertext format/);
  });
});
