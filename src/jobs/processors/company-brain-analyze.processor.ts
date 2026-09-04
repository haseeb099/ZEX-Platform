import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { COMPANY_BRAIN_QUEUE } from '@src/jobs/jobs.constants';
import { CompanyBrainService } from '@src/company-brain/company-brain.service';

export type CompanyBrainAnalyzeJobData = {
  tenantId: string;
  companyBrainId: string;
  analysisJobId: string;
  triggeredBy: string;
};

@Processor(COMPANY_BRAIN_QUEUE)
export class CompanyBrainAnalyzeProcessor extends WorkerHost {
  constructor(private readonly companyBrain: CompanyBrainService) {
    super();
  }

  async process(job: Job<CompanyBrainAnalyzeJobData>): Promise<void> {
    const { tenantId, companyBrainId, analysisJobId, triggeredBy } = job.data;
    await this.companyBrain.runAnalysis({
      tenantId,
      companyBrainId,
      analysisJobId,
      triggeredBy: triggeredBy || `job:${job.id}`,
    });
  }
}
