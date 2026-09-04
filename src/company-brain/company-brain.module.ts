import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '@src/audit/audit.module';
import { COMPANY_BRAIN_QUEUE } from '@src/jobs/jobs.constants';
import { CompanyBrainAnalyzeProcessor } from '@src/jobs/processors/company-brain-analyze.processor';
import { CompanyBrainController } from './company-brain.controller';
import { CompanyBrainService } from './company-brain.service';
import { CompanyBrainAnalyzerService } from './providers/company-brain-analyzer.service';
import { DeterministicCompanyBrainAnalyzer } from './providers/deterministic.analyzer';

@Module({
  imports: [BullModule.registerQueue({ name: COMPANY_BRAIN_QUEUE }), AuditModule],
  controllers: [CompanyBrainController],
  providers: [
    CompanyBrainService,
    DeterministicCompanyBrainAnalyzer,
    CompanyBrainAnalyzerService,
    CompanyBrainAnalyzeProcessor,
  ],
  exports: [CompanyBrainService, CompanyBrainAnalyzerService],
})
export class CompanyBrainModule {}
