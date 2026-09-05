import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgentControlModule } from '@src/agent-control/agent-control.module';
import { AuditModule } from '@src/audit/audit.module';
import { JobActionCheckpointService } from '@src/jobs/job-action-checkpoint.service';
import { AI_SDR_CRM_SYNC_QUEUE, AI_SDR_SEND_QUEUE } from '@src/jobs/jobs.constants';
import { AiSdrCrmSyncProcessor, AiSdrSendProcessor } from '@src/jobs/processors/ai-sdr.processor';
import { ResearchAgentModule } from '@src/research-agent/research-agent.module';
import { TwentyModule } from '@src/twenty/twenty.module';
import { AiSdrController } from './ai-sdr.controller';
import { AiSdrReplyWebhookController } from './ai-sdr-reply.webhook.controller';
import { AiSdrService } from './ai-sdr.service';
import {
  DeterministicMeetingProvider,
  DeterministicOutboundProvider,
} from './providers/deterministic.provider';
import {
  MeetingProviderService,
  OutboundMessageProviderService,
} from './providers/outbound-provider.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: AI_SDR_SEND_QUEUE }, { name: AI_SDR_CRM_SYNC_QUEUE }),
    AuditModule,
    ResearchAgentModule,
    TwentyModule,
    AgentControlModule,
  ],
  controllers: [AiSdrController, AiSdrReplyWebhookController],
  providers: [
    AiSdrService,
    JobActionCheckpointService,
    DeterministicOutboundProvider,
    DeterministicMeetingProvider,
    OutboundMessageProviderService,
    MeetingProviderService,
    AiSdrSendProcessor,
    AiSdrCrmSyncProcessor,
  ],
  exports: [AiSdrService],
})
export class AiSdrModule {}
