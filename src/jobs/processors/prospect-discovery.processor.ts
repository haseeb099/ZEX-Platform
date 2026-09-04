import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PROSPECT_DISCOVERY_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryService } from '@src/prospect-discovery/prospect-discovery.service';

export type ProspectDiscoveryJobData = {
  tenantId: string;
  discoveryRunId: string;
  limit?: number;
  triggeredBy: string;
};

@Processor(PROSPECT_DISCOVERY_QUEUE)
export class ProspectDiscoveryProcessor extends WorkerHost {
  constructor(private readonly discovery: ProspectDiscoveryService) {
    super();
  }

  async process(job: Job<ProspectDiscoveryJobData>): Promise<void> {
    await this.discovery.executeDiscovery({
      tenantId: job.data.tenantId,
      discoveryRunId: job.data.discoveryRunId,
      limit: job.data.limit,
      triggeredBy: job.data.triggeredBy || `job:${job.id}`,
    });
  }
}
