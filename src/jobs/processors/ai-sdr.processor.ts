import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_SDR_CRM_SYNC_QUEUE, AI_SDR_SEND_QUEUE } from '@src/jobs/jobs.constants';
import { AiSdrService } from '@src/ai-sdr/ai-sdr.service';
import { OutboundFixture } from '@src/ai-sdr/ai-sdr.types';

export type AiSdrSendJobData = {
  tenantId: string;
  draftId: string;
  fixture?: OutboundFixture;
  triggeredBy: string;
};

export type AiSdrCrmSyncJobData = {
  tenantId: string;
  messageId: string;
  triggeredBy: string;
};

@Processor(AI_SDR_SEND_QUEUE)
export class AiSdrSendProcessor extends WorkerHost {
  constructor(private readonly sdr: AiSdrService) {
    super();
  }

  async process(job: Job<AiSdrSendJobData>): Promise<void> {
    await this.sdr.executeSend({
      tenantId: job.data.tenantId,
      draftId: job.data.draftId,
      fixture: job.data.fixture,
      triggeredBy: job.data.triggeredBy || `job:${job.id}`,
    });
  }
}

@Processor(AI_SDR_CRM_SYNC_QUEUE)
export class AiSdrCrmSyncProcessor extends WorkerHost {
  constructor(private readonly sdr: AiSdrService) {
    super();
  }

  async process(job: Job<AiSdrCrmSyncJobData>): Promise<void> {
    await this.sdr.syncCrmForMessage(
      job.data.tenantId,
      job.data.messageId,
      job.data.triggeredBy || `job:${job.id}`,
    );
  }
}
