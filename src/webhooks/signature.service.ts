import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SignatureService {
  /**
   * Verify HMAC-SHA256 webhook signature.
   * Accepts either `sha256=<hex>` or raw hex.
   */
  verifyHmac(payload: string, signature: string, secret: string): boolean {
    if (!payload || !signature || !secret) {
      return false;
    }

    const expectedHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const provided = signature.startsWith('sha256=')
      ? signature.slice('sha256='.length)
      : signature;

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  }

  sign(payload: string, secret: string): string {
    const hex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    return `sha256=${hex}`;
  }

  // Twenty CRM: HMAC over `${timestamp}:${jsonPayload}` (see webhooks.mdx)
  verifyTwentyWebhook(
    jsonPayload: string,
    signature: string | undefined,
    secret: string,
    timestamp: string | undefined,
  ): boolean {
    if (!jsonPayload || !signature || !secret || !timestamp) {
      return false;
    }

    const stringToSign = `${timestamp}:${jsonPayload}`;
    const expectedHex = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('hex');
    const provided = signature.startsWith('sha256=')
      ? signature.slice('sha256='.length)
      : signature;

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');

    if (expectedBuf.length === 0 || expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
