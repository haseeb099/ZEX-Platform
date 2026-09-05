import { ConflictException, NotFoundException } from '@nestjs/common';
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
        findMany: jest.fn().mockResolvedValue([]),
      },
      twentyConnection: {
        findMany: jest.fn().mockResolvedValue([]),
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

  describe('resolveByTwentyWorkspaceId (fail-closed)', () => {
    it('one active mapping → tenant resolved', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([
        {
          tenantId: 'tenant_a',
          workspaceId: 'ws_1',
          status: 'active',
          tenant: { id: 'tenant_a', deletedAt: null },
        },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_1')).resolves.toEqual({
        tenantId: 'tenant_a',
        workspaceId: 'ws_1',
      });
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it('zero mapping → 404', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([]);
      prisma.tenant.findMany.mockResolvedValue([]);

      await expect(service.resolveByTwentyWorkspaceId('ws_missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('two active mappings for same workspace → fail closed', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([
        {
          tenantId: 'tenant_b',
          workspaceId: 'ws_dup',
          status: 'active',
          tenant: { id: 'tenant_b', deletedAt: null },
        },
        {
          tenantId: 'tenant_a',
          workspaceId: 'ws_dup',
          status: 'active',
          tenant: { id: 'tenant_a', deletedAt: null },
        },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_dup')).rejects.toBeInstanceOf(
        ConflictException,
      );
      try {
        await service.resolveByTwentyWorkspaceId('ws_dup');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          tenantIds: string[];
          workspaceId: string;
        };
        expect(body.workspaceId).toBe('ws_dup');
        expect(body.tenantIds).toEqual(['tenant_a', 'tenant_b']);
      }
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it('active mapping + deleted tenant mapping → valid non-deleted wins', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([
        {
          tenantId: 'tenant_dead',
          workspaceId: 'ws_1',
          status: 'active',
          tenant: { id: 'tenant_dead', deletedAt: new Date() },
        },
        {
          tenantId: 'tenant_live',
          workspaceId: 'ws_1',
          status: 'active',
          tenant: { id: 'tenant_live', deletedAt: null },
        },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_1')).resolves.toEqual({
        tenantId: 'tenant_live',
        workspaceId: 'ws_1',
      });
    });

    it('inactive mapping is ignored', async () => {
      const { service, prisma } = buildService();
      // findMany already filters status:active — inactive never returned
      prisma.twentyConnection.findMany.mockResolvedValue([]);
      prisma.tenant.findMany.mockResolvedValue([]);

      await expect(service.resolveByTwentyWorkspaceId('ws_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.twentyConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws_1', status: 'active' },
        }),
      );
    });

    it('duplicate deprecated Tenant.twentyWorkspaceId matches → fail closed', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([]);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 'legacy_b', twentyWorkspaceId: 'ws_legacy' },
        { id: 'legacy_a', twentyWorkspaceId: 'ws_legacy' },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_legacy')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('canonical TwentyConnection mapping wins over deprecated fallback', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([
        {
          tenantId: 'canonical',
          workspaceId: 'ws_1',
          status: 'active',
          tenant: { id: 'canonical', deletedAt: null },
        },
      ]);
      prisma.tenant.findMany.mockResolvedValue([{ id: 'legacy_only', twentyWorkspaceId: 'ws_1' }]);

      await expect(service.resolveByTwentyWorkspaceId('ws_1')).resolves.toEqual({
        tenantId: 'canonical',
        workspaceId: 'ws_1',
      });
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it('cross-tenant resolution cannot arbitrarily select the first DB row', async () => {
      const { service, prisma } = buildService();
      // Same ambiguous set regardless of order — never silently pick index 0
      prisma.twentyConnection.findMany.mockResolvedValue([
        {
          tenantId: 'first_row',
          workspaceId: 'ws_amb',
          status: 'active',
          tenant: { id: 'first_row', deletedAt: null },
        },
        {
          tenantId: 'second_row',
          workspaceId: 'ws_amb',
          status: 'active',
          tenant: { id: 'second_row', deletedAt: null },
        },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_amb')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('single legacy fallback works when no TwentyConnection rows', async () => {
      const { service, prisma } = buildService();
      prisma.twentyConnection.findMany.mockResolvedValue([]);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 'legacy_only', twentyWorkspaceId: 'ws_leg' },
      ]);

      await expect(service.resolveByTwentyWorkspaceId('ws_leg')).resolves.toEqual({
        tenantId: 'legacy_only',
        workspaceId: 'ws_leg',
      });
    });
  });
});
