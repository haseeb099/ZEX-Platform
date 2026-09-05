import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgentControlModule } from '@src/agent-control/agent-control.module';
import { AuditModule } from '@src/audit/audit.module';
import { CompanyBrainModule } from '@src/company-brain/company-brain.module';
import { PROSPECT_RESEARCH_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectResearchProcessor } from '@src/jobs/processors/prospect-research.processor';
import { DeterministicProspectResearchProvider } from './providers/deterministic.provider';
import { ProspectResearchProviderService } from './providers/prospect-research-provider.service';
import { ResearchAgentController } from './research-agent.controller';
import { ResearchAgentService } from './research-agent.service';

/**
 * Research Agent v1 — Platform-owned findings + outreach context.
 * Intentionally does NOT import TwentyModule: zero CRM mutation surface.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: PROSPECT_RESEARCH_QUEUE }),
    AuditModule,
    CompanyBrainModule,
    AgentControlModule,
  ],
  controllers: [ResearchAgentController],
  providers: [
    ResearchAgentService,
    DeterministicProspectResearchProvider,
    ProspectResearchProviderService,
    ProspectResearchProcessor,
  ],
  exports: [ResearchAgentService],
})
export class ResearchAgentModule {}
