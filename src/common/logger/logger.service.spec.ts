import { LoggerService } from '@src/common/logger/logger.service';

describe('LoggerService secret redaction', () => {
  it('redacts sensitive meta fields in info logs', () => {
    const logger = new LoggerService();
    const spy = jest.spyOn((logger as unknown as { logger: { info: jest.Mock } }).logger, 'info');

    logger.info('tenant provisioned', {
      apiKey: 'sk_should_not_appear',
      webhookSecret: 'whsec_should_not_appear',
      tenantId: 't1',
    });

    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.apiKey).toBe('[REDACTED]');
    expect(payload.webhookSecret).toBe('[REDACTED]');
    expect(payload.tenantId).toBe('t1');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('sk_should_not_appear');
  });
});
