import { redactSecrets, REDACTED } from './redact-secrets';

describe('redactSecrets', () => {
  it('redacts known secret keys at any depth', () => {
    const input = {
      tenantId: 't1',
      apiKey: 'sk_plain',
      nested: {
        webhookSecret: 'whsec_plain',
        authorization: 'Bearer token',
      },
      clearbitApiKey: 'cb_key',
    };

    const redacted = redactSecrets(input);
    expect(redacted).toEqual({
      tenantId: 't1',
      apiKey: REDACTED,
      nested: {
        webhookSecret: REDACTED,
        authorization: REDACTED,
      },
      clearbitApiKey: REDACTED,
    });
    expect(JSON.stringify(redacted)).not.toContain('sk_plain');
    expect(JSON.stringify(redacted)).not.toContain('whsec_plain');
    expect(JSON.stringify(redacted)).not.toContain('Bearer token');
  });

  it('preserves non-sensitive fields', () => {
    const input = { slug: 'acme', plan: 'starter' };
    expect(redactSecrets(input)).toEqual(input);
  });
});
