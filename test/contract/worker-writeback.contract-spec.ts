import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue, UnrecoverableError } from 'bullmq';
import { AuditModule } from '@src/audit/audit.module';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { envSchema } from '@src/config/env.schema';
import { EnrichmentService } from '@src/enrichment/enrichment.service';
import { EnrichmentResult } from '@src/enrichment/enrichment.types';
import { ENRICH_AND_SCORE_QUEUE } from '@src/jobs/jobs.constants';
import { JobActionCheckpointService } from '@src/jobs/job-action-checkpoint.service';
import { EnrichAndScoreProcessor } from '@src/jobs/processors/enrich-and-score.processor';
import { ScoringModule } from '@src/scoring/scoring.module';
import { TwentyModule } from '@src/twenty/twenty.module';
import { WebhooksModule } from '@src/webhooks/webhooks.module';
import { FakeTwentyGraphqlServer } from './fake-twenty-server';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
  signTwentyWebhook,
  waitForCondition,
} from './helpers';

const CONTROLLED_ENRICHMENT: EnrichmentResult = {
  personEmail: 'ada@acme.test',
  companyName: 'Acme',
  companyDomain: 'acme.test',
  companySize: '51-200',
  industry: 'SaaS',
  location: 'London',
  jobTitle: 'VP Engineering',
  jobFunction: 'Engineering',
  technologies: ['typescript'],
  source: 'contract-double',
  confidence: 100,
};

type EnrichmentMode = 'success' | 'unrecoverable';

/**
 * Deterministic enrichment double — no Clearbit/Apollo/Hunter network calls.
 * Mutable mode supports the failure-path contract without rebuilding the Nest app.
 */
const enrichmentControl: {
  mode: EnrichmentMode;
  enrichPerson: (tenantId: string, person: { id: string }) => Promise<EnrichmentResult>;
} = {
  mode: 'success',
  async enrichPerson() {
    if (enrichmentControl.mode === 'unrecoverable') {
      // UnrecoverableError fails the BullMQ job immediately (no 5-attempt backoff wait).
      // Documents a test-only failure injection; production retry policy is unchanged.
      throw new UnrecoverableError('contract enrichment failure');
    }
    return CONTROLLED_ENRICHMENT;
  },
};

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
    BullModule.registerQueue({ name: ENRICH_AND_SCORE_QUEUE }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    TwentyModule,
    WebhooksModule,
    ScoringModule,
    AuditModule,
  ],
  providers: [
    JobActionCheckpointService,
    EnrichAndScoreProcessor,
    {
      provide: EnrichmentService,
      useValue: enrichmentControl,
    },
  ],
})
class WorkerWritebackContractModule {}

/**
 * CRM contract — full webhook → BullMQ worker → scoring → TwentyClient write-back.
 * TwentyClient is NOT mocked. EnrichmentService is a controlled double only.
 */
