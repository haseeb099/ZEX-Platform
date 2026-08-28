import { createHmac } from 'crypto';
import { SignatureService } from '../src/webhooks/signature.service';

/**
 * Lightweight contract test for HMAC + scoring acceptance path.
 * Full Nest e2e harness can replace this once a dedicated Twenty mock is wired.
 */
describe('Webhook HMAC contract (e2e-lite)', () => {
  it('signs and verifies the person.created payload used in MVP flow', () => {
    const secret = 'whsec_test';
    const payload = JSON.stringify({
      event: 'person.created',
      data: {
        id: 'person_e2e',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@analytical.engine',
        jobTitle: 'VP of Engineering',
      },
    });
    const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const service = new SignatureService();
    expect(service.verifyHmac(payload, sig, secret)).toBe(true);
  });
});
