import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CommonModule } from '@src/common/common.module';
import { PrismaModule } from '@src/common/prisma/prisma.module';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { envSchema } from '@src/config/env.schema';
import { TwentyClient } from '@src/twenty/twenty.client';
import { TwentyModule } from '@src/twenty/twenty.module';
import { FakeTwentyGraphqlServer } from './fake-twenty-server';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
} from './helpers';

/**
 * CRM contract tests — real TwentyClient + Prisma TwentyConnection resolution
 * against a localhost fake GraphQL server. TwentyClient is NOT mocked.
 */
describe('CRM contract: TwentyClient HTTP boundary', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let twenty: TwentyClient;
  let crypto = createCryptoFromEnv();

  const serverA = new FakeTwentyGraphqlServer();
  const serverB = new FakeTwentyGraphqlServer();

  let urlsA: { baseUrl: string; graphqlUrl: string; restUrl: string };
  let urlsB: { baseUrl: string; graphqlUrl: string; restUrl: string };
  let tenantAId: string;
  let tenantBId: string;

  const apiKeyA = 'sk_contract_tenant_a';
  const apiKeyB = 'sk_contract_tenant_b';
  const webhookA = 'whsec_contract_a';
  const webhookB = 'whsec_contract_b';

  beforeAll(async () => {
    urlsA = await serverA.start();
    urlsB = await serverB.start();

    serverA.seedPerson({
      id: 'person_a1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@analytical.engine',
      jobTitle: 'VP of Engineering',
      company: { id: 'co_a', name: 'Analytical Engine', website: 'analytical.engine' },
    });
    serverB.seedPerson({
      id: 'person_b1',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@cobol.test',
      jobTitle: 'Director',
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validationSchema: envSchema,
          validationOptions: { abortEarly: false },
        }),
        PrismaModule,
        CommonModule,
        TwentyModule,
      ],
    }).compile();

    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    twenty = moduleRef.get(TwentyClient);
    crypto = createCryptoFromEnv();

    const seededA = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Contract Tenant A',
      workspaceId: 'ws_contract_a',
      baseUrl: urlsA.baseUrl,
      graphqlUrl: urlsA.graphqlUrl,
      restUrl: urlsA.restUrl,
      apiKeyPlain: apiKeyA,
      webhookSecretPlain: webhookA,
    });
    const seededB = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Contract Tenant B',
      workspaceId: 'ws_contract_b',
      baseUrl: urlsB.baseUrl,
      graphqlUrl: urlsB.graphqlUrl,
      restUrl: urlsB.restUrl,
      apiKeyPlain: apiKeyB,
      webhookSecretPlain: webhookB,
    });
    tenantAId = seededA.tenantId;
    tenantBId = seededB.tenantId;
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      if (tenantAId) await deleteTenantCascade(prisma, tenantAId);
      if (tenantBId) await deleteTenantCascade(prisma, tenantBId);
    }
    await moduleRef?.close();
    await serverA.stop();
    await serverB.stop();
  });

  beforeEach(() => {
    serverA.clearRequests();
    serverB.clearRequests();
  });

  it('getPerson resolves tenant-specific GraphQL URL + bearer token from encrypted TwentyConnection', async () => {
    const person = await twenty.getPerson(tenantAId, 'person_a1');

    expect(person).toMatchObject({
      id: 'person_a1',
      email: 'ada@analytical.engine',
      firstName: 'Ada',
      jobTitle: 'VP of Engineering',
    });

    const requests = serverA.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/graphql');
    expect(requests[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(requests[0].body.query).toEqual(expect.stringContaining('GetPerson'));
    expect(requests[0].body.variables).toEqual({
      filter: { id: { eq: 'person_a1' } },
    });
    expect(serverB.getRequests()).toHaveLength(0);
  });

  it('updatePerson writes to the tenant GraphQL endpoint with expected mutation variables', async () => {
    const updated = await twenty.updatePerson(tenantAId, 'person_a1', {
      jobTitle: 'Chief Engineer',
      companyId: 'co_a',
    });

    expect(updated).toMatchObject({
      id: 'person_a1',
      jobTitle: 'Chief Engineer',
    });

    const requests = serverA.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(requests[0].body.query).toEqual(expect.stringContaining('UpdatePerson'));
    expect(requests[0].body.variables).toEqual({
      personId: 'person_a1',
      data: {
        jobTitle: 'Chief Engineer',
        companyId: 'co_a',
      },
    });
    expect(serverB.getRequests()).toHaveLength(0);
  });

  it('isolates Tenant A and Tenant B endpoints and credentials', async () => {
    await twenty.getPerson(tenantAId, 'person_a1');
    await twenty.getPerson(tenantBId, 'person_b1');

    const reqA = serverA.getRequests();
    const reqB = serverB.getRequests();

    expect(reqA).toHaveLength(1);
    expect(reqB).toHaveLength(1);
    expect(reqA[0].authorization).toBe(`Bearer ${apiKeyA}`);
    expect(reqB[0].authorization).toBe(`Bearer ${apiKeyB}`);
    expect(reqA[0].authorization).not.toBe(reqB[0].authorization);

    // Different fake servers / ports prove distinct graphqlUrl resolution from DB.
    expect(urlsA.graphqlUrl).not.toBe(urlsB.graphqlUrl);
    expect(reqA[0].authorization).not.toContain(apiKeyB);
    expect(reqB[0].authorization).not.toContain(apiKeyA);
  });
});
