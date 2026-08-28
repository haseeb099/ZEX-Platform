import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const masterKey = '0c3195a8c93513790c7d5dc3df85e3ab1bdcded9fee05fb9e3d37c818975acfc';
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'MASTER_KEY') return masterKey;
      throw new Error(key);
    },
  } as ConfigService;

  const crypto = new CryptoService(config);

  it('round-trips encrypt/decrypt', () => {
    const plain = 'sk_live_example_secret_value';
    const encrypted = crypto.encrypt(plain);
    expect(encrypted).not.toEqual(plain);
    expect(encrypted.split(':')).toHaveLength(3);
    expect(crypto.decrypt(encrypted)).toEqual(plain);
  });
});
