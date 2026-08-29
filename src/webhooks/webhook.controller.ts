import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { LoggerService } from '@src/common/logger/logger.service';
import { ENRICH_AND_SCORE_QUEUE } from '@src/jobs/jobs.constants';
import { TwentyConnectionService } from '@src/twenty/twenty-connection.service';
import { IdempotencyService } from './idempotency.service';
import { SignatureService } from './signature.service';

type WebhookBody = {
  event?: string;
  eventName?: string;
  data?: { id?: string; [key: string]: unknown };
  record?: { id?: string; [key: string]: unknown };
  timestamp?: string;
  webhookId?: string;
  eventDate?: string;
};

@ApiTags('webhooks')
@Controller('webhooks/twenty')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twentyConnections: TwentyConnectionService,
    private readonly signatures: SignatureService,
    private readonly idempotency: IdempotencyService,
    private readonly logger: LoggerService,
    @InjectQueue(ENRICH_AND_SCORE_QUEUE) private readonly queue: Queue,
  ) {}

  @Post(':tenantId')
  @HttpCode(200)
  async receive(
    @Param('tenantId') tenantId: string,
    @Body() body: WebhookBody,
    @Headers('x-twenty-webhook-signature') signature: string | undefined,
    @Headers('x-twenty-webhook-id') webhookId: string | undefined,
    @Headers('x-twenty-webhook-nonce') webhookNonce: string | undefined,
    @Headers('x-twenty-webhook-timestamp') webhookTimestamp: string | undefined,
    @Headers('x-twenty-timestamp') legacyTimestamp: string | undefined,
    @Req() req: FastifyRequest & { rawBody?: string },
  ) {
    // Fail closed: unknown/inactive tenant or missing connection throws from resolver.
    const secret = await this.twentyConnections.resolveWebhookSecret(tenantId);

    const rawBody = req.rawBody ?? JSON.stringify(body);
    const timestampHeader = webhookTimestamp || legacyTimestamp;

    if (!this.signatures.verifyTwentyWebhook(rawBody, signature, secret, timestampHeader)) {
      throw new UnauthorizedException({
        error: 'Invalid signature',
        code: 'WEBHOOK_SIGNATURE_MISMATCH',
      });
    }

    const ts = Number(timestampHeader);
    if (!this.idempotency.isTimestampFresh(ts)) {
      throw new UnauthorizedException({
        error: 'Timestamp too old or invalid',
        code: 'WEBHOOK_TIMESTAMP_INVALID',
      });
    }

    const eventId =
      webhookNonce ||
      webhookId ||
      body.webhookId ||
      `${body.eventName || body.event || 'unknown'}:${body.record?.id || body.data?.id || ts}`;
    const duplicate = await this.idempotency.hasSeenOrMark(eventId);
    if (duplicate) {
      return { received: true, webhookId: eventId, duplicate: true };
    }

    const event = body.eventName || body.event || 'unknown';
    const personRecord = body.record || body.data;
    const personId = personRecord?.id;
    if (!personId && event.startsWith('person.')) {
      throw new BadRequestException({ error: 'Missing person id', code: 'INVALID_PAYLOAD' });
    }

    const webhookLog = await this.prisma.webhookLog.create({
      data: {
        tenantId,
        event,
        payload: body as object,
        status: 'queued',
      },
    });

    const job = await this.queue.add(
      'enrich-and-score-person',
      {
        tenantId,
        personTwentyId: personId,
        event,
        webhookLogId: webhookLog.id,
        personSnapshot: personRecord || null,
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );

    await this.prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: { jobId: job.id },
    });

    this.logger.info('Webhook accepted', { tenantId, event, jobId: job.id }, 'WebhookController');

    return { received: true, webhookId: eventId };
  }
}
