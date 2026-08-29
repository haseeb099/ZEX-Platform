import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@src/common/crypto.service';
import { TwentyConnectionService } from '@src/twenty/twenty-connection.service';
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

  const webhookSecretPlain = 'whsec_explicit_provisioned';
  const apiKeyPlain = 'sk_plain_api_key';

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

  it('accepts explicit webhookSecret and encrypts it on TwentyConnection + legacy Tenant', async () => {
    const { service, prisma } = buildService();

    const created = await service.createTenant({
      name: 'Acme',
      workspaceId: 'ws_1',
      baseUrl: 'https://crm.example.com',
      graphqlUrl: 'https://crm.example.com/graphql',
      restUrl: 'https://crm.example.com/rest',
      apiKey: apiKeyPlain,
      webhookSecret: webhookSecretPlain,
    });

    const createArgs = prisma.tenant.create.mock.calls[0][0];
    const storedConnectionSecret = createArgs.data.twentyConnection.create.webhookSecret;
    const storedLegacySecret = createArgs.data.twentyWebhookSecret;
    const storedConnectionApiKey = createArgs.data.twentyConnection.create.apiKey;
    const storedLegacyApiKey = createArgs.data.twentyApiKey;

    expect(storedConnectionSecret).not.toBe(webhookSecretPlain);
    expect(storedLegacySecret).not.toBe(webhookSecretPlain);
    expect(storedConnectionSecret).toBe(storedLegacySecret);
    expect(crypto.decrypt(storedConnectionSecret)).toBe(webhookSecretPlain);
    expect(crypto.decrypt(storedLegacySecret)).toBe(webhookSecretPlain);

    expect(storedConnectionApiKey).not.toBe(apiKeyPlain);
    expect(storedLegacyApiKey).toBe(storedConnectionApiKey);
    expect(crypto.decrypt(storedConnectionApiKey)).toBe(apiKeyPlain);

    expect(created).toEqual({
      tenantId: 'tenant_new',
      slug: 'acme-abc123',
      webhookUrl: 'http://localhost:3000/webhooks/twenty/tenant_new',
    });
    expect(created).not.toHaveProperty('webhookSecret');
    expect(created).not.toHaveProperty('apiKey');
    expect(created).not.toHaveProperty('twentyApiKey');
    expect(JSON.stringify(created)).not.toContain('whsec_');
    expect(JSON.stringify(created)).not.toContain(apiKeyPlain);
    expect(JSON.stringify(created)).not.toContain(webhookSecretPlain);
  });

  it('getTenantSafe exposes no secrets', async () => {
    const { service, prisma } = buildService();

    await service.createTenant({
      name: 'Acme',
      workspaceId: 'ws_1',
      baseUrl: 'https://crm.example.com',
      graphqlUrl: 'https://crm.example.com/graphql',
      restUrl: 'https://crm.example.com/rest',
      apiKey: apiKeyPlain,
      webhookSecret: webhookSecretPlain,
    });

    const createArgs = prisma.tenant.create.mock.calls[0][0];

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
    expect(safe).not.toHaveProperty('webhookSecret');
    expect(safe).not.toHaveProperty('apiKey');
    expect(safe).not.toHaveProperty('twentyApiKey');
    expect(safe).not.toHaveProperty('twentyWebhookSecret');
    expect(JSON.stringify(safe)).not.toContain('whsec_');
    expect(JSON.stringify(safe)).not.toContain(apiKeyPlain);
    expect(JSON.stringify(safe)).not.toContain(webhookSecretPlain);
    expect(safe?.twentyConnection?.graphqlUrl).toBe('https://crm.example.com/graphql');
  });

  it('webhook resolution still decrypts the stored secret correctly after create', async () => {
    const { service, prisma } = buildService();

    await service.createTenant({
      name: 'Acme',
      workspaceId: 'ws_1',
      baseUrl: 'https://crm.example.com',
      graphqlUrl: 'https://crm.example.com/graphql',
      restUrl: 'https://crm.example.com/rest',
      apiKey: apiKeyPlain,
      webhookSecret: webhookSecretPlain,
    });

    const createArgs = prisma.tenant.create.mock.calls[0][0];
    const connectionPrisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tenant_new',
          status: 'active',
          deletedAt: null,
          twentyConnection: {
            workspaceId: 'ws_1',
            baseUrl: 'https://crm.example.com',
            graphqlUrl: 'https://crm.example.com/graphql',
            restUrl: 'https://crm.example.com/rest',
            apiKey: createArgs.data.twentyConnection.create.apiKey,
            webhookSecret: createArgs.data.twentyConnection.create.webhookSecret,
            twentyVersion: null,
            status: 'active',
          },
        }),
      },
    };

    const connections = new TwentyConnectionService(connectionPrisma as never, crypto);
    const secret = await connections.resolveWebhookSecret('tenant_new');
    expect(secret).toBe(webhookSecretPlain);
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
      webhookSecret: 'whsec_legacy',
    });
    const createArgs = prisma.tenant.create.mock.calls[0][0];
    expect(createArgs.data.twentyConnection.create.workspaceId).toBe('ws_legacy');
    expect(crypto.decrypt(createArgs.data.twentyConnection.create.webhookSecret)).toBe(
      'whsec_legacy',
    );
  });
});
