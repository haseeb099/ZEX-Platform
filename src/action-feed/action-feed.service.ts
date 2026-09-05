import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@src/common/prisma/prisma.service';
import {
  ACTION_FEED_VERSION,
  ActionFeedItem,
  ActionFeedResponse,
  ActionEvidence,
  PRIORITY_FROM_TYPE,
  TYPE_RANK,
  ActionFeedItemType,
  dedupeByProspect,
  sortActionFeedItems,
} from './action-feed.types';

@Injectable()
export class ActionFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(tenantId: string, limit = 50): Promise<ActionFeedResponse> {
    await this.requireTenant(tenantId);

    const raw: ActionFeedItem[] = [];
    raw.push(...(await this.collectMeetingItems(tenantId)));
    raw.push(...(await this.collectReplyItems(tenantId)));
    raw.push(...(await this.collectDraftApprovalItems(tenantId)));
    raw.push(...(await this.collectBlockedItems(tenantId)));
    raw.push(...(await this.collectProspectApprovalItems(tenantId)));

    const deduped = dedupeByProspect(raw);
    const sorted = sortActionFeedItems(deduped).slice(0, limit);

    const summary = {
      needsApproval: sorted.filter(
        i => i.type === 'sdr_draft_approval' || i.type === 'prospect_approval',
      ).length,
      replies: sorted.filter(i => i.type === 'reply_review').length,
      meetings: sorted.filter(i => i.type === 'meeting_opportunity').length,
      blocked: sorted.filter(i => i.type === 'workflow_blocked').length,
      total: sorted.length,
    };

