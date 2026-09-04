import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WHY_NOW_QUEUE } from '@src/jobs/jobs.constants';
import { WhyNowService } from '@src/why-now/why-now.service';
import { WhyNowFixture } from '@src/why-now/why-now.types';

export type WhyNowJobData = {
  tenantId: string;
  candidateId: string;
  collectSignals?: boolean;
  fixture?: WhyNowFixture;
  triggeredBy: string;
};

@Processor(WHY_NOW_QUEUE)
export class WhyNowProcessor extends WorkerHost {
  constructor(private readonly whyNow: WhyNowService) {
    super();
  }

  async process(job: Job<WhyNowJobData>): Promise<void> {
    await this.whyNow.executeScore({
      tenantId: job.data.tenantId,
      candidateId: job.data.candidateId,
      collectSignals: job.data.collectSignals,
      fixture: job.data.fixture,
      triggeredBy: job.data.triggeredBy || `job:${job.id}`,
    });
  }
}
