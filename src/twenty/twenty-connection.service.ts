import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CryptoService } from '@src/common/crypto.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { ResolvedTwentyConnection } from './twenty-connection.types';

export type ResolveConnectionOptions = {
  /** When true, include decrypted webhookSecret on the resolved object. */
  includeWebhookSecret?: boolean;
};

@Injectable()
export class TwentyConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Resolve an active tenant's Twenty CRM connection.
   * Decrypts credentials in-process; callers must not log or expose them.
   */
  async resolve(
    tenantId: string,
    options: ResolveConnectionOptions = {},
  ): Promise<ResolvedTwentyConnection> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: { twentyConnection: true },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: 'Tenant not found',
        code: 'TENANT_NOT_FOUND',
      });
    }

    if (tenant.status !== 'active') {
      throw new UnauthorizedException({
        error: 'Tenant is not active',
        code: 'TENANT_INACTIVE',
      });
    }

    const connection = tenant.twentyConnection;
    if (!connection) {
      throw new ServiceUnavailableException({
        error:
          'Twenty connection not configured for tenant. Provision explicit baseUrl/graphqlUrl/restUrl — endpoints are never inferred.',
        code: 'TWENTY_CONNECTION_MISSING',
      });
    }

    if (connection.status !== 'active') {
      throw new ServiceUnavailableException({
        error: 'Twenty connection is not active',
        code: 'TWENTY_CONNECTION_INACTIVE',
      });
    }

    const resolved: ResolvedTwentyConnection = {
      tenantId: tenant.id,
      workspaceId: connection.workspaceId,
      baseUrl: connection.baseUrl,
      graphqlUrl: connection.graphqlUrl,
      restUrl: connection.restUrl,
      apiKey: this.crypto.decrypt(connection.apiKey),
      twentyVersion: connection.twentyVersion,
    };

    if (options.includeWebhookSecret) {
      resolved.webhookSecret = this.crypto.decrypt(connection.webhookSecret);
    }

    return resolved;
  }

  /** Resolve webhook secret for HMAC verification (fail-closed). */
  async resolveWebhookSecret(tenantId: string): Promise<string> {
    const connection = await this.resolve(tenantId, { includeWebhookSecret: true });
    if (!connection.webhookSecret) {
      throw new ServiceUnavailableException({
        error: 'Webhook secret unavailable',
        code: 'TWENTY_WEBHOOK_SECRET_MISSING',
      });
    }
    return connection.webhookSecret;
  }
}
