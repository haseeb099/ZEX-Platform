import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@src/common/crypto.service';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  const masterKey = '0c3195a8c93513790c7d5dc3df85e3ab1bdcded9fee05fb9e3d37c818975acfc';
  const crypto = new CryptoService({
    getOrThrow: (key: string) => {
      if (key === 'MASTER_KEY') return masterKey;
      throw new Error(key);
    },
  } as ConfigService);

  const config = {
    get: (key: string) => (key === 'PORT' ? 3000 : undefined),
  } as ConfigService;

  function buildService() {
    const createdTenant = {
      id: 'tenant_new',
      slug: 'acme-abc123',
      name: 'Acme',
      twentyConnection: {
        workspaceId: 'ws_1',
        baseUrl: 'https://crm.example.com',
        graphqlUrl: 'https://crm.example.com/graphql',
        restUrl: 'https://crm.example.com/rest',
        apiKey: 'encrypted',
        webhookSecret: 'encrypted',
      },
    };

    const prisma = {
      tenant: {
        create: jest.fn().mockResolvedValue(createdTenant),
        findFirst: jest.fn(),
      },
      enrichmentProvider: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    return {
      service: new TenantService(prisma as never, crypto, config),
      prisma,
      createdTenant,
    };
  }

  it('creates TwentyConnection with encrypted credentials and never returns secrets on safe get', async () => {
    const { service, prisma } = buildService();

    const created = await service.createTenant({
      name: 'Acme',
      workspaceId: 'ws_1',
      baseUrl: 'https://crm.example.com',
      graphqlUrl: 'https://crm.example.com/graphql',
      restUrl: 'https://crm.example.com/rest',
      apiKey: 'sk_plain_api_key',
      webhookSecret: 'whsec_plain',
    });

    expect(created.tenantId).toBe('tenant_new');
    expect(created.webhookSecret).toBe('whsec_plain');

    const createArgs = prisma.tenant.create.mock.calls[0][0];
    expect(createArgs.data.twentyConnection.create.apiKey).not.toBe('sk_plain_api_key');
    expect(createArgs.data.twentyConnection.create.webhookSecret).not.toBe('whsec_plain');
    expect(crypto.decrypt(createArgs.data.twentyConnection.create.apiKey)).toBe('sk_plain_api_key');
    // Legacy columns kept in sync for staged migration
    expect(createArgs.data.twentyWorkspaceId).toBe('ws_1');
    expect(createArgs.data.twentyApiKey).toBe(createArgs.data.twentyConnection.create.apiKey);

    prisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant_new',
      name: 'Acme',
      slug: 'acme-abc123',
      plan: 'starter',
      status: 'active',
      twentyWorkspaceId: 'ws_1',
      twentyApiKey: createArgs.data.twentyApiKey,
      twentyWebhookSecret: createArgs.data.twentyWebhookSecret,
      enableAutoOpportunity: true,
      opportunityThreshold: 60,
      enableEnrichment: true,
      enrichmentProviders: ['clearbit'],
      enrichmentRequestsPerMonth: 5000,
      createdAt: new Date(),
      scoringRules: [],
      twentyConnection: {
        workspaceId: 'ws_1',
        baseUrl: 'https://crm.example.com',
        graphqlUrl: 'https://crm.example.com/graphql',
        restUrl: 'https://crm.example.com/rest',
        twentyVersion: null,
        status: 'active',
        lastVerifiedAt: null,
        apiKey: createArgs.data.twentyConnection.create.apiKey,
        webhookSecret: createArgs.data.twentyConnection.create.webhookSecret,
      },
    });

    const safe = await service.getTenantSafe('tenant_new');
    expect(safe).toBeTruthy();
    expect(JSON.stringify(safe)).not.toContain('sk_plain_api_key');
    expect(JSON.stringify(safe)).not.toContain('whsec_plain');
    expect(safe?.twentyConnection?.graphqlUrl).toBe('https://crm.example.com/graphql');
    expect((safe as { twentyApiKey?: string }).twentyApiKey).toBeUndefined();
    expect((safe as { twentyWebhookSecret?: string }).twentyWebhookSecret).toBeUndefined();
  });

  it('accepts legacy DTO aliases for workspace and API key', async () => {
    const { service, prisma } = buildService();
    await service.createTenant({
      name: 'Legacy Co',
      twentyWorkspaceId: 'ws_legacy',
      twentyApiKey: 'sk_legacy',
      baseUrl: 'https://legacy.example.com',
      graphqlUrl: 'https://legacy.example.com/graphql',
      restUrl: 'https://legacy.example.com/rest',
    });
    const createArgs = prisma.tenant.create.mock.calls[0][0];
    expect(createArgs.data.twentyConnection.create.workspaceId).toBe('ws_legacy');
  });
});