    return {
      version: ACTION_FEED_VERSION,
      tenantId,
      generatedAt: new Date().toISOString(),
      summary,
      items: sorted,
    };
  }

  private async collectMeetingItems(tenantId: string): Promise<ActionFeedItem[]> {
    const bookings = await this.prisma.sdrMeetingBooking.findMany({
      where: {
        tenantId,
        status: { in: ['PROPOSED', 'AWAITING_APPROVAL'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    if (bookings.length === 0) return [];

    const sequences = await this.prisma.sdrSequence.findMany({
      where: { tenantId, id: { in: bookings.map(b => b.sequenceId) } },
    });
    const seqById = new Map(sequences.map(s => [s.id, s]));
    const candidates = await this.loadCandidates(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );
    const scores = await this.loadLatestScores(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );

    const items: ActionFeedItem[] = [];
    for (const booking of bookings) {
      const seq = seqById.get(booking.sequenceId);
      if (!seq || ['CANCELLED', 'FAILED'].includes(seq.status)) continue;
      const candidate = candidates.get(seq.prospectCandidateId);
      const score = scores.get(seq.prospectCandidateId);
      const companyName = candidate?.companyName ?? 'Prospect';
      const type: ActionFeedItemType = 'meeting_opportunity';
      items.push(
        this.item({
          type,
          entityId: seq.id,
          prospectCandidateId: seq.prospectCandidateId,
          companyName,
          whyNow: score?.whyNow ?? null,
          score: score?.overallScore ?? null,
          title: `Confirm meeting with ${companyName}`,
          summary: `Positive interest — booking ${booking.status.toLowerCase()}. Confirm when ready.`,
          evidence: this.scoreEvidence(score),
          actionKind: 'confirm_meeting',
          status: booking.status,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
          preview: {
            sequenceId: seq.id,
            bookingId: booking.id,
            bookingLink: booking.bookingLink,
            proposedTimes: booking.proposedTimes,
          },
        }),
      );
    }
    return items;
  }

  private async collectReplyItems(tenantId: string): Promise<ActionFeedItem[]> {
    const sequences = await this.prisma.sdrSequence.findMany({
      where: { tenantId, status: 'REPLIED' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    if (sequences.length === 0) return [];

    const replies = await this.prisma.sdrReply.findMany({
      where: { tenantId, sequenceId: { in: sequences.map(s => s.id) } },
      orderBy: { receivedAt: 'desc' },
    });
    const latestBySeq = new Map<string, (typeof replies)[0]>();
    for (const r of replies) {
      if (!latestBySeq.has(r.sequenceId)) latestBySeq.set(r.sequenceId, r);
    }

    // Skip sequences that already have a pending meeting booking (meeting item wins via dedupe too)
    const meetingSeqIds = new Set(
      (
        await this.prisma.sdrMeetingBooking.findMany({
          where: {
            tenantId,
            sequenceId: { in: sequences.map(s => s.id) },
            status: { in: ['PROPOSED', 'AWAITING_APPROVAL', 'BOOKED'] },
          },
          select: { sequenceId: true },
        })
      ).map(m => m.sequenceId),
    );

    const candidates = await this.loadCandidates(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );
    const scores = await this.loadLatestScores(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );

    const items: ActionFeedItem[] = [];
    for (const seq of sequences) {
      if (meetingSeqIds.has(seq.id)) continue;
      const reply = latestBySeq.get(seq.id);
      if (!reply) continue;
      if (['NEGATIVE', 'UNSUBSCRIBE'].includes(reply.classification)) continue;
      const candidate = candidates.get(seq.prospectCandidateId);
      const score = scores.get(seq.prospectCandidateId);
      const companyName = candidate?.companyName ?? 'Prospect';
      const type: ActionFeedItemType = 'reply_review';
      items.push(
        this.item({
          type,
          entityId: reply.id,
          prospectCandidateId: seq.prospectCandidateId,
          companyName,
          whyNow: score?.whyNow ?? null,
          score: score?.overallScore ?? null,
          title: `Review ${reply.classification.toLowerCase()} reply — ${companyName}`,
          summary: bound(reply.bodySummary || reply.subject || 'Inbound reply received', 240),
          evidence: [
            ...this.scoreEvidence(score),
            {
              label: 'Reply',
              text: bound(
                `${reply.classification}${reply.sender ? ` from ${reply.sender}` : ''}: ${reply.bodySummary || reply.subject || 'n/a'}`,
                400,
              ),
            },
          ],
          actionKind: 'review_reply',
          status: reply.classification,
          createdAt: reply.createdAt,
          updatedAt: reply.receivedAt,
          preview: {
            sequenceId: seq.id,
            classification: reply.classification,
            sender: reply.sender,
            subject: reply.subject,
          },
        }),
      );
    }
    return items;
  }

  private async collectDraftApprovalItems(tenantId: string): Promise<ActionFeedItem[]> {
    const drafts = await this.prisma.sdrDraft.findMany({
      where: {
        tenantId,
        status: { in: ['AWAITING_APPROVAL', 'APPROVED'] },
        purpose: { in: ['outreach', 'follow_up', 'reply', 'meeting'] },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 80,
    });
    // Prefer highest version per sequence+purpose still awaiting human send/approval
    const best = new Map<string, (typeof drafts)[0]>();
    for (const d of drafts) {
      if (d.status === 'APPROVED') {
        // Approved but not sent — Today surfaces approve only; send is separate.
        // Skip APPROVED from feed to avoid implying auto-send; only AWAITING_APPROVAL.
        continue;
      }
      const key = `${d.sequenceId}:${d.purpose}`;
      const existing = best.get(key);
      if (!existing || d.version > existing.version) best.set(key, d);
    }

    const selected = [...best.values()];
    if (selected.length === 0) return [];

    const sequences = await this.prisma.sdrSequence.findMany({
      where: { tenantId, id: { in: selected.map(d => d.sequenceId) } },
    });
    const seqById = new Map(sequences.map(s => [s.id, s]));
    const candidates = await this.loadCandidates(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );
    const scores = await this.loadLatestScores(
      tenantId,
      sequences.map(s => s.prospectCandidateId),
    );

    const items: ActionFeedItem[] = [];
    for (const draft of selected) {
      const seq = seqById.get(draft.sequenceId);
      if (!seq || ['CANCELLED', 'FAILED', 'COMPLETED'].includes(seq.status)) continue;
      const candidate = candidates.get(seq.prospectCandidateId);
      const score = scores.get(seq.prospectCandidateId);
      const companyName = candidate?.companyName ?? 'Prospect';
      const doNotClaim = asStringArray(draft.doNotClaimApplied);
      const evidence: ActionEvidence[] = [
        ...this.scoreEvidence(score),
        ...(asStringArray(draft.evidenceRefs)
          .slice(0, 5)
          .map(t => ({
            label: 'Evidence',
            text: t,
          })) as ActionEvidence[]),
        ...doNotClaim.slice(0, 3).map(t => ({ label: 'Do not claim', text: t })),
      ];
      items.push(
        this.item({
          type: 'sdr_draft_approval',
          entityId: draft.id,
          prospectCandidateId: seq.prospectCandidateId,
          companyName,
          whyNow: score?.whyNow ?? null,
          score: score?.overallScore ?? null,
          title: `Approve ${draft.purpose.replace('_', ' ')} draft — ${companyName}`,
          summary: bound(draft.subject || draft.body || 'Outreach draft ready for approval', 240),
          evidence,
          actionKind: 'approve_sdr_draft',
          secondaryKind: 'reject_sdr_draft',
          status: draft.status,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
          preview: {
            sequenceId: seq.id,
            purpose: draft.purpose,
            version: draft.version,
            contentHash: draft.contentHash,
            subject: draft.subject,
            bodyPreview: bound(draft.body || '', 500),
            targetEmail: seq.targetEmail,
            targetPersonName: seq.targetPersonName,
            doNotClaimApplied: doNotClaim,
            confidence: draft.confidence,
          },
        }),
      );
    }
    return items;
  }

  private async collectBlockedItems(tenantId: string): Promise<ActionFeedItem[]> {
    const items: ActionFeedItem[] = [];

    const failedSequences = await this.prisma.sdrSequence.findMany({
      where: { tenantId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    const candidates = await this.loadCandidates(
      tenantId,
      failedSequences.map(s => s.prospectCandidateId),
    );
    for (const seq of failedSequences) {
      const companyName = candidates.get(seq.prospectCandidateId)?.companyName ?? 'Prospect';
      items.push(
        this.item({
          type: 'workflow_blocked',
          entityId: seq.id,
          prospectCandidateId: seq.prospectCandidateId,
          companyName,
          whyNow: null,
          score: null,
          title: `SDR sequence failed — ${companyName}`,
          summary: 'Outbound workflow failed and needs attention.',
          evidence: [{ label: 'Status', text: 'Sequence status is FAILED' }],
          actionKind: 'inspect_failure',
          status: seq.status,
          createdAt: seq.createdAt,
          updatedAt: seq.updatedAt,
        }),
      );
    }

    const failedResearch = await this.prisma.prospectResearchRun.findMany({
      where: { tenantId, status: { in: ['FAILED', 'BLOCKED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    const researchCandidates = await this.loadCandidates(
      tenantId,
      failedResearch.map(r => r.prospectCandidateId),
    );
    for (const run of failedResearch) {
      const companyName =
        researchCandidates.get(run.prospectCandidateId)?.companyName ?? 'Prospect';
      items.push(
        this.item({
          type: 'workflow_blocked',
          entityId: run.id,
          prospectCandidateId: run.prospectCandidateId,
          companyName,
          whyNow: null,
          score: null,
          title: `Research ${run.status.toLowerCase()} — ${companyName}`,
          summary: bound(run.error || 'Research run needs attention', 240),
          evidence: [{ label: 'Status', text: `Research status ${run.status}` }],
          actionKind: 'inspect_failure',
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }),
      );
    }

    return items;
  }

  private async collectProspectApprovalItems(tenantId: string): Promise<ActionFeedItem[]> {
    const candidates = await this.prisma.prospectCandidate.findMany({
      where: {
        tenantId,
        status: 'PROPOSED',
        dedupeStatus: 'NEW',
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    if (candidates.length === 0) return [];

    const scores = await this.loadLatestScores(
      tenantId,
      candidates.map(c => c.id),
    );

    return candidates.map(c => {
      const score = scores.get(c.id);
      const overall = score?.overallScore ?? c.fitScore ?? 0;
      const type: ActionFeedItemType = 'prospect_approval';
      return this.item({
        type,
        entityId: c.id,
        prospectCandidateId: c.id,
        companyName: c.companyName,
        whyNow: score?.whyNow ?? null,
        score: overall,
        title: `Review prospect — ${c.companyName}`,
        summary: bound(score?.whyNow || `Fit ${c.fitScore ?? 'n/a'} · awaiting approval`, 240),
        evidence: this.scoreEvidence(score),
        actionKind: 'approve_prospect',
        secondaryKind: 'reject_prospect',
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        preview: {
          fitScore: c.fitScore,
          domain: c.domain,
          buyerRoles: c.buyerRoles,
        },
      });
    });
  }

  private item(input: {
    type: ActionFeedItemType;
    entityId: string;
    prospectCandidateId?: string | null;
    companyName?: string | null;
    whyNow?: string | null;
    score?: number | null;
    title: string;
    summary: string;
    evidence: ActionEvidence[];
    actionKind: ActionFeedItem['action']['kind'];
    secondaryKind?: ActionFeedItem['action']['kind'] | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    preview?: Record<string, unknown> | null;
  }): ActionFeedItem {
    // rankScore is type-tier only (debug/UI). Score sorts within tier via compareActionFeedItems.
    return {
      id: `${input.type}:${input.entityId}`,
      type: input.type,
      priority: PRIORITY_FROM_TYPE[input.type],
      rankScore: TYPE_RANK[input.type],
      score: input.score ?? null,
      title: input.title,
      summary: input.summary,
      prospectCandidateId: input.prospectCandidateId ?? null,
      companyName: input.companyName ?? null,
      whyNow: input.whyNow ?? null,
      evidence: input.evidence,
      action: {
        kind: input.actionKind,
        entityId: input.entityId,
        secondaryKind: input.secondaryKind ?? null,
      },
      preview: input.preview ?? null,
      status: input.status,
      createdAt: input.createdAt.toISOString(),
      updatedAt: input.updatedAt.toISOString(),
    };
  }

  private scoreEvidence(
    score:
      | {
          whyNow: string | null;
          overallScore: number;
          fitScore: number;
          intentScore: number;
          timingScore: number;
          confidence: number;
        }
      | undefined,
  ): ActionEvidence[] {
    if (!score) return [];
    const out: ActionEvidence[] = [];
    if (score.whyNow) out.push({ label: 'Why now', text: bound(score.whyNow, 400) });
    out.push({
      label: 'Scores',
      text: `Overall ${score.overallScore} · fit ${score.fitScore} · intent ${score.intentScore} · timing ${score.timingScore} · confidence ${score.confidence}`,
    });
    return out;
  }

  private async loadCandidates(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map<string, { companyName: string }>();
    const rows = await this.prisma.prospectCandidate.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, companyName: true },
    });
    return new Map(rows.map(r => [r.id, r]));
  }

  private async loadLatestScores(tenantId: string, candidateIds: string[]) {
    const unique = [...new Set(candidateIds.filter(Boolean))];
    const map = new Map<
      string,
      {
        whyNow: string | null;
        overallScore: number;
        fitScore: number;
        intentScore: number;
        timingScore: number;
        confidence: number;
      }
    >();
    if (unique.length === 0) return map;

    const rows = await this.prisma.prospectScoreSnapshot.findMany({
      where: { tenantId, prospectCandidateId: { in: unique } },
      orderBy: { createdAt: 'desc' },
    });
    for (const row of rows) {
      if (map.has(row.prospectCandidateId)) continue;
      map.set(row.prospectCandidateId, {
        whyNow: row.whyNow,
        overallScore: row.overallScore,
        fitScore: row.fitScore,
        intentScore: row.intentScore,
        timingScore: row.timingScore,
        confidence: row.confidence,
      });
    }
    return map;
  }

  private async requireTenant(tenantId: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Tenant not found');
    return t;
  }
}

function bound(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string') as string[];
  return [];
}
