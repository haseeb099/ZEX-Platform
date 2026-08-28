import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@src/common/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    tenantId: string;
    action: string;
    resourceType?: string;
    resourceTwentyId?: string;
    before?: object | null;
    after?: object | null;
    triggeredBy: string;
    webhookLogId?: string;
    success?: boolean;
    message?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        action: input.action,
        resourceType: input.resourceType,
        resourceTwentyId: input.resourceTwentyId,
        before: (input.before as Prisma.InputJsonValue) ?? undefined,
        after: (input.after as Prisma.InputJsonValue) ?? undefined,
        triggeredBy: input.triggeredBy,
        webhookLogId: input.webhookLogId,
        success: input.success ?? true,
        message: input.message,
      },
    });
  }
}
