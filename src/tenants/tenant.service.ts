import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * Transitional field adapter: prefer new connection field names, fall back to legacy DTO aliases.
   */
  private resolveConnectionInput(input: CreateTenantDto) {
    const workspaceId = input.workspaceId || input.twentyWorkspaceId;
    const apiKeyPlain = input.apiKey || input.twentyApiKey;

    if (!workspaceId || !apiKeyPlain) {
      throw new BadRequestException(
        'workspaceId (or twentyWorkspaceId) and apiKey (or twentyApiKey) are required',
      );
    }

    if (!input.baseUrl || !input.graphqlUrl || !input.restUrl) {
      throw new BadRequestException(
        'baseUrl, graphqlUrl, and restUrl are required — Twenty endpoints are never inferred from workspace id or global env',
      );
    }

    return {
      workspaceId,
      apiKeyPlain,
      baseUrl: input.baseUrl,
      graphqlUrl: input.graphqlUrl,
      restUrl: input.restUrl,
      twentyVersion: input.twentyVersion ?? null,
    };
  }

  async createTenant(input: CreateTenantDto) {
    const slugBase = this.slugify(input.name) || 'tenant';
    const slug = `${slugBase}-${randomBytes(3).toString('hex')}`;
    const connectionInput = this.resolveConnectionInput(input);

    // webhookSecret is required input; encrypt immediately; never return or log plaintext.
    const encryptedApiKey = this.crypto.encrypt(connectionInput.apiKeyPlain);
    const encryptedWebhookSecret = this.crypto.encrypt(input.webhookSecret);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: input.name,
        slug,
        // Legacy Tenant columns kept in sync for staged migration (do not remove yet).
        twentyWorkspaceId: connectionInput.workspaceId,
        twentyApiKey: encryptedApiKey,
        twentyWebhookSecret: encryptedWebhookSecret,
        scoringRules: {
          create: {
            name: 'Default Scoring',
            enabled: true,
            priority: 10,
            rules: DEFAULT_SCORING_RULES,
          },
        },
        twentyConnection: {
          create: {
            workspaceId: connectionInput.workspaceId,
            baseUrl: connectionInput.baseUrl,
            graphqlUrl: connectionInput.graphqlUrl,
            restUrl: connectionInput.restUrl,
            apiKey: encryptedApiKey,
            webhookSecret: encryptedWebhookSecret,
            twentyVersion: connectionInput.twentyVersion,
            status: 'active',
          },
        },
      },
      include: { twentyConnection: true },
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

    // Non-sensitive provisioning only — never return API keys or webhook secrets.
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      webhookUrl: `${base}/webhooks/twenty/${tenant.id}`,
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
      include: { scoringRules: true, twentyConnection: true },
    });
    if (!tenant) return null;

    const connection = tenant.twentyConnection;

    return {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      /** @deprecated Prefer twentyConnection.workspaceId */
      twentyWorkspaceId: connection?.workspaceId ?? tenant.twentyWorkspaceId,
      twentyConnection: connection
        ? {
            workspaceId: connection.workspaceId,
            baseUrl: connection.baseUrl,
            graphqlUrl: connection.graphqlUrl,
            restUrl: connection.restUrl,
            twentyVersion: connection.twentyVersion,
            status: connection.status,
            lastVerifiedAt: connection.lastVerifiedAt,
          }
        : null,
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
