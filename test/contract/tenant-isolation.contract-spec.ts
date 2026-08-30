import { TwentyConnectionService } from '@src/twenty/twenty-connection.service';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@src/common/crypto.service';
import {
  CRM_WRITE_ACTIONS,
  JobActionCheckpointService,
} from '@src/jobs/job-action-checkpoint.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import {
  createCryptoFromEnv,
  deleteTenantCascade,
  seedTenantWithTwentyConnection,
} from './helpers';

/**
 * Negative tenant isolation tests — connection resolution and checkpoint scoping.
 */
describe('Tenant isolation (negative)', () => {
  const crypto = createCryptoFromEnv();
  let prisma: PrismaService;
  let connections: TwentyConnectionService;
  let checkpoints: JobActionCheckpointService;

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'MASTER_KEY') return process.env.MASTER_KEY;
        throw new Error(key);
      },
    } as ConfigService;

    prisma = new PrismaService();
    await prisma.$connect();
    connections = new TwentyConnectionService(prisma, new CryptoService(config));
    checkpoints = new JobActionCheckpointService(prisma);

    const urls = {
      baseUrl: 'http://127.0.0.1:1',
      graphqlUrl: 'http://127.0.0.1:1/graphql',
      restUrl: 'http://127.0.0.1:1/rest',
    };

    const a = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Isolation A',
      workspaceId: 'ws_iso_a',
      ...urls,
      apiKeyPlain: 'sk_iso_a',
      webhookSecretPlain: 'whsec_iso_a',
    });
    const b = await seedTenantWithTwentyConnection(prisma, crypto, {
      name: 'Isolation B',
      workspaceId: 'ws_iso_b',
      ...urls,
      apiKeyPlain: 'sk_iso_b',
      webhookSecretPlain: 'whsec_iso_b',
    });
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
  }, 60000);

  afterAll(async () => {
    if (tenantAId) await deleteTenantCascade(prisma, tenantAId);
    if (tenantBId) await deleteTenantCascade(prisma, tenantBId);
    await prisma?.$disconnect();
  });

  it('Tenant A cannot resolve Tenant B TwentyConnection credentials', async () => {
    const a = await connections.resolve(tenantAId);
    const b = await connections.resolve(tenantBId);

    expect(a.apiKey).toBe('sk_iso_a');
    expect(b.apiKey).toBe('sk_iso_b');
    expect(a.apiKey).not.toBe(b.apiKey);
    expect(a.graphqlUrl).toBe(b.graphqlUrl);
  });

  it('Tenant A checkpoint does not suppress Tenant B action for same webhookLogId string', async () => {
    const sharedLogId = `shared_log_${Date.now()}`;

    await checkpoints.recordSuccess(
      tenantAId,
      sharedLogId,
      'person_x',
      CRM_WRITE_ACTIONS.CREATE_NOTE,
    );

    const tenantBState = await checkpoints.getCompleted(
      tenantBId,
      sharedLogId,
      CRM_WRITE_ACTIONS.CREATE_NOTE,
    );
    expect(tenantBState.completed).toBe(false);

    const rows = await prisma.jobActionCheckpoint.findMany({
      where: { webhookLogId: sharedLogId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantAId);
  });
});
