import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '@src/audit/audit.module';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { JobActionCheckpointService } from '@src/jobs/job-action-checkpoint.service';
import { PROSPECT_DISCOVERY_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryProcessor } from '@src/jobs/processors/prospect-discovery.processor';
import { TwentyModule } from '@src/twenty/twenty.module';
import { ProspectDiscoveryController } from './prospect-discovery.controller';
import { ProspectDiscoveryService } from './prospect-discovery.service';
import { DeterministicProspectDiscoveryProvider } from './providers/deterministic.provider';
import { ProspectDiscoveryProviderService } from './providers/prospect-discovery-provider.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: PROSPECT_DISCOVERY_QUEUE }),
    AuditModule,
    CompanyBrainModule,
    TwentyModule,
  ],
  controllers: [ProspectDiscoveryController],
  providers: [
    ProspectDiscoveryService,
    DeterministicProspectDiscoveryProvider,
    ProspectDiscoveryProviderService,
    ProspectDiscoveryProcessor,
    JobActionCheckpointService,
  ],
  exports: [ProspectDiscoveryService],
})
export class ProspectDiscoveryModule {}
