import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/common/prisma/prisma.service';

/** CRM write actions tracked for partial-success retry idempotency. */
export const CRM_WRITE_ACTIONS = {
  UPDATE_PERSON: 'update_person',
  CREATE_NOTE: 'create_note',
  CREATE_OPPORTUNITY: 'create_opportunity',
} as const;

export type CrmWriteAction = (typeof CRM_WRITE_ACTIONS)[keyof typeof CRM_WRITE_ACTIONS];

export type CompletedCheckpoint = {
  completed: true;
  externalId?: string;
};

export type PendingCheckpoint = {
  completed: false;
};

@Injectable()
export class JobActionCheckpointService {
  constructor(private readonly prisma: PrismaService) {}

  async getCompleted(
    tenantId: string,
    webhookLogId: string,
    action: CrmWriteAction,
  ): Promise<CompletedCheckpoint | PendingCheckpoint> {
    const checkpoint = await this.prisma.jobActionCheckpoint.findUnique({
      where: {
        tenantId_webhookLogId_action: { tenantId, webhookLogId, action },
      },
    });

    if (checkpoint?.status === 'completed') {
      return { completed: true, externalId: checkpoint.externalId ?? undefined };
    }

    return { completed: false };
  }

  /** Record success only after confirmed Twenty response. */
  async recordSuccess(
    tenantId: string,
    webhookLogId: string,
    personTwentyId: string,
    action: CrmWriteAction,
    externalId?: string,
  ): Promise<void> {
    await this.prisma.jobActionCheckpoint.upsert({
      where: {
        tenantId_webhookLogId_action: { tenantId, webhookLogId, action },
      },
      create: {
        tenantId,
        webhookLogId,
        personTwentyId,
        action,
        externalId,
        status: 'completed',
      },
      update: {
        personTwentyId,
        externalId,
        status: 'completed',
      },
    });
  }
}
