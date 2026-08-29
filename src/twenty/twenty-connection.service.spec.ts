import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@src/common/crypto.service';
import { TwentyConnectionService } from './twenty-connection.service';

describe('TwentyConnectionService', () => {
  const masterKey = '0c3195a8c93513790c7d5dc3df85e3ab1bdcded9fee05fb9e3d37c818975acfc';
  const crypto = new CryptoService({
    getOrThrow: (key: string) => {
      if (key === 'MASTER_KEY') return masterKey;
      throw new Error(key);
    },
  } as ConfigService);

  const apiKeyPlain = 'sk_tenant_a_api_key';
  const webhookPlain = 'whsec_tenant_a';
  const encryptedApiKey = crypto.encrypt(apiKeyPlain);
  const encryptedWebhook = crypto.encrypt(webhookPlain);

  const tenantA = {
    id: 'tenant_a',
    status: 'active',
    deletedAt: null,
    twentyConnection: {
      workspaceId: 'ws_a',
      baseUrl: 'https://crm-a.example.com',
      graphqlUrl: 'https://crm-a.example.com/graphql',
      restUrl: 'https://crm-a.example.com/rest',
      apiKey: encryptedApiKey,
      webhookSecret: encryptedWebhook,
      twentyVersion: '1.0.0',
      status: 'active',
    },
  };

  const tenantB = {
    id: 'tenant_b',
    status: 'active',
    deletedAt: null,
    twentyConnection: {
      workspaceId: 'ws_b',
      baseUrl: 'https://crm-b.example.com',
      graphqlUrl: 'https://crm-b.example.com/graphql',
      restUrl: 'https://crm-b.example.com/rest',
      apiKey: crypto.encrypt('sk_tenant_b_api_key'),
      webhookSecret: crypto.encrypt('whsec_tenant_b'),
      twentyVersion: null,
      status: 'active',
    },
  };

  function buildService(findFirstImpl: (args: { where: { id: string } }) => unknown) {
    const prisma = {
      tenant: {
        findFirst: jest.fn(findFirstImpl),
      },
    };
    return {
      service: new TwentyConnectionService(prisma as never, crypto),
      prisma,
    };
  }

  it('resolves connection for the correct tenant and decrypts API key', async () => {
    const { service, prisma } = buildService(({ where }: { where: { id: string } }) => {
      if (where.id === 'tenant_a') return tenantA;
      if (where.id === 'tenant_b') return tenantB;
      return null;
    });

    const resolved = await service.resolve('tenant_a');
    expect(resolved.tenantId).toBe('tenant_a');
    expect(resolved.workspaceId).toBe('ws_a');
    expect(resolved.graphqlUrl).toBe('https://crm-a.example.com/graphql');
    expect(resolved.apiKey).toBe(apiKeyPlain);
    expect(resolved.webhookSecret).toBeUndefined();
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant_a', deletedAt: null },
      }),
    );
  });

  it('does not resolve Tenant B connection when asking for Tenant A', async () => {
    const { service } = buildService(({ where }: { where: { id: string } }) => {
      if (where.id === 'tenant_a') return tenantA;
      if (where.id === 'tenant_b') return tenantB;
      return null;
    });

    const a = await service.resolve('tenant_a');
    const b = await service.resolve('tenant_b');
    expect(a.apiKey).toBe(apiKeyPlain);
    expect(b.apiKey).toBe('sk_tenant_b_api_key');
    expect(a.graphqlUrl).not.toBe(b.graphqlUrl);
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it('fails for inactive tenant', async () => {
    const { service } = buildService(() => ({
      ...tenantA,
      status: 'suspended',
    }));
    await expect(service.resolve('tenant_a')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails for soft-deleted tenant (not found)', async () => {
    const { service } = buildService(() => null);
    await expect(service.resolve('tenant_a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails clearly when TwentyConnection is missing', async () => {
    const { service } = buildService(() => ({
      ...tenantA,
      twentyConnection: null,
    }));
    await expect(service.resolve('tenant_a')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails when connection status is inactive', async () => {
    const { service } = buildService(() => ({
      ...tenantA,
      twentyConnection: { ...tenantA.twentyConnection, status: 'disabled' },
    }));
    await expect(service.resolve('tenant_a')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('resolves tenant-specific webhook secret for signature path', async () => {
    const { service } = buildService(({ where }: { where: { id: string } }) => {
      if (where.id === 'tenant_a') return tenantA;
      return null;
    });
    const secret = await service.resolveWebhookSecret('tenant_a');
    expect(secret).toBe(webhookPlain);
  });
});
