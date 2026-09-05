import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Prisma, SdrApproval, SdrDraft, SdrMessage, SdrSequence } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'crypto';
import { AgentControlService } from '@src/agent-control/agent-control.service';
import { AuditService } from '@src/audit/audit.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { AI_SDR_CRM_SYNC_QUEUE, AI_SDR_SEND_QUEUE } from '@src/jobs/jobs.constants';
import {
  CRM_WRITE_ACTIONS,
  JobActionCheckpointService,
} from '@src/jobs/job-action-checkpoint.service';
import { ResearchAgentService } from '@src/research-agent/research-agent.service';
import { TwentyClient } from '@src/twenty/twenty.client';
import { AI_SDR_VERSION, DraftPurpose, OutboundFixture, replyEventSchema } from './ai-sdr.types';
import { boundText, generateDraftContent, hashDraftContent } from './draft-generator';
import { MeetingProviderService } from './providers/outbound-provider.service';
import { OutboundMessageProviderService } from './providers/outbound-provider.service';

const STOP_STATUSES = new Set(['REPLIED', 'CANCELLED', 'PAUSED', 'COMPLETED', 'FAILED']);
const RESEARCHABLE = new Set(['APPROVED', 'CREATED']);

@Injectable()
export class AiSdrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly research: ResearchAgentService,
    private readonly outbound: OutboundMessageProviderService,
    private readonly meetings: MeetingProviderService,
    private readonly checkpoints: JobActionCheckpointService,
    private readonly twenty: TwentyClient,
    private readonly config: ConfigService,
    private readonly agentControl: AgentControlService,
    @InjectQueue(AI_SDR_SEND_QUEUE) private readonly sendQueue: Queue,
    @InjectQueue(AI_SDR_CRM_SYNC_QUEUE) private readonly crmQueue: Queue,
  ) {}

  async createSequence(
    tenantId: string,
    candidateId: string,
    input: {
      targetEmail?: string;
      targetPersonTwentyId?: string;
      targetPersonName?: string;
      generateDraft?: boolean;
    } = {},
    triggeredBy = 'admin-api',
  ) {
    // ZEX-39: pause blocks new SDR outbound progression (not reply safety)
    await this.agentControl.assertAgentNotPaused(tenantId, 'ai_sdr', triggeredBy);

    const candidate = await this.requireCandidate(tenantId, candidateId);
    if (!RESEARCHABLE.has(candidate.status)) {
      throw new BadRequestException(
        `SDR requires APPROVED or CREATED candidate; status=${candidate.status}`,
      );
    }

    let researchRunId: string | null = null;
    let whyNowSnapshotId: string | null = null;
    try {
      const latestResearch = await this.research.getLatest(tenantId, candidateId);
      researchRunId = String(latestResearch.id);
      whyNowSnapshotId = latestResearch.whyNowSnapshotId
        ? String(latestResearch.whyNowSnapshotId)
        : null;
    } catch {
      throw new BadRequestException('Completed Research Agent package required before SDR');
    }

    const sequence = await this.prisma.sdrSequence.create({
      data: {
        tenantId,
        prospectCandidateId: candidateId,
        researchRunId,
        whyNowSnapshotId,
        status: 'DRAFTING',
        channel: 'email',
        targetEmail: input.targetEmail?.trim().toLowerCase() || null,
        targetPersonTwentyId: input.targetPersonTwentyId || null,
        targetPersonName: input.targetPersonName || null,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'sdr_sequence_created',
      resourceType: 'SdrSequence',
      resourceTwentyId: sequence.id,
      after: {
        prospectCandidateId: candidateId,
        researchRunId,
        targetEmailPresent: Boolean(sequence.targetEmail),
      },
      triggeredBy,
    });

    if (input.generateDraft !== false) {
      const draft = await this.createDraft(
        tenantId,
        sequence.id,
        { purpose: 'outreach' },
        triggeredBy,
      );
      return { sequence: this.serializeSequence(sequence), draft };
    }
    return { sequence: this.serializeSequence(sequence) };
  }

  async createDraft(
    tenantId: string,
    sequenceId: string,
    input: { purpose?: DraftPurpose } = {},
    triggeredBy = 'admin-api',
  ) {
    // ZEX-39: pause blocks new draft generation (reply ingestion skips this when paused)
    await this.agentControl.assertAgentNotPaused(tenantId, 'ai_sdr', triggeredBy);

    const sequence = await this.requireSequence(tenantId, sequenceId);
    if (STOP_STATUSES.has(sequence.status) && sequence.status !== 'REPLIED') {
      // REPLIED may create reply/meeting drafts; CANCELLED etc. blocked
      if (sequence.status !== 'REPLIED') {
        throw new BadRequestException(`Cannot draft for sequence status ${sequence.status}`);
      }
    }

    const purpose: DraftPurpose = input.purpose || 'outreach';
    if (sequence.status === 'REPLIED' && purpose === 'outreach') {
      throw new BadRequestException('Sequence replied — create reply/meeting draft instead');
    }

    const research = await this.research.getLatest(tenantId, sequence.prospectCandidateId);
    const pkg = research.package as {
      outreachContext?: {
        personalizationFacts?: string[];
        doNotClaim?: string[];
        suggestedBuyerRoles?: string[];
        primaryAngle?: string;
      };
      whyNow?: string;
      buyingCommitteeContext?: {
        namedPeople?: Array<{ name: string; role?: string | null }>;
      };
      companySummary?: string;
      findingIds?: string[];
    } | null;

    const outreach = pkg?.outreachContext;
    const named = pkg?.buyingCommitteeContext?.namedPeople?.[0] || null;
    const findingIds =
      (pkg?.findingIds as string[]) || research.findings?.map((f: { id: string }) => f.id) || [];

    let bookingLink: string | null = null;
    if (purpose === 'meeting') {
      const proposed = await this.meetings.propose({
        tenantId,
        sequenceId,
        prospectCandidateId: sequence.prospectCandidateId,
        companyName: String(
          (await this.requireCandidate(tenantId, sequence.prospectCandidateId)).companyName,
        ),
      });
      bookingLink = proposed.bookingLink;
      await this.prisma.sdrMeetingBooking.create({
        data: {
          tenantId,
          sequenceId,
          prospectCandidateId: sequence.prospectCandidateId,
          status: 'PROPOSED',
          bookingLink: proposed.bookingLink,
          proposedTimes: proposed.proposedTimes as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.log({
        tenantId,
        action: 'sdr_meeting_booking_started',
        resourceType: 'SdrSequence',
        resourceTwentyId: sequenceId,
        after: { bookingLink: proposed.bookingLink },
        triggeredBy,
      });
    }

    const candidate = await this.requireCandidate(tenantId, sequence.prospectCandidateId);
    const content = generateDraftContent({
      companyName: candidate.companyName,
      purpose,
      whyNow: pkg?.whyNow || null,
      personalizationFacts: outreach?.personalizationFacts || [],
      doNotClaim: outreach?.doNotClaim || [],
      findingIds,
      buyerRoles: outreach?.suggestedBuyerRoles || [],
      namedPerson: named,
      targetPersonName: sequence.targetPersonName,
      companyBrainValueProp: null,
      bookingLink,
      replyClassification: purpose === 'reply' ? 'POSITIVE' : null,
    });

    const contentHash = hashDraftContent(content);

    // Supersede prior non-sent drafts of same purpose
    const prior = await this.prisma.sdrDraft.findMany({
      where: {
        tenantId,
        sequenceId,
        purpose,
        status: { in: ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'] },
      },
    });
    for (const p of prior) {
      await this.prisma.sdrDraft.update({
        where: { id: p.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await this.prisma.sdrApproval.updateMany({
        where: { tenantId, draftId: p.id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.audit.log({
        tenantId,
        action: 'sdr_draft_superseded',
        resourceType: 'SdrDraft',
        resourceTwentyId: p.id,
        after: { supersededByPurpose: purpose },
        triggeredBy,
      });
    }

    const version =
      ((
        await this.prisma.sdrDraft.aggregate({
          where: { sequenceId },
          _max: { version: true },
        })
      )._max.version || 0) + 1;

    const draft = await this.prisma.sdrDraft.create({
      data: {
        tenantId,
        sequenceId,
        prospectCandidateId: sequence.prospectCandidateId,
        version,
        channel: content.channel,
        purpose: content.purpose,
        subject: content.subject,
        body: content.body,
        evidenceRefs: content.evidenceRefs as unknown as Prisma.InputJsonValue,
        researchFindingIds: content.researchFindingIds as unknown as Prisma.InputJsonValue,
        whyNowSnapshotId: sequence.whyNowSnapshotId,
        doNotClaimApplied: content.doNotClaimApplied as unknown as Prisma.InputJsonValue,
        grounding: content.grounding as unknown as Prisma.InputJsonValue,
        confidence: content.confidence,
        status: 'AWAITING_APPROVAL',
        contentHash,
      },
    });

    await this.prisma.sdrSequence.update({
      where: { id: sequenceId },
      data: { status: sequence.status === 'REPLIED' ? 'REPLIED' : 'AWAITING_APPROVAL' },
    });

    await this.audit.log({
      tenantId,
      action: purpose === 'reply' ? 'sdr_reply_draft_generated' : 'sdr_draft_generated',
      resourceType: 'SdrDraft',
      resourceTwentyId: draft.id,
      after: {
        sequenceId,
        version,
        purpose,
        contentHash,
        confidence: draft.confidence,
        evidenceCount: content.evidenceRefs.length,
      },
      triggeredBy,
    });

    return this.serializeDraft(draft);
  }

  async approveDraft(
    tenantId: string,
    draftId: string,
    approvedBy = 'admin',
    triggeredBy = 'admin-api',
  ) {
    const draft = await this.requireDraft(tenantId, draftId);
    if (draft.status === 'SUPERSEDED') {
      throw new BadRequestException('Cannot approve a superseded draft');
    }
    if (draft.status === 'REJECTED') {
      throw new BadRequestException('Cannot approve a rejected draft');
    }
    if (draft.status === 'SENT') {
      throw new BadRequestException('Draft already sent');
    }

    const liveHash = hashDraftContent({
      channel: draft.channel,
      subject: draft.subject,
      body: draft.body,
      purpose: draft.purpose,
    });
    if (liveHash !== draft.contentHash) {
      throw new BadRequestException('Draft content hash mismatch — regenerate draft');
    }

    const approval = await this.prisma.sdrApproval.create({
      data: {
        tenantId,
        sequenceId: draft.sequenceId,
        draftId: draft.id,
        draftVersion: draft.version,
        contentHash: draft.contentHash,
        approvedBy,
        status: 'ACTIVE',
      },
    });

    await this.prisma.sdrDraft.update({
      where: { id: draft.id },
      data: { status: 'APPROVED' },
    });
    await this.prisma.sdrSequence.update({
      where: { id: draft.sequenceId },
      data: { status: 'APPROVED' },
    });

    await this.audit.log({
      tenantId,
      action: 'sdr_approval_granted',
      resourceType: 'SdrApproval',
      resourceTwentyId: approval.id,
      after: {
        draftId: draft.id,
        draftVersion: draft.version,
        contentHash: draft.contentHash,
        approvedBy,
      },
      triggeredBy,
    });

    return {
      approval: this.serializeApproval(approval),
      draft: await this.getDraft(tenantId, draftId),
    };
  }

  async revokeApproval(tenantId: string, draftId: string, triggeredBy = 'admin-api') {
    const draft = await this.requireDraft(tenantId, draftId);
    const updated = await this.prisma.sdrApproval.updateMany({
      where: { tenantId, draftId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (updated.count === 0) throw new NotFoundException('Active approval not found');
    await this.prisma.sdrDraft.update({
      where: { id: draft.id },
      data: { status: 'AWAITING_APPROVAL' },
    });
    await this.audit.log({
      tenantId,
      action: 'sdr_approval_revoked',
      resourceType: 'SdrDraft',
      resourceTwentyId: draftId,
      triggeredBy,
    });
    return { revoked: true, draftId };
  }

  /**
   * Explicit human reject of a draft. Distinct from supersede (regenerate) and revoke (undo approval).
   * Rejected drafts cannot be approved or sent; a new draft may still be generated later.
   */
  async rejectDraft(
    tenantId: string,
    draftId: string,
    rejectedBy = 'admin',
    triggeredBy = 'admin-api',
  ) {
    const draft = await this.requireDraft(tenantId, draftId);
    if (draft.status === 'SENT') {
      throw new BadRequestException('Cannot reject a sent draft');
    }
    if (draft.status === 'REJECTED') {
      return {
        rejected: true,
        idempotent: true,
        draft: this.serializeDraft(draft),
      };
    }
    if (draft.status === 'SUPERSEDED') {
      throw new BadRequestException('Cannot reject a superseded draft');
    }

    const before = { status: draft.status };
    await this.prisma.sdrApproval.updateMany({
      where: { tenantId, draftId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const updated = await this.prisma.sdrDraft.update({
      where: { id: draft.id },
      data: { status: 'REJECTED' },
    });

    await this.audit.log({
      tenantId,
      action: 'sdr_draft_rejected',
      resourceType: 'SdrDraft',
      resourceTwentyId: draft.id,
      before,
      after: {
        status: 'REJECTED',
        sequenceId: draft.sequenceId,
        rejectedBy,
        version: draft.version,
        contentHash: draft.contentHash,
      },
      triggeredBy,
    });

    return { rejected: true, idempotent: false, draft: this.serializeDraft(updated) };
  }

  async sendDraft(
    tenantId: string,
    draftId: string,
    input: { sync?: boolean; fixture?: OutboundFixture; crmSyncOnly?: boolean } = {},
    triggeredBy = 'admin-api',
  ) {
    if (input.crmSyncOnly) {
      const message = await this.prisma.sdrMessage.findFirst({
        where: { tenantId, draftId, status: 'SENT' },
        orderBy: { createdAt: 'desc' },
      });
      if (!message) throw new NotFoundException('Sent message not found for CRM sync');
      if (input.sync) return this.syncCrmForMessage(tenantId, message.id, triggeredBy);
      await this.crmQueue.add(
        'crm-sync',
        { tenantId, messageId: message.id, triggeredBy },
        {
          jobId: `sdr-crm-${message.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      return { status: 'crm_sync_queued', messageId: message.id };
    }

    if (input.sync) {
      return this.executeSend({ tenantId, draftId, fixture: input.fixture, triggeredBy });
    }

    // ZEX-39: pause blocks new outbound sends (human approvals still stored; send gated)
    await this.agentControl.assertAgentNotPaused(tenantId, 'ai_sdr', triggeredBy);

    // Validate gates early so async queue fails closed at request time too
    await this.assertSendAllowed(tenantId, draftId);

    const job = await this.sendQueue.add(
      'send',
      { tenantId, draftId, fixture: input.fixture, triggeredBy },
      {
        jobId: `sdr-send-${tenantId}-${draftId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    return { status: 'queued', jobId: job.id, draftId };
  }

  async executeSend(input: {
    tenantId: string;
    draftId: string;
    fixture?: OutboundFixture;
    triggeredBy: string;
  }) {
    const { tenantId, draftId, triggeredBy } = input;

    // ZEX-39: re-check pause at send execution
    await this.agentControl.assertAgentNotPaused(tenantId, 'ai_sdr', triggeredBy);

    // Full re-check at execution time
    const gate = await this.assertSendAllowed(tenantId, draftId);
    const { draft, sequence, approval } = gate;

    const idempotencyKey = `send:${tenantId}:${draft.id}:${draft.contentHash}`;

    const existing = await this.prisma.sdrMessage.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });
    if (existing?.status === 'SENT') {
      return this.serializeMessage(existing);
    }

    let message =
      existing ||
      (await this.prisma.sdrMessage.create({
        data: {
          tenantId,
          sequenceId: sequence.id,
          draftId: draft.id,
          approvalId: approval.id,
          channel: draft.channel,
          idempotencyKey,
          status: 'QUEUED',
          crmSyncStatus: 'NONE',
        },
      }));

    await this.audit.log({
      tenantId,
      action: 'sdr_send_started',
      resourceType: 'SdrMessage',
      resourceTwentyId: message.id,
      after: { draftId, sequenceId: sequence.id },
      triggeredBy,
    });

    try {
      await this.prisma.sdrMessage.update({
        where: { id: message.id },
        data: { status: 'SENDING' },
      });

      const result = await this.outbound.sendEmail({
        tenantId,
        sequenceId: sequence.id,
        draftId: draft.id,
        messageId: message.id,
        idempotencyKey,
        toEmail: sequence.targetEmail!,
        subject: draft.subject || '',
        body: draft.body,
        fixture: input.fixture,
      });

      message = await this.prisma.sdrMessage.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          sentAt: new Date(),
          crmSyncStatus: 'PENDING',
          error: null,
        },
      });

      await this.prisma.sdrDraft.update({
        where: { id: draft.id },
        data: { status: 'SENT' },
      });
      await this.prisma.sdrSequence.update({
        where: { id: sequence.id },
        data: { status: 'ACTIVE', crmSyncStatus: 'PENDING' },
      });

      await this.audit.log({
        tenantId,
        action: 'sdr_sent',
        resourceType: 'SdrMessage',
        resourceTwentyId: message.id,
        after: {
          providerMessageId: result.providerMessageId,
          draftId,
          contentHash: draft.contentHash,
        },
        triggeredBy,
      });

      // CRM sync failure must not undo send
      try {
        await this.syncCrmForMessage(tenantId, message.id, triggeredBy);
      } catch (crmErr) {
        const crmMessage =
          crmErr instanceof Error ? crmErr.message.slice(0, 500) : 'CRM sync failed';
        await this.prisma.sdrMessage.update({
          where: { id: message.id },
          data: { crmSyncStatus: 'FAILED', crmSyncError: crmMessage },
        });
        await this.audit.log({
          tenantId,
          action: 'sdr_crm_sync_failed',
          resourceType: 'SdrMessage',
          resourceTwentyId: message.id,
          success: false,
          message: crmMessage,
          triggeredBy,
        });
      }

      return this.serializeMessage(
        await this.prisma.sdrMessage.findUniqueOrThrow({ where: { id: message.id } }),
      );
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 500) : 'Send failed';
      message = await this.prisma.sdrMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED', failedAt: new Date(), error, crmSyncStatus: 'NONE' },
      });
      await this.audit.log({
        tenantId,
        action: 'sdr_send_failed',
        resourceType: 'SdrMessage',
        resourceTwentyId: message.id,
        success: false,
        message: error,
        triggeredBy,
      });
      throw new BadRequestException(error);
    }
  }

  async syncCrmForMessage(tenantId: string, messageId: string, triggeredBy = 'admin-api') {
    const message = await this.prisma.sdrMessage.findFirst({
      where: { id: messageId, tenantId, status: 'SENT' },
    });
    if (!message) throw new NotFoundException('Sent message not found');

    const sequence = await this.requireSequence(tenantId, message.sequenceId);
    const draft = await this.requireDraft(tenantId, message.draftId);
    const personId = sequence.targetPersonTwentyId || 'sdr-unknown-person';

    const noteDone = await this.checkpoints.getCompleted(
      tenantId,
      message.id,
      CRM_WRITE_ACTIONS.CREATE_NOTE,
    );

    let noteId = noteDone.completed ? noteDone.externalId : undefined;
    if (!noteDone.completed) {
      const note = await this.twenty.createNote(tenantId, {
        title: `ZEX SDR: ${draft.purpose} email sent`,
        text:
          boundText(
            `Sent ${draft.channel} to ${sequence.targetEmail || 'unknown'}\nSubject: ${draft.subject || ''}\nProviderMsg: ${message.providerMessageId || ''}`,
            1500,
          ) || 'SDR outreach sent',
      });
      noteId = note.id;
      await this.checkpoints.recordSuccess(
        tenantId,
        message.id,
        personId,
        CRM_WRITE_ACTIONS.CREATE_NOTE,
        note.id,
      );
    }

    if (sequence.targetPersonTwentyId && noteId) {
      const linkDone = await this.checkpoints.getCompleted(
        tenantId,
        message.id,
        CRM_WRITE_ACTIONS.LINK_NOTE_TO_PERSON,
      );
      if (!linkDone.completed) {
        await this.twenty.createNoteTarget(tenantId, {
          noteId,
          personId: sequence.targetPersonTwentyId,
        });
        await this.checkpoints.recordSuccess(
          tenantId,
          message.id,
          sequence.targetPersonTwentyId,
          CRM_WRITE_ACTIONS.LINK_NOTE_TO_PERSON,
          noteId,
        );
      }
    }

    const updated = await this.prisma.sdrMessage.update({
      where: { id: message.id },
      data: { crmSyncStatus: 'COMPLETED', crmSyncError: null },
    });
    await this.prisma.sdrSequence.update({
      where: { id: sequence.id },
      data: { crmSyncStatus: 'COMPLETED' },
    });
    await this.audit.log({
      tenantId,
      action: 'sdr_crm_sync_completed',
      resourceType: 'SdrMessage',
      resourceTwentyId: message.id,
      after: { noteId, linkedPerson: Boolean(sequence.targetPersonTwentyId) },
      triggeredBy,
    });
    return this.serializeMessage(updated);
  }

  /**
   * Ingest an inbound reply.
   * - External webhook (`source: 'webhook'`): requires `providerMessageId`; never trusts sequenceId alone.
   * - Admin/internal (`source: 'admin'`): may correlate by trusted path `sequenceId` for deterministic tests.
   * When both ids are present they must refer to the same sequence (fail closed on mismatch).
   */
  async ingestReply(
    tenantId: string,
    raw: unknown,
    triggeredBy = 'reply-webhook',
    options: { source?: 'webhook' | 'admin' } = {},
  ) {
    const source = options.source ?? 'admin';
    const event = replyEventSchema.parse({ ...(raw as object), tenantId });
    const existing = await this.prisma.sdrReply.findUnique({
      where: {
        tenantId_providerEventId: { tenantId, providerEventId: event.providerEventId },
      },
    });
    if (existing) {
      return { duplicate: true, reply: existing };
    }

    if (source === 'webhook' && !event.providerMessageId) {
      throw new BadRequestException('providerMessageId required for SDR reply webhook correlation');
    }

    let sequence: SdrSequence | null = null;
    let message: SdrMessage | null = null;

    if (event.providerMessageId) {
      message = await this.prisma.sdrMessage.findFirst({
        where: { tenantId, providerMessageId: event.providerMessageId },
      });
      if (!message) {
        throw new NotFoundException('Outbound message for reply not found');
      }
      // Canonical sequence is always the message's sequence — never prefer a conflicting payload id.
      if (event.sequenceId && event.sequenceId !== message.sequenceId) {
        throw new BadRequestException(
          'sequenceId does not match providerMessageId sequence (reply correlation mismatch)',
        );
      }
      sequence = await this.requireSequence(tenantId, message.sequenceId);
    } else if (event.sequenceId) {
      // Admin/trusted path only (webhook rejected earlier without providerMessageId).
      sequence = await this.requireSequence(tenantId, event.sequenceId);
    }

    if (!sequence) {
      throw new BadRequestException('sequenceId or providerMessageId required for reply');
    }

    const reply = await this.prisma.sdrReply.create({
      data: {
        tenantId,
        sequenceId: sequence.id,
        messageId: message?.id || null,
        providerEventId: event.providerEventId,
        classification: event.classification,
        sender: boundText(event.sender, 320),
        subject: boundText(event.subject, 500),
        bodySummary: boundText(event.bodySummary, 1000),
        receivedAt: event.receivedAt ? new Date(event.receivedAt) : new Date(),
      },
    });

    await this.audit.log({
      tenantId,
      action: 'sdr_reply_received',
      resourceType: 'SdrReply',
      resourceTwentyId: reply.id,
      after: {
        sequenceId: sequence.id,
        classification: reply.classification,
        providerEventId: reply.providerEventId,
      },
      triggeredBy,
    });

    const stop =
      event.classification === 'NEGATIVE' ||
      event.classification === 'UNSUBSCRIBE' ||
      event.classification === 'NOT_NOW' ||
      true; // any genuine reply stops automated follow-ups

    if (stop) {
      const nextStatus =
        event.classification === 'UNSUBSCRIBE' || event.classification === 'NEGATIVE'
          ? 'CANCELLED'
          : 'REPLIED';
      await this.prisma.sdrSequence.update({
        where: { id: sequence.id },
        data: { status: nextStatus },
      });
      await this.audit.log({
        tenantId,
        action: 'sdr_sequence_paused_on_reply',
        resourceType: 'SdrSequence',
        resourceTwentyId: sequence.id,
        after: { status: nextStatus, classification: event.classification },
        triggeredBy,
      });
    }

    // Adapt: generate suggested reply/meeting drafts for POSITIVE/QUESTION — still need approval.
    // ZEX-39: when AI SDR is paused, still stop/cancel on reply+unsubscribe, but do not
    // continue agent-generated draft progression.
    if (event.classification === 'POSITIVE' || event.classification === 'QUESTION') {
      const paused = await this.agentControl.isPaused(tenantId, 'ai_sdr');
      if (!paused) {
        await this.createDraft(tenantId, sequence.id, { purpose: 'reply' }, triggeredBy);
        if (event.classification === 'POSITIVE') {
          await this.createDraft(tenantId, sequence.id, { purpose: 'meeting' }, triggeredBy);
        }
      }
    }

    // CRM note for reply (best-effort, checkpointed by reply id)
    try {
      const noteDone = await this.checkpoints.getCompleted(
        tenantId,
        `reply:${reply.id}`,
        CRM_WRITE_ACTIONS.CREATE_NOTE,
      );
      if (!noteDone.completed) {
        const note = await this.twenty.createNote(tenantId, {
          title: `ZEX SDR: reply (${event.classification})`,
          text: boundText(event.bodySummary || event.subject || 'Reply received', 1000) || 'Reply',
        });
        await this.checkpoints.recordSuccess(
          tenantId,
          `reply:${reply.id}`,
          sequence.targetPersonTwentyId || 'sdr-unknown-person',
          CRM_WRITE_ACTIONS.CREATE_NOTE,
          note.id,
        );
      }
    } catch {
      // reply ingestion succeeds even if CRM note fails
    }

    return {
      duplicate: false,
      reply,
      sequenceStatus: (await this.requireSequence(tenantId, sequence.id)).status,
    };
  }

  async confirmMeeting(tenantId: string, sequenceId: string, triggeredBy = 'admin-api') {
    const sequence = await this.requireSequence(tenantId, sequenceId);
    const booking = await this.prisma.sdrMeetingBooking.findFirst({
      where: { tenantId, sequenceId },
      orderBy: { createdAt: 'desc' },
    });
    if (!booking || !booking.bookingLink) {
      throw new BadRequestException('Meeting booking proposal not found');
    }
    if (sequence.status === 'CANCELLED') {
      throw new BadRequestException('Sequence cancelled');
    }

    const confirmed = await this.meetings.confirm({
      tenantId,
      bookingId: booking.id,
      bookingLink: booking.bookingLink,
    });
    const updated = await this.prisma.sdrMeetingBooking.update({
      where: { id: booking.id },
      data: {
        status: 'BOOKED',
        providerMeetingId: confirmed.providerMeetingId,
        completedAt: new Date(),
      },
    });
    await this.prisma.sdrSequence.update({
      where: { id: sequenceId },
      data: { status: 'COMPLETED' },
    });
    await this.audit.log({
      tenantId,
      action: 'sdr_meeting_booked',
      resourceType: 'SdrMeetingBooking',
      resourceTwentyId: updated.id,
      after: { providerMeetingId: confirmed.providerMeetingId },
      triggeredBy,
    });
    return updated;
  }

  verifyReplySignature(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ) {
    const secret = this.config.getOrThrow<string>('SDR_REPLY_WEBHOOK_SECRET');
    if (!signature || !timestamp) return false;
    const skewMs = Math.abs(Date.now() - Number(timestamp) * 1000);
    if (!Number.isFinite(Number(timestamp)) || skewMs > 5 * 60 * 1000) return false;
    const expectedHex = createHmac('sha256', secret)
      .update(`${timestamp}:${rawBody}`, 'utf8')
      .digest('hex');
    const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async getSequence(tenantId: string, sequenceId: string) {
    const sequence = await this.requireSequence(tenantId, sequenceId);
    const drafts = await this.prisma.sdrDraft.findMany({
      where: { tenantId, sequenceId },
      orderBy: { version: 'desc' },
    });
    const messages = await this.prisma.sdrMessage.findMany({
      where: { tenantId, sequenceId },
      orderBy: { createdAt: 'desc' },
    });
    const replies = await this.prisma.sdrReply.findMany({
      where: { tenantId, sequenceId },
      orderBy: { receivedAt: 'desc' },
    });
    const meetings = await this.prisma.sdrMeetingBooking.findMany({
      where: { tenantId, sequenceId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...this.serializeSequence(sequence),
      drafts: drafts.map(d => this.serializeDraft(d)),
      messages: messages.map(m => this.serializeMessage(m)),
      replies,
      meetings,
      version: AI_SDR_VERSION,
    };
  }

  async getDraft(tenantId: string, draftId: string) {
    return this.serializeDraft(await this.requireDraft(tenantId, draftId));
  }

  private async assertSendAllowed(tenantId: string, draftId: string) {
    const draft = await this.requireDraft(tenantId, draftId);
    const sequence = await this.requireSequence(tenantId, draft.sequenceId);

    if (STOP_STATUSES.has(sequence.status)) {
      await this.audit.log({
        tenantId,
        action: 'sdr_send_blocked_unapproved',
        resourceType: 'SdrDraft',
        resourceTwentyId: draftId,
        success: false,
        after: { reason: `sequence_${sequence.status}` },
        triggeredBy: 'send-gate',
      });
      throw new BadRequestException(`Cannot send while sequence is ${sequence.status}`);
    }
    if (draft.status === 'SUPERSEDED') {
      throw new BadRequestException('Cannot send superseded draft');
    }
    if (draft.status === 'REJECTED') {
      throw new BadRequestException('Cannot send a rejected draft');
    }
    if (!sequence.targetEmail) {
      throw new BadRequestException('Cannot send without explicit targetEmail');
    }

    const approval = await this.prisma.sdrApproval.findFirst({
      where: { tenantId, draftId: draft.id, status: 'ACTIVE' },
      orderBy: { approvedAt: 'desc' },
    });
    if (!approval) {
      await this.audit.log({
        tenantId,
        action: 'sdr_send_blocked_unapproved',
        resourceType: 'SdrDraft',
        resourceTwentyId: draftId,
        success: false,
        after: { reason: 'missing_approval' },
        triggeredBy: 'send-gate',
      });
      throw new BadRequestException('Draft is not approved');
    }
    if (approval.draftId !== draft.id) {
      throw new BadRequestException('Approval does not match draft');
    }
    if (approval.contentHash !== draft.contentHash || approval.draftVersion !== draft.version) {
      await this.audit.log({
        tenantId,
        action: 'sdr_send_blocked_unapproved',
        resourceType: 'SdrDraft',
        resourceTwentyId: draftId,
        success: false,
        after: { reason: 'hash_or_version_mismatch' },
        triggeredBy: 'send-gate',
      });
      throw new BadRequestException('Approval does not match exact draft content/version');
    }

    const liveHash = hashDraftContent({
      channel: draft.channel,
      subject: draft.subject,
      body: draft.body,
      purpose: draft.purpose,
    });
    if (liveHash !== approval.contentHash) {
      throw new BadRequestException('Draft changed after approval');
    }

    const candidate = await this.requireCandidate(tenantId, sequence.prospectCandidateId);
    if (!RESEARCHABLE.has(candidate.status)) {
      throw new BadRequestException(`Candidate status ${candidate.status} cannot send`);
    }

    return { draft, sequence, approval };
  }

  private async requireCandidate(tenantId: string, candidateId: string) {
    const c = await this.prisma.prospectCandidate.findFirst({
      where: { id: candidateId, tenantId },
    });
    if (!c) throw new NotFoundException('Prospect candidate not found');
    return c;
  }

  private async requireSequence(tenantId: string, sequenceId: string) {
    const s = await this.prisma.sdrSequence.findFirst({ where: { id: sequenceId, tenantId } });
    if (!s) throw new NotFoundException('SDR sequence not found');
    return s;
  }

  private async requireDraft(tenantId: string, draftId: string) {
    const d = await this.prisma.sdrDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!d) throw new NotFoundException('SDR draft not found');
    return d;
  }

  private serializeSequence(s: SdrSequence) {
    return {
      id: s.id,
      tenantId: s.tenantId,
      prospectCandidateId: s.prospectCandidateId,
      researchRunId: s.researchRunId,
      whyNowSnapshotId: s.whyNowSnapshotId,
      status: s.status,
      channel: s.channel,
      targetEmail: s.targetEmail,
      targetPersonTwentyId: s.targetPersonTwentyId,
      targetPersonName: s.targetPersonName,
      crmSyncStatus: s.crmSyncStatus,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private serializeDraft(d: SdrDraft) {
    return {
      id: d.id,
      tenantId: d.tenantId,
      sequenceId: d.sequenceId,
      prospectCandidateId: d.prospectCandidateId,
      version: d.version,
      channel: d.channel,
      purpose: d.purpose,
      subject: d.subject,
      body: d.body,
      evidenceRefs: d.evidenceRefs,
      researchFindingIds: d.researchFindingIds,
      whyNowSnapshotId: d.whyNowSnapshotId,
      doNotClaimApplied: d.doNotClaimApplied,
      grounding: d.grounding,
      confidence: d.confidence,
      status: d.status,
      contentHash: d.contentHash,
      generatedAt: d.generatedAt,
      supersededAt: d.supersededAt,
    };
  }

  private serializeApproval(a: SdrApproval) {
    return {
      id: a.id,
      tenantId: a.tenantId,
      sequenceId: a.sequenceId,
      draftId: a.draftId,
      draftVersion: a.draftVersion,
      contentHash: a.contentHash,
      approvedBy: a.approvedBy,
      approvedAt: a.approvedAt,
      status: a.status,
      revokedAt: a.revokedAt,
    };
  }

  private serializeMessage(m: SdrMessage) {
    return {
      id: m.id,
      tenantId: m.tenantId,
      sequenceId: m.sequenceId,
      draftId: m.draftId,
      approvalId: m.approvalId,
      channel: m.channel,
      provider: m.provider,
      providerMessageId: m.providerMessageId,
      idempotencyKey: m.idempotencyKey,
      status: m.status,
      sentAt: m.sentAt,
      failedAt: m.failedAt,
      error: m.error,
      crmSyncStatus: m.crmSyncStatus,
      crmSyncError: m.crmSyncError,
      createdAt: m.createdAt,
    };
  }
}
