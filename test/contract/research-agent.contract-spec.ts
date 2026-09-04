import { getQueueToken } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE, NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { AuditModule } from '@src/audit/audit.module';
import { CommonModule } from '@src/common/common.module';
import { LoggerModule } from '@src/common/logger/logger.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { envSchema } from '@src/config/env.schema';
import { PROSPECT_RESEARCH_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryModule } from '@src/prospect-discovery/prospect-discovery.module';
import { ResearchAgentModule } from '@src/research-agent/research-agent.module';
import { ResearchAgentService } from '@src/research-agent/research-agent.service';
import { TwentyClient } from '@src/twenty/twenty.client';
import { TwentyModule } from '@src/twenty/twenty.module';
import { WhyNowModule } from '@src/why-now/why-now.module';
import { FakeTwentyGraphqlServer } from './fake-twenty-server';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
} from './helpers';

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
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    LoggerModule,
    PrismaModule,
    CommonModule,
    AuditModule,
    TwentyModule,
    CompanyBrainModule,
    ProspectDiscoveryModule,
    WhyNowModule,
    ResearchAgentModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
class ResearchAgentContractAppModule {}

const BRAIN_TEXT = `
ZEX Platform is a B2B SaaS revenue intelligence product.
Industry: SaaS, B2B
Company size: 11-50
Geography: US, UK
Use cases: lead enrichment, scoring automation
Buying triggers: CRM migration, outbound scaling
Disqualifiers: consumer marketplaces
Persona: VP Sales
Persona: Head of Revenue Operations
Pain points: manual research
Value propositions: evidence-backed automation
Differentiators: provenance
Messaging themes: trust, speed
`;

type CandidateBody = {
  id: string;
  status: string;
  providerKey?: string;
  companyName?: string;
};

