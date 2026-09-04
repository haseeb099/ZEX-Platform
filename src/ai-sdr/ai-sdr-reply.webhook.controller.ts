import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AiSdrService } from './ai-sdr.service';

type RawBodyRequest = FastifyRequest & { rawBody?: string | Buffer };

@ApiTags('webhooks/sdr')
@Controller('api/v1/webhooks/outbound')
export class AiSdrReplyWebhookController {
  constructor(private readonly sdr: AiSdrService) {}

  /**
   * Signed inbound reply webhook.
   * Signature: HMAC-SHA256 over `${timestamp}:${rawBody}` header `x-zex-sdr-signature`.
   * Timestamp: `x-zex-sdr-timestamp` (unix seconds). Fail closed.
   */
  @Post('reply')
  @HttpCode(200)
  async reply(
    @Req() req: RawBodyRequest,
    @Headers('x-zex-sdr-signature') signature: string | undefined,
    @Headers('x-zex-sdr-timestamp') timestamp: string | undefined,
  ) {
    const raw =
      typeof req.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req.rawBody)
          ? req.rawBody.toString('utf8')
          : JSON.stringify(req.body ?? {});

    if (!this.sdr.verifyReplySignature(raw, signature, timestamp)) {
      throw new UnauthorizedException('Invalid SDR reply webhook signature');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }

    const tenantId = String(payload.tenantId || '');
    if (!tenantId) throw new BadRequestException('tenantId required');

    // External path must correlate via providerMessageId — never stop a sequence from sequenceId alone.
    if (!payload.providerMessageId || typeof payload.providerMessageId !== 'string') {
      throw new BadRequestException('providerMessageId required');
    }

    // ACK-style: process synchronously for v1 (small payload); idempotent by providerEventId
    const result = await this.sdr.ingestReply(tenantId, payload, 'sdr-reply-webhook', {
      source: 'webhook',
    });
    return { status: 'ok', duplicate: result.duplicate, replyId: result.reply.id };
  }
}
