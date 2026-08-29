import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { TwentyConnectionService } from '@src/twenty/twenty-connection.service';
import { SignatureService } from './signature.service';
import { WebhookController } from './webhook.controller';

describe('WebhookController connection secret path', () => {
  const webhookPlain = 'whsec_webhook_tenant';
  const tenantId = 'tenant_wh';

  it('verifies signature using tenant-specific webhook secret from TwentyConnectionService', async () => {
    const connections = {
      resolveWebhookSecret: jest.fn().mockResolvedValue(webhookPlain),
    };
    const signatures = new SignatureService();
    const idempotency = {
      isTimestampFresh: jest.fn().mockReturnValue(true),
      hasSeenOrMark: jest.fn().mockResolvedValue(false),
    };
    const prisma = {
      webhookLog: {
        create: jest.fn().mockResolvedValue({ id: 'log_1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job_1' }),
    };
    const logger = { info: jest.fn() };

    const controller = new WebhookController(
      prisma as never,
      connections as unknown as TwentyConnectionService,
      signatures,
      idempotency as never,
      logger as never,
      queue as never,
    );

    const body = {
      event: 'person.created',
      data: { id: 'person_1', email: 'a@b.com' },
    };
    const rawBody = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${ts}:${rawBody}`;
    const signature = `sha256=${createHmac('sha256', webhookPlain).update(stringToSign).digest('hex')}`;

    const result = await controller.receive(
      tenantId,
      body,
      signature,
      undefined,
      undefined,
      ts,
      undefined,
      { rawBody } as never,
    );

    expect(connections.resolveWebhookSecret).toHaveBeenCalledWith(tenantId);
    expect(result).toEqual({ received: true, webhookId: expect.any(String) });
  });

  it('rejects invalid signature against tenant webhook secret', async () => {
    const connections = {
      resolveWebhookSecret: jest.fn().mockResolvedValue(webhookPlain),
    };
    const controller = new WebhookController(
      { webhookLog: { create: jest.fn(), update: jest.fn() } } as never,
      connections as unknown as TwentyConnectionService,
      new SignatureService(),
      {
        isTimestampFresh: jest.fn().mockReturnValue(true),
        hasSeenOrMark: jest.fn(),
      } as never,
      { info: jest.fn() } as never,
      { add: jest.fn() } as never,
    );

    await expect(
      controller.receive(
        tenantId,
        { event: 'person.created', data: { id: 'p1' } },
        'sha256=deadbeef',
        undefined,
        undefined,
        Math.floor(Date.now() / 1000).toString(),
        undefined,
        { rawBody: '{}' } as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
