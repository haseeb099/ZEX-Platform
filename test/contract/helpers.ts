import { createHmac, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { CryptoService } from '@src/common/crypto.service';
import { PrismaService } from '@src/common/prisma/prisma.service';

export type SeededTenant = {
  tenantId: string;
  slug: string;
  workspaceId: string;
  apiKeyPlain: string;
  webhookSecretPlain: string;
  graphqlUrl: string;
  baseUrl: string;
  restUrl: string;
};

export function createCryptoFromEnv(): CryptoService {
  return new CryptoService({
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`Missing env ${key}`);
      return value;
    },
  } as ConfigService);
}

export async function seedTenantWithTwentyConnection(
  prisma: PrismaService,
  crypto: CryptoService,
  input: {
    name: string;
    workspaceId: string;
    baseUrl: string;
    graphqlUrl: string;
    restUrl: string;
    apiKeyPlain: string;
    webhookSecretPlain: string;
  },
): Promise<SeededTenant> {
  const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`;
  const encryptedApiKey = crypto.encrypt(input.apiKeyPlain);
  const encryptedWebhookSecret = crypto.encrypt(input.webhookSecretPlain);

  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug,
      twentyWorkspaceId: input.workspaceId,
      twentyApiKey: encryptedApiKey,
      twentyWebhookSecret: encryptedWebhookSecret,
      status: 'active',
      twentyConnection: {
        create: {
          workspaceId: input.workspaceId,
          baseUrl: input.baseUrl,
          graphqlUrl: input.graphqlUrl,
          restUrl: input.restUrl,
          apiKey: encryptedApiKey,
          webhookSecret: encryptedWebhookSecret,
          status: 'active',
        },
      },
      scoringRules: {
        create: {
          name: 'Contract Default',
          enabled: true,
          priority: 10,
          rules: {
            filters: [],
            scoring: {
              titleKeywords: { keywords: ['VP', 'Director'], weight: 25 },
              companySizeMatch: { weight: 20 },
              industryMatch: { weight: 20 },
              activityRecency: { weight: 15, daysThreshold: 7 },
            },
          },
        },
      },
    },
  });

  await prisma.enrichmentProvider.create({
    data: { tenantId: tenant.id },
  });

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    workspaceId: input.workspaceId,
    apiKeyPlain: input.apiKeyPlain,
    webhookSecretPlain: input.webhookSecretPlain,
    graphqlUrl: input.graphqlUrl,
    baseUrl: input.baseUrl,
    restUrl: input.restUrl,
  };
}

export async function deleteTenantCascade(prisma: PrismaService, tenantId: string) {
  await prisma.jobActionCheckpoint.deleteMany({ where: { tenantId } });
  await prisma.webhookLog.deleteMany({ where: { tenantId } });
  await prisma.scoreHistory.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.enrichedPerson.deleteMany({ where: { tenantId } });
  await prisma.enrichmentProvider.deleteMany({ where: { tenantId } });
  await prisma.scoringRule.deleteMany({ where: { tenantId } });
  await prisma.companyBrainAnalysisJob.deleteMany({ where: { tenantId } });
  await prisma.companyBrainSource.deleteMany({ where: { tenantId } });
  await prisma.companyBrain.deleteMany({ where: { tenantId } });
  await prisma.twentyConnection.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

export function signTwentyWebhook(rawBody: string, secret: string, timestamp: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}:${rawBody}`, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const intervalMs = options.intervalMs ?? 50;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout waiting for ${options.label || 'condition'} after ${timeoutMs}ms`);
}

export async function countEnrichJobsForPerson(
  queue: Queue,
  tenantId: string,
  personTwentyId: string,
): Promise<number> {
  const jobs = await queue.getJobs([
    'waiting',
    'active',
    'completed',
    'delayed',
    'failed',
    'paused',
  ]);
  return jobs.filter(
    j =>
      j &&
      j.name === 'enrich-and-score-person' &&
      j.data?.tenantId === tenantId &&
      j.data?.personTwentyId === personTwentyId,
  ).length;
}
