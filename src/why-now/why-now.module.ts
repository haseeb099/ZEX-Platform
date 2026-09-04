import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '@src/audit/audit.module';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { WHY_NOW_QUEUE } from '@src/jobs/jobs.constants';
import { WhyNowProcessor } from '@src/jobs/processors/why-now.processor';
import { DeterministicProspectSignalProvider } from './providers/deterministic.provider';
import { ProspectSignalProviderService } from './providers/prospect-signal-provider.service';
import { WhyNowController } from './why-now.controller';
import { WhyNowService } from './why-now.service';

@Module({
  imports: [BullModule.registerQueue({ name: WHY_NOW_QUEUE }), AuditModule, CompanyBrainModule],
  controllers: [WhyNowController],
  providers: [
    WhyNowService,
    DeterministicProspectSignalProvider,
    ProspectSignalProviderService,
    WhyNowProcessor,
  ],
  exports: [WhyNowService],
})
export class WhyNowModule {}
