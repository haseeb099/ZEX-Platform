import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PROSPECT_RESEARCH_QUEUE } from '@src/jobs/jobs.constants';
import { ResearchAgentService } from '@src/research-agent/research-agent.service';
import { ResearchFixture } from '@src/research-agent/research-agent.types';

export type ProspectResearchJobData = {
  tenantId: string;
  candidateId: string;
  runId: string;
  fixture?: ResearchFixture;
  triggeredBy: string;
};

@Processor(PROSPECT_RESEARCH_QUEUE)
export class ProspectResearchProcessor extends WorkerHost {
  constructor(private readonly research: ResearchAgentService) {
    super();
  }

  async process(job: Job<ProspectResearchJobData>): Promise<void> {
    await this.research.executeResearch({
      tenantId: job.data.tenantId,
      candidateId: job.data.candidateId,
      runId: job.data.runId,
      fixture: job.data.fixture,
      triggeredBy: job.data.triggeredBy || `job:${job.id}`,
    });
  }
}
