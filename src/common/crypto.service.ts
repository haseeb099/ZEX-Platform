import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm' as const;
  private readonly masterKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const keyHex = this.config.getOrThrow<string>('MASTER_KEY');
    if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
      throw new Error('MASTER_KEY must be 64 hex characters (32 bytes when decoded)');
    }
    this.masterKey = Buffer.from(keyHex, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('MASTER_KEY must decode to exactly 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid ciphertext format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
