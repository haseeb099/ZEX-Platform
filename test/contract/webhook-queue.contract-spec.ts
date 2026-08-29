import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { envSchema } from '@src/config/env.schema';
import { ENRICH_AND_SCORE_QUEUE } from '@src/jobs/jobs.constants';
import { TwentyModule } from '@src/twenty/twenty.module';
import { WebhooksModule } from '@src/webhooks/webhooks.module';
import { FakeTwentyGraphqlServer } from './fake-twenty-server';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
  signTwentyWebhook,
  countEnrichJobsForPerson,
} from './helpers';

/**
 * Contract harness without JobsModule processors so enqueued jobs remain
 * inspectable at the queue boundary (no race with enrich-and-score workers).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: false },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.getOrThrow<string>('REDIS_URL'),
        },
      }),
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    TwentyModule,
    WebhooksModule,
  ],
})
class WebhookContractAppModule {}

/**
 * CRM contract — webhook HTTP path → tenant secret resolution → BullMQ enqueue.
 * Stops at the queue boundary (worker full write-back is a documented follow-up).
 * TwentyClient is not mocked; webhook path uses TwentyConnectionService.
 */
describe('CRM contract: webhook → queue boundary', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const fakeTwenty = new FakeTwentyGraphqlServer();
  const crypto = createCryptoFromEnv();

  let tenantId: string;
  let webhookSecret: string;
  let graphqlUrl: string;

  beforeAll(async () => {
    const urls = await fakeTwenty.start();
    graphqlUrl = urls.graphqlUrl;
    webhookSecret = 'whsec_contract_webhook_queue';

    app = await NestFactory.create<NestFastifyApplication>(
      WebhookContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );

    await app.init();

    // Mirror main.ts raw-body parser so HMAC uses the exact request bytes.
    // Must run after init so Nest's default JSON parser can be replaced cleanly.
    const instance = app.getHttpAdapter().getInstance();
    instance.removeContentTypeParser('application/json');
    instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      try {
        const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
        (req as { rawBody?: string }).rawBody = raw;
        done(null, raw.length ? JSON.parse(raw) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    await instance.ready();

    prisma = app.get(PrismaService);
    queue = app.get<Queue>(getQueueToken(ENRICH_AND_SCORE_QUEUE));

    const seeded = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Contract Webhook Tenant',
      workspaceId: 'ws_contract_webhook',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'sk_contract_webhook_tenant',
      webhookSecretPlain: webhookSecret,
    });
    tenantId = seeded.tenantId;
  }, 90000);

  afterAll(async () => {
    if (prisma && tenantId) {
      await deleteTenantCascade(prisma, tenantId);
    }
    await app?.close();
    await fakeTwenty.stop();
  });

  function buildPayload(personId: string) {
    return {
      event: 'person.created',
      data: {
        id: personId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@analytical.engine',
        jobTitle: 'VP of Engineering',
      },
    };
  }

  it('accepts a signed Twenty-style webhook using the tenant-specific secret and enqueues enrich-and-score', async () => {
    const payload = buildPayload('person_wh_1');
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = signTwentyWebhook(rawBody, webhookSecret, timestamp);
    const eventId = `contract-event-${Date.now()}-accept`;

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/twenty/${tenantId}`,
      headers: {
        'content-type': 'application/json',
        'x-twenty-webhook-signature': signature,
        'x-twenty-webhook-timestamp': timestamp,
        'x-twenty-webhook-nonce': eventId,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ received: true, webhookId: eventId });

    const logs = await prisma.webhookLog.findMany({
      where: { tenantId, event: 'person.created' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs).toHaveLength(1);
    // Queue-boundary suite does not register EnrichAndScoreProcessor; status stays
    // queued unless another worker is sharing Redis. Accept early processing states.
    expect(['queued', 'processing', 'success']).toContain(logs[0].status);
    expect(logs[0].jobId).toBeTruthy();

    const job = await queue.getJob(logs[0].jobId!);
    expect(job).toBeTruthy();
    expect(job!.name).toBe('enrich-and-score-person');
    expect(job!.data).toMatchObject({
      tenantId,
      personTwentyId: 'person_wh_1',
      event: 'person.created',
      webhookLogId: logs[0].id,
    });

    // Connection was seeded against this fake GraphQL URL (used by later worker write-back).
    expect(graphqlUrl).toContain('127.0.0.1');
  });

  it('rejects webhook signed with the wrong tenant secret (fail closed)', async () => {
    const payload = buildPayload('person_wh_bad');
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = signTwentyWebhook(rawBody, 'whsec_wrong_secret', timestamp);

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/twenty/${tenantId}`,
      headers: {
        'content-type': 'application/json',
        'x-twenty-webhook-signature': signature,
        'x-twenty-webhook-timestamp': timestamp,
        'x-twenty-webhook-nonce': `contract-event-bad-${Date.now()}`,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { message?: unknown; code?: string };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('WEBHOOK_SIGNATURE_MISMATCH');
  });

  it('marks duplicate/replay webhook ids without creating a second WebhookLog or BullMQ job', async () => {
    const payload = buildPayload('person_wh_dup');
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = signTwentyWebhook(rawBody, webhookSecret, timestamp);
    const eventId = `contract-event-dup-${Date.now()}`;

    const jobsBefore = await countEnrichJobsForPerson(queue, tenantId, 'person_wh_dup');

    const first = await app.inject({
      method: 'POST',
      url: `/webhooks/twenty/${tenantId}`,
      headers: {
        'content-type': 'application/json',
        'x-twenty-webhook-signature': signature,
        'x-twenty-webhook-timestamp': timestamp,
        'x-twenty-webhook-nonce': eventId,
      },
      payload: rawBody,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true, webhookId: eventId });

    const beforeCount = await prisma.webhookLog.count({ where: { tenantId } });
    const jobsAfterFirst = await countEnrichJobsForPerson(queue, tenantId, 'person_wh_dup');
    expect(jobsAfterFirst).toBe(jobsBefore + 1);

    const firstLog = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const firstJobId = firstLog.jobId;
    expect(firstJobId).toBeTruthy();

    const second = await app.inject({
      method: 'POST',
      url: `/webhooks/twenty/${tenantId}`,
      headers: {
        'content-type': 'application/json',
        'x-twenty-webhook-signature': signature,
        'x-twenty-webhook-timestamp': timestamp,
        'x-twenty-webhook-nonce': eventId,
      },
      payload: rawBody,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ received: true, webhookId: eventId, duplicate: true });

    const afterCount = await prisma.webhookLog.count({ where: { tenantId } });
    expect(afterCount).toBe(beforeCount);

    const jobsAfterDup = await countEnrichJobsForPerson(queue, tenantId, 'person_wh_dup');
    expect(jobsAfterDup).toBe(jobsAfterFirst);

    const stillFirstLog = await prisma.webhookLog.findUniqueOrThrow({
      where: { id: firstLog.id },
    });
    expect(stillFirstLog.jobId).toBe(firstJobId);
  });
});