describe('CRM contract: webhook → worker → CRM write-back', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let queue: Queue;
  const crypto = createCryptoFromEnv();

  const serverA = new FakeTwentyGraphqlServer();
  const serverB = new FakeTwentyGraphqlServer();

  let urlsA: { baseUrl: string; graphqlUrl: string; restUrl: string };
  let urlsB: { baseUrl: string; graphqlUrl: string; restUrl: string };

  let tenantAId: string;
  let tenantBId: string;
  let webhookSecretA: string;
  let webhookSecretB: string;
  let apiKeyA: string;
  let apiKeyB: string;

  beforeAll(async () => {
    process.env.FEATURE_AUTO_OPPORTUNITY = 'true';

    urlsA = await serverA.start();
    urlsB = await serverB.start();

    apiKeyA = 'sk_contract_worker_a';
    apiKeyB = 'sk_contract_worker_b';
    webhookSecretA = 'whsec_contract_worker_a';
    webhookSecretB = 'whsec_contract_worker_b';

    app = await NestFactory.create<NestFastifyApplication>(
      WorkerWritebackContractModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );

    await app.init();

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

    const seededA = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Worker Contract A',
      workspaceId: 'ws_worker_a',
      baseUrl: urlsA.baseUrl,
      graphqlUrl: urlsA.graphqlUrl,
      restUrl: urlsA.restUrl,
      apiKeyPlain: apiKeyA,
      webhookSecretPlain: webhookSecretA,
    });
    const seededB = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Worker Contract B',
      workspaceId: 'ws_worker_b',
      baseUrl: urlsB.baseUrl,
      graphqlUrl: urlsB.graphqlUrl,
      restUrl: urlsB.restUrl,
      apiKeyPlain: apiKeyB,
      webhookSecretPlain: webhookSecretB,
    });
    tenantAId = seededA.tenantId;
    tenantBId = seededB.tenantId;

    // Ensure auto-opportunity fires for deterministic CreateOpportunity assertion.
    await prisma.tenant.updateMany({
      where: { id: { in: [tenantAId, tenantBId] } },
      data: { enableAutoOpportunity: true, opportunityThreshold: 50 },
    });
  }, 120000);

  afterAll(async () => {
    if (prisma) {
      if (tenantAId) await deleteTenantCascade(prisma, tenantAId);
      if (tenantBId) await deleteTenantCascade(prisma, tenantBId);
    }
    await app?.close();
    await serverA.stop();
    await serverB.stop();
  });

  beforeEach(() => {
    enrichmentControl.mode = 'success';
    serverA.clearRequests();
    serverB.clearRequests();
    serverA.clearFailedOperations();
    serverB.clearFailedOperations();
    delete process.env.BULLMQ_ENRICH_ATTEMPTS;
    delete process.env.BULLMQ_ENRICH_BACKOFF_MS;
  });

  function buildPayload(personId: string, overrides?: Record<string, unknown>) {
    return {
      event: 'person.created',
      data: {
        id: personId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@acme.test',
        jobTitle: 'Engineer',
        ...overrides,
      },
    };
  }

  async function postSignedWebhook(
    tenantId: string,
    secret: string,
    payload: object,
    eventId: string,
  ) {
    const rawBody = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = signTwentyWebhook(rawBody, secret, timestamp);
    return app.inject({
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
  }

  it('processes webhook through the real worker and writes GetPerson/UpdatePerson/CreateNote/CreateOpportunity', async () => {
    const personId = `person_worker_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.test',
      jobTitle: 'Engineer',
      updatedAt: new Date().toISOString(),
      company: { id: 'co_acme', name: 'Acme', website: 'acme.test' },
    });

    const response = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-writeback-${personId}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      received: true,
      webhookId: `worker-writeback-${personId}`,
    });

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId, event: 'person.created' },
          orderBy: { createdAt: 'desc' },
        });
        if (log?.status !== 'success' || !log.jobId) return false;
        const job = await queue.getJob(log.jobId);
        return (await job?.getState()) === 'completed';
      },
      { timeoutMs: 30000, label: 'WebhookLog success + BullMQ completed' },
    );

    const log = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.jobId).toBeTruthy();
    expect(log.processedAt).toBeTruthy();
    expect(log.jobResult).toMatchObject({ opportunityCreated: true });

    const job = await queue.getJob(log.jobId!);
    expect(job).toBeTruthy();
    expect(await job!.getState()).toBe('completed');

    const getPerson = await serverA.waitForOperation('GetPerson', { timeoutMs: 5000 });
    expect(getPerson[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(getPerson[0].url).toBe('/graphql');
    expect(getPerson[0].body.variables).toEqual({ filter: { id: { eq: personId } } });

    const updates = serverA.getRequestsByOperation('UpdatePerson');
    expect(updates).toHaveLength(1);
    expect(updates[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(updates[0].body.variables).toEqual({
      personId,
      data: {
        jobTitle: 'VP Engineering',
        companyId: 'co_acme',
      },
    });

    const notes = serverA.getRequestsByOperation('CreateNote');
    expect(notes).toHaveLength(1);
    expect(notes[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(JSON.stringify(notes[0].body.variables)).toContain('AI Automation: Score');

    const noteTargets = serverA.getRequestsByOperation('CreateNoteTarget');
    expect(noteTargets).toHaveLength(1);

    const opps = serverA.getRequestsByOperation('CreateOpportunity');
    expect(opps).toHaveLength(1);
    expect(opps[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(opps[0].body.variables).toMatchObject({
      data: {
        pointOfContactId: personId,
        name: 'Ada - Auto-qualified',
        stage: 'NEW',
      },
    });

    // Operation order: read before writes.
    expect(getPerson[0].order).toBeLessThan(updates[0].order);
    expect(updates[0].order).toBeLessThan(notes[0].order);
    expect(notes[0].order).toBeLessThan(noteTargets[0].order);
    expect(noteTargets[0].order).toBeLessThan(opps[0].order);

    const history = await prisma.scoreHistory.findFirst({
      where: { tenantId: tenantAId, personTwentyId: personId },
    });
    expect(history).toBeTruthy();
    expect(history!.score).toBeGreaterThanOrEqual(50);
    expect(history!.opportunityCreated).toBe(true);
    expect(history!.opportunityTwentyId).toMatch(/^opp_contract_\d+$/);

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenantAId,
        action: 'enrich_and_score_person',
        resourceTwentyId: personId,
      },
    });
    expect(audit).toBeTruthy();
    expect(audit!.success).toBe(true);
    expect(audit!.webhookLogId).toBe(log.id);

    // Tenant isolation: worker for A never touches B's fake Twenty.
    expect(serverB.getRequests()).toHaveLength(0);
  }, 60000);

  it('isolates Tenant B worker write-back from Tenant A credentials/endpoints', async () => {
    const personId = `person_worker_b_${Date.now()}`;
    serverB.seedPerson({
      id: personId,
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@acme.test',
      jobTitle: 'Director',
      updatedAt: new Date().toISOString(),
    });

    const response = await postSignedWebhook(
      tenantBId,
      webhookSecretB,
      buildPayload(personId, {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@acme.test',
        jobTitle: 'Director',
      }),
      `worker-writeback-b-${personId}`,
    );
    expect(response.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantBId, event: 'person.created' },
          orderBy: { createdAt: 'desc' },
        });
        return log?.status === 'success';
      },
      { timeoutMs: 30000, label: 'Tenant B WebhookLog success' },
    );

    const reqs = serverB.getRequests();
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.every(r => r.authorization === `Bearer ${apiKeyB}`)).toBe(true);
    expect(reqs.every(r => r.authorization !== `Bearer ${apiKeyA}`)).toBe(true);
    expect(serverA.getRequests()).toHaveLength(0);
  }, 60000);

  it('records failure when enrichment throws UnrecoverableError (no false success audit)', async () => {
    enrichmentControl.mode = 'unrecoverable';
    const personId = `person_worker_fail_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Fail',
      lastName: 'Case',
      email: 'fail@acme.test',
      jobTitle: 'VP Engineering',
      updatedAt: new Date().toISOString(),
    });

    const response = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-fail-${personId}`,
    );
    expect(response.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId },
          orderBy: { createdAt: 'desc' },
        });
        return log?.status === 'failed';
      },
      { timeoutMs: 20000, label: 'WebhookLog failed' },
    );

    const log = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.status).toBe('failed');
    expect(log.error).toContain('contract enrichment failure');
    expect(log.processedAt).toBeNull();

    const job = await queue.getJob(log.jobId!);
    expect(job).toBeTruthy();
    expect(await job!.getState()).toBe('failed');

    const successAudit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenantAId,
        resourceTwentyId: personId,
        action: 'enrich_and_score_person',
        success: true,
      },
    });
    expect(successAudit).toBeNull();

    // GetPerson may have run before enrichment failed; writes must not complete.
    expect(serverA.getRequestsByOperation('UpdatePerson')).toHaveLength(0);
    expect(serverA.getRequestsByOperation('CreateNote')).toHaveLength(0);
    expect(serverA.getRequestsByOperation('CreateOpportunity')).toHaveLength(0);
  }, 60000);

  it('fails the job when UpdatePerson GraphQL errors (no false success audit)', async () => {
    // Terminal CRM failure without waiting through production 5× backoff:
    // BULLMQ_ENRICH_ATTEMPTS=1 is a test-only timing override; production default remains 5.
    process.env.BULLMQ_ENRICH_ATTEMPTS = '1';

    const personId = `person_worker_writefail_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.test',
      jobTitle: 'Engineer',
      updatedAt: new Date().toISOString(),
    });
    serverA.failOperation('UpdatePerson');

    const response = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-writefail-${personId}`,
    );
    expect(response.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId },
          orderBy: { createdAt: 'desc' },
        });
        if (!log?.jobId) return false;
        const job = await queue.getJob(log.jobId);
        return (await job?.getState()) === 'failed';
      },
      { timeoutMs: 30000, label: 'BullMQ job failed after UpdatePerson error' },
    );

    delete process.env.BULLMQ_ENRICH_ATTEMPTS;

    expect(serverA.getRequestsByOperation('UpdatePerson').length).toBeGreaterThanOrEqual(1);
    expect(serverA.getRequestsByOperation('CreateNote')).toHaveLength(0);
    expect(serverA.getRequestsByOperation('CreateOpportunity')).toHaveLength(0);

    const log = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.status).toBe('failed');
    expect(log.error).toBeTruthy();
    expect(log.processedAt).toBeNull();

    const successAudit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenantAId,
        resourceTwentyId: personId,
        action: 'enrich_and_score_person',
        success: true,
      },
    });
    expect(successAudit).toBeNull();

    const history = await prisma.scoreHistory.findFirst({
      where: { tenantId: tenantAId, personTwentyId: personId },
    });
    expect(history).toBeNull();
  }, 60000);

  it('fails the job when CreateOpportunity GraphQL errors (no synthetic pending opportunity)', async () => {
    process.env.BULLMQ_ENRICH_ATTEMPTS = '1';

    const personId = `person_worker_oppfail_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.test',
      jobTitle: 'Engineer',
      updatedAt: new Date().toISOString(),
    });
    serverA.failOperation('CreateOpportunity');

    const response = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-oppfail-${personId}`,
    );
    expect(response.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId },
          orderBy: { createdAt: 'desc' },
        });
        if (!log?.jobId) return false;
        const job = await queue.getJob(log.jobId);
        return (await job?.getState()) === 'failed';
      },
      { timeoutMs: 30000, label: 'BullMQ job failed after CreateOpportunity error' },
    );

    delete process.env.BULLMQ_ENRICH_ATTEMPTS;

    expect(serverA.getRequestsByOperation('UpdatePerson').length).toBeGreaterThanOrEqual(1);
    expect(serverA.getRequestsByOperation('CreateNote').length).toBeGreaterThanOrEqual(1);
    expect(serverA.getRequestsByOperation('CreateOpportunity').length).toBeGreaterThanOrEqual(1);

    const log = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.status).toBe('failed');
    expect(log.error).toBeTruthy();

    const history = await prisma.scoreHistory.findFirst({
      where: { tenantId: tenantAId, personTwentyId: personId },
    });
    expect(history).toBeNull();

    const successAudit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenantAId,
        resourceTwentyId: personId,
        success: true,
      },
    });
    expect(successAudit).toBeNull();
    expect(
      JSON.stringify(await prisma.scoreHistory.findMany({ where: { tenantId: tenantAId } })),
    ).not.toContain('pending-twenty-');
  }, 60000);

  it('skips committed CRM writes on retry after partial success (one note, one opportunity)', async () => {
    process.env.BULLMQ_ENRICH_BACKOFF_MS = '200';

    const personId = `person_worker_idempotent_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.test',
      jobTitle: 'Engineer',
      updatedAt: new Date().toISOString(),
    });
    serverA.failOperationTimes('CreateOpportunity', 1);

    const eventId = `worker-idempotent-${personId}`;
    const response = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      eventId,
    );
    expect(response.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId, event: 'person.created' },
          orderBy: { createdAt: 'desc' },
        });
        if (log?.status !== 'success' || !log.jobId) return false;
        const job = await queue.getJob(log.jobId);
        return (await job?.getState()) === 'completed';
      },
      { timeoutMs: 45000, label: 'partial-success retry completed' },
    );

    delete process.env.BULLMQ_ENRICH_BACKOFF_MS;

    expect(serverA.countOperations('UpdatePerson')).toBe(1);
    expect(serverA.countOperations('CreateNote')).toBe(1);
    expect(serverA.countOperations('CreateOpportunity')).toBe(2);

    const log = await prisma.webhookLog.findFirstOrThrow({
      where: { tenantId: tenantAId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.status).toBe('success');
    expect(log.jobResult).toMatchObject({ opportunityCreated: true });

    const checkpoints = await prisma.jobActionCheckpoint.findMany({
      where: { tenantId: tenantAId, webhookLogId: log.id },
    });
    expect(checkpoints.map(c => c.action).sort()).toEqual([
      'create_note',
      'create_opportunity',
      'update_person',
    ]);

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenantAId,
        resourceTwentyId: personId,
        action: 'enrich_and_score_person',
        success: true,
      },
    });
    expect(audit).toBeTruthy();
  }, 90000);

  it('does not suppress CRM writes for a different webhook event on the same person', async () => {
    const personId = `person_worker_separate_event_${Date.now()}`;
    serverA.seedPerson({
      id: personId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@acme.test',
      jobTitle: 'Engineer',
      updatedAt: new Date().toISOString(),
    });

    const first = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-event-a-${personId}`,
    );
    expect(first.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const log = await prisma.webhookLog.findFirst({
          where: { tenantId: tenantAId },
          orderBy: { createdAt: 'desc' },
        });
        return log?.status === 'success';
      },
      { timeoutMs: 30000, label: 'first webhook success' },
    );

    serverA.clearRequests();

    const second = await postSignedWebhook(
      tenantAId,
      webhookSecretA,
      buildPayload(personId),
      `worker-event-b-${personId}`,
    );
    expect(second.statusCode).toBe(200);

    await waitForCondition(
      async () => {
        const logs = await prisma.webhookLog.findMany({
          where: { tenantId: tenantAId, event: 'person.created' },
          orderBy: { createdAt: 'desc' },
        });
        return logs.length >= 2 && logs[0]?.status === 'success';
      },
      { timeoutMs: 30000, label: 'second webhook success' },
    );

    expect(serverA.countOperations('UpdatePerson')).toBe(1);
    expect(serverA.countOperations('CreateNote')).toBe(1);
    expect(serverA.countOperations('CreateOpportunity')).toBe(1);
  }, 90000);
});
