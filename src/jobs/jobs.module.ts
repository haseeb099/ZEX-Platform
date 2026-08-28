import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TwentyModule } from '../twenty/twenty.module';
import { JobsAdminController } from './jobs-admin.controller';
import { ENRICH_AND_SCORE_QUEUE } from './jobs.constants';
import { EnrichAndScoreProcessor } from './processors/enrich-and-score.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: ENRICH_AND_SCORE_QUEUE }),
    EnrichmentModule,
    ScoringModule,
    TwentyModule,
    AuditModule,
  ],
  controllers: [JobsAdminController],
  providers: [EnrichAndScoreProcessor],
  exports: [BullModule],
})
export class JobsModule {}
