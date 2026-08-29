import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from '@src/common/crypto.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

const DEFAULT_SCORING_RULES = {
  filters: [],
  scoring: {
    titleKeywords: { keywords: ['CEO', 'VP', 'Director', 'Founder', 'Head'], weight: 25 },
    companySizeMatch: { weight: 20 },
    industryMatch: { weight: 20 },
    activityRecency: { weight: 15, daysThreshold: 7 },
  },
};

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48);
  }

  async createTenant(input: CreateTenantDto) {
    const slugBase = this.slugify(input.name) || 'tenant';
    const slug = `${slugBase}-${randomBytes(3).toString('hex')}`;
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('hex')}`;

    const tenant = await this.prisma.tenant.create({
      data: {
        name: input.name,
        slug,
        twentyWorkspaceId: input.twentyWorkspaceId,
        twentyApiKey: this.crypto.encrypt(input.twentyApiKey),
        twentyWebhookSecret: this.crypto.encrypt(webhookSecretPlain),
        scoringRules: {
          create: {
            name: 'Default Scoring',
            enabled: true,
            priority: 10,
            rules: DEFAULT_SCORING_RULES,
          },
        },
      },
    });

    if (input.clearbitApiKey) {
      await this.prisma.enrichmentProvider.create({
        data: {
          tenantId: tenant.id,
          clearbitApiKey: this.crypto.encrypt(input.clearbitApiKey),
        },
      });
    } else {
      await this.prisma.enrichmentProvider.create({
        data: { tenantId: tenant.id },
      });
    }

    const base =
      input.publicBaseUrl || `http://localhost:${this.config.get<number>('PORT') || 3000}`;

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      webhookUrl: `${base}/webhooks/twenty/${tenant.id}`,
      webhookSecret: webhookSecretPlain,
    };
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async getTenantSafe(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { scoringRules: true },
    });
    if (!tenant) return null;

    return {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      twentyWorkspaceId: tenant.twentyWorkspaceId,
      settings: {
        autoOpportunity: {
          enabled: tenant.enableAutoOpportunity,
          threshold: tenant.opportunityThreshold,
        },
        enrichment: {
          enabled: tenant.enableEnrichment,
          providers: tenant.enrichmentProviders,
          monthlyBudget: tenant.enrichmentRequestsPerMonth,
        },
        scoring: {
          rules: tenant.scoringRules.map(r => ({
            id: r.id,
            name: r.name,
            enabled: r.enabled,
            priority: r.priority,
            rules: r.rules,
          })),
        },
      },
      createdAt: tenant.createdAt,
    };
  }
}
