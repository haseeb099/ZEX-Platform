import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from '@src/common/guards/admin-api-key.guard';
import {
  ApproveSdrDraftDto,
  CreateSdrDraftDto,
  CreateSdrSequenceDto,
  IngestReplyDto,
  RejectSdrDraftDto,
  SendSdrDraftDto,
} from './dto/ai-sdr.dto';
import { AiSdrService } from './ai-sdr.service';

@ApiTags('admin/ai-sdr')
@ApiBearerAuth()
@UseGuards(AdminApiKeyGuard)
@Controller('api/v1/admin/tenants/:tenantId')
export class AiSdrController {
  constructor(private readonly sdr: AiSdrService) {}

  @Post('prospects/:candidateId/sdr')
  createSequence(
    @Param('tenantId') tenantId: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: CreateSdrSequenceDto,
  ) {
    return this.sdr.createSequence(tenantId, candidateId, dto);
  }

  @Post('sdr/sequences/:sequenceId/drafts')
  createDraft(
    @Param('tenantId') tenantId: string,
    @Param('sequenceId') sequenceId: string,
    @Body() dto: CreateSdrDraftDto,
  ) {
    return this.sdr.createDraft(tenantId, sequenceId, dto);
  }

  @Get('sdr/sequences/:sequenceId')
  getSequence(@Param('tenantId') tenantId: string, @Param('sequenceId') sequenceId: string) {
    return this.sdr.getSequence(tenantId, sequenceId);
  }

  @Get('sdr/drafts/:draftId')
  getDraft(@Param('tenantId') tenantId: string, @Param('draftId') draftId: string) {
    return this.sdr.getDraft(tenantId, draftId);
  }

  @Post('sdr/drafts/:draftId/approve')
  approve(
    @Param('tenantId') tenantId: string,
    @Param('draftId') draftId: string,
    @Body() dto: ApproveSdrDraftDto,
  ) {
    return this.sdr.approveDraft(tenantId, draftId, dto.approvedBy || 'admin');
  }

  @Post('sdr/drafts/:draftId/revoke')
  revoke(@Param('tenantId') tenantId: string, @Param('draftId') draftId: string) {
    return this.sdr.revokeApproval(tenantId, draftId);
  }

  @Post('sdr/drafts/:draftId/reject')
  rejectDraft(
    @Param('tenantId') tenantId: string,
    @Param('draftId') draftId: string,
    @Body() dto: RejectSdrDraftDto,
  ) {
    return this.sdr.rejectDraft(tenantId, draftId, dto.rejectedBy || 'admin');
  }

  @Post('sdr/drafts/:draftId/send')
  send(
    @Param('tenantId') tenantId: string,
    @Param('draftId') draftId: string,
    @Body() dto: SendSdrDraftDto,
  ) {
    return this.sdr.sendDraft(tenantId, draftId, dto);
  }

  /**
   * Trusted admin/deterministic reply ingestion (Admin API key).
   * Sequence is taken from the path; optional providerMessageId must match that sequence when supplied.
   * External providers must use the signed webhook (requires providerMessageId).
   */
  @Post('sdr/sequences/:sequenceId/replies')
  reply(
    @Param('tenantId') tenantId: string,
    @Param('sequenceId') sequenceId: string,
    @Body() dto: IngestReplyDto,
  ) {
    return this.sdr.ingestReply(tenantId, { ...dto, sequenceId, tenantId }, 'admin-api', {
      source: 'admin',
    });
  }

  @Post('sdr/sequences/:sequenceId/meetings/confirm')
  confirmMeeting(@Param('tenantId') tenantId: string, @Param('sequenceId') sequenceId: string) {
    return this.sdr.confirmMeeting(tenantId, sequenceId);
  }
}
