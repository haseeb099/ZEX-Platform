import { createHmac } from 'crypto';
import { SignatureService } from './signature.service';

describe('SignatureService', () => {
  const service = new SignatureService();
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ event: 'person.created', data: { id: 'p1' } });

  it('accepts a valid sha256= signature', () => {
    const signature = service.sign(payload, secret);
    expect(service.verifyHmac(payload, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(service.verifyHmac(payload, 'sha256=deadbeef', secret)).toBe(false);
  });

  it('rejects truncated signatures', () => {
    const signature = service.sign(payload, secret);
    expect(service.verifyHmac(payload, signature.slice(0, 20), secret)).toBe(false);
  });

  it('accepts a valid Twenty CRM webhook signature', () => {
    const timestamp = '1787430090865';
    const payload = JSON.stringify({ eventName: 'person.created', record: { id: 'p1' } });
    const secret = 'whsec_test_secret';
    const stringToSign = `${timestamp}:${payload}`;
    const signature = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('hex');

    expect(service.verifyTwentyWebhook(payload, signature, secret, timestamp)).toBe(true);
  });

  it('rejects empty inputs', () => {
    expect(service.verifyHmac('', 'sha256=abc', secret)).toBe(false);
    expect(service.verifyHmac(payload, '', secret)).toBe(false);
  });
});