describe('Research Agent contract (ZEX-35)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fake: FakeTwentyGraphqlServer;
  let tenantA: string;
  let tenantB: string;
  let researchQueue: Queue;
  let twenty: TwentyClient;
  let researchService: ResearchAgentService;
  const mutationSpies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    process.env.COMPANY_BRAIN_DETERMINISTIC = 'true';
    process.env.PROSPECT_DISCOVERY_DETERMINISTIC = 'true';
    process.env.WHY_NOW_DETERMINISTIC = 'true';
    process.env.RESEARCH_AGENT_DETERMINISTIC = 'true';

    fake = new FakeTwentyGraphqlServer();
    const urls = await fake.start();

    app = await NestFactory.create<NestFastifyApplication>(
      ResearchAgentContractAppModule,
      new FastifyAdapter({ logger: false }),
      { bufferLogs: true, logger: false, abortOnError: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    researchQueue = app.get(getQueueToken(PROSPECT_RESEARCH_QUEUE));
    twenty = app.get(TwentyClient);
    researchService = app.get(ResearchAgentService);

    for (const method of [
      'createCompany',
      'createNote',
      'createNoteTarget',
      'createOpportunity',
      'updatePerson',
    ] as const) {
      mutationSpies.push(jest.spyOn(twenty, method));
    }

    const crypto = createCryptoFromEnv();
    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Research A',
      workspaceId: 'ws-research-a',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'research_a_api_key_xxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'research_a_webhook_secret_xxxx',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Research B',
      workspaceId: 'ws-research-b',
      baseUrl: urls.baseUrl,
      graphqlUrl: urls.graphqlUrl,
      restUrl: urls.restUrl,
      apiKeyPlain: 'research_b_api_key_xxxxxxxxxxxxxxxx',
      webhookSecretPlain: 'research_b_webhook_secret_xxxx',
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
  }, 120000);

  afterAll(async () => {
    if (tenantA) await deleteTenantCascade(prisma, tenantA);
    if (tenantB) await deleteTenantCascade(prisma, tenantB);
    await researchQueue?.close();
    await app?.close();
    await fake.stop();
  });

  async function admin(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${process.env.ADMIN_API_KEY}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      payload: body,
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function seedPipeline() {
    const brain = await admin('POST', `/api/v1/admin/tenants/${tenantA}/company-brain`, {
      companyName: 'ZEX Platform',
      pastedText: BRAIN_TEXT,
      analyze: true,
      sync: true,
    });
    expect(brain.statusCode).toBeLessThan(300);
    const companyBrainId = String(brain.body.id);

    const discover = await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospect-discovery`, {
      companyBrainId,
      sync: true,
    });
    expect(discover.statusCode).toBe(201);
    const candidates = (discover.body.candidates as CandidateBody[]) || [];
    const strong = candidates.find(c => c.providerKey === 'det_strong_fit');
    expect(strong).toBeTruthy();

    await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospects/${strong!.id}/why-now`, {
      sync: true,
      collectSignals: true,
      fixture: 'strong_why_now',
    });

    return { companyBrainId, strong: strong! };
  }

  it('blocks research before approval; then researches; history/dedupe/isolation/failure', async () => {
    const { strong } = await seedPipeline();

    // 4. Before approval → blocked (high Why-Now is not authorization)
    const blocked = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research`,
      {
        sync: true,
        fixture: 'strong_research',
      },
    );
    expect(blocked.statusCode).toBe(400);
    expect(String(blocked.body.message || '')).toMatch(/APPROVED|CREATED/i);

    // 5. Approve
    const approved = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospect-discovery/candidates/${strong.id}/approve`,
    );
    expect(approved.statusCode).toBeLessThan(300);
    expect(approved.body.status).toBe('APPROVED');

    // 6–10. Deterministic research
    const researched = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research`,
      { sync: true, fixture: 'strong_research' },
    );
    expect(researched.statusCode).toBeLessThan(300);
    expect(researched.body.status).toBe('COMPLETED');
    expect(Number(researched.body.findingCount)).toBeGreaterThanOrEqual(5);
    expect(researched.body.package).toBeTruthy();
    const pkg = researched.body.package as Record<string, unknown>;
    const outreach = pkg.outreachContext as Record<string, unknown>;
    expect(Array.isArray(outreach.personalizationFacts)).toBe(true);
    expect(Array.isArray(outreach.doNotClaim)).toBe(true);
    expect(JSON.stringify(pkg).toLowerCase()).not.toMatch(/congrats on your series/);
    expect(JSON.stringify(pkg).toLowerCase()).not.toMatch(/i saw your team recently/);
    const findings = researched.body.findings as Array<Record<string, unknown>>;
    expect(findings.every(f => f.excerpt || f.sourceUrl || f.sourceTitle)).toBe(true);
    expect(findings.some(f => f.personName === 'Jordan Lee')).toBe(true);
    expect(pkg.whyNowSnapshotId).toBeTruthy();

    // 11. No Twenty mutations
    for (const spy of mutationSpies) {
      expect(spy).not.toHaveBeenCalled();
    }

    const firstFindingCount = await prisma.prospectResearchFinding.count({
      where: { tenantId: tenantA, prospectCandidateId: strong.id },
    });

    // 12–14. Re-run → history + dedupe
    const second = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research`,
      { sync: true, fixture: 'strong_research' },
    );
    expect(second.statusCode).toBeLessThan(300);
    expect(second.body.status).toBe('COMPLETED');
    const history = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research/history`,
    );
    expect(history.statusCode).toBe(200);
    expect((history.body.runs as unknown[]).length).toBeGreaterThanOrEqual(2);

    const afterFindingCount = await prisma.prospectResearchFinding.count({
      where: { tenantId: tenantA, prospectCandidateId: strong.id },
    });
    expect(afterFindingCount).toBe(firstFindingCount);

    const latest = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research/latest`,
    );
    expect(latest.statusCode).toBe(200);
    expect(latest.body.id).toBe(second.body.id);

    // 15. Tenant B → 404
    expect(
      (
        await admin(
          'GET',
          `/api/v1/admin/tenants/${tenantB}/prospects/${strong.id}/research/latest`,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await admin('POST', `/api/v1/admin/tenants/${tenantB}/prospects/${strong.id}/research`, {
          sync: true,
          fixture: 'sparse_research',
        })
      ).statusCode,
    ).toBe(404);

    // 16. Rejected cannot research
    const discover2 = await admin('POST', `/api/v1/admin/tenants/${tenantA}/prospect-discovery`, {
      companyBrainId: (
        await prisma.prospectDiscoveryRun.findFirstOrThrow({
          where: { tenantId: tenantA },
          orderBy: { createdAt: 'desc' },
        })
      ).companyBrainId,
      sync: true,
    });
    const fresh = ((discover2.body.candidates as CandidateBody[]) || []).find(
      c => c.providerKey === 'det_new_valid',
    );
    expect(fresh).toBeTruthy();
    await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospect-discovery/candidates/${fresh!.id}/approve`,
    );
    await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospect-discovery/candidates/${fresh!.id}/reject`,
    );
    const rejectedResearch = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${fresh!.id}/research`,
      { sync: true, fixture: 'sparse_research' },
    );
    expect(rejectedResearch.statusCode).toBe(400);

    // 17. Audits
    const audits = await prisma.auditLog.findMany({ where: { tenantId: tenantA } });
    const actions = new Set(audits.map(a => a.action));
    for (const required of [
      'research_blocked_not_approved',
      'research_run_created',
      'research_started',
      'research_completed',
      'research_finding_created',
      'research_finding_duplicate_detected',
    ]) {
      expect(actions.has(required)).toBe(true);
    }

    // 18. Provider failure leaves previous good run intact
    const fail = await admin(
      'POST',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research`,
      { sync: true, fixture: 'provider_failure' },
    );
    expect(fail.statusCode).toBeGreaterThanOrEqual(400);
    const latestAfterFail = await admin(
      'GET',
      `/api/v1/admin/tenants/${tenantA}/prospects/${strong.id}/research/latest`,
    );
    expect(latestAfterFail.statusCode).toBe(200);
    expect(latestAfterFail.body.status).toBe('COMPLETED');
    expect(latestAfterFail.body.id).toBe(second.body.id);

    const failedRuns = await prisma.prospectResearchRun.findMany({
      where: { tenantId: tenantA, prospectCandidateId: strong.id, status: 'FAILED' },
    });
    expect(failedRuns.length).toBeGreaterThanOrEqual(1);
    expect(failedRuns.every(r => r.package == null)).toBe(true);

    // Worker re-check: APPROVED → queue run → REJECTED before execute → BLOCKED
    const raceCand = ((discover2.body.candidates as CandidateBody[]) || []).find(
      c => c.providerKey === 'det_strong_fit' && c.id !== strong.id,
    );
    // Use a dedicated approved candidate from a new discovery if needed
    let raceId = raceCand?.id;
    if (!raceId) {
      // Approve strong already done; create via prisma status flip on fresh rejected reverse — use another proposed
      const proposed = await prisma.prospectCandidate.findFirst({
        where: { tenantId: tenantA, status: 'PROPOSED' },
      });
      expect(proposed).toBeTruthy();
      await prisma.prospectCandidate.update({
        where: { id: proposed!.id },
        data: { status: 'APPROVED', dedupeStatus: 'NEW' },
      });
      raceId = proposed!.id;
    } else {
      await admin(
        'POST',
        `/api/v1/admin/tenants/${tenantA}/prospect-discovery/candidates/${raceId}/approve`,
      );
    }

    const queued = await researchService.startResearch(
      tenantA,
      raceId!,
      { sync: false, fixture: 'strong_research' },
      'contract-race',
    );
    expect(queued.status).toBe('queued');
    await prisma.prospectCandidate.update({
      where: { id: raceId! },
      data: { status: 'REJECTED' },
    });
    const raceResult = await researchService.executeResearch({
      tenantId: tenantA,
      candidateId: raceId!,
      runId: String((queued as { researchRunId: string }).researchRunId),
      fixture: 'strong_research',
      triggeredBy: 'contract-race-worker',
    });
    expect(raceResult.status).toBe('BLOCKED');

    for (const spy of mutationSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  }, 120000);
});
