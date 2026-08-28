import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ENRICH_AND_SCORE_QUEUE } from '@src/jobs/jobs.constants';
import { IdempotencyService } from './idempotency.service';
import { SignatureService } from './signature.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [BullModule.registerQueue({ name: ENRICH_AND_SCORE_QUEUE })],
  controllers: [WebhookController],
  providers: [SignatureService, IdempotencyService],
  exports: [SignatureService, IdempotencyService],
})
export class WebhooksModule {}
