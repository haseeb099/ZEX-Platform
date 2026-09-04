import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, ProspectScoreSnapshot, ProspectSignal } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '@src/audit/audit.service';
import { CompanyBrainService } from '@src/company-brain/company-brain.service';
import { companyBrainPayloadSchema } from '@src/company-brain/company-brain.types';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { WHY_NOW_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryIcpInput } from '@src/prospect-discovery/prospect-discovery.types';
import { ProspectSignalProviderService } from './providers/prospect-signal-provider.service';
import { buildSignalDedupeKey, normalizeProviderSignal } from './signal-utils';
import { assessWhyNow } from './why-now-scoring';
import {
  providerSignalSchema,
  ScoreReason,
  WHY_NOW_SCORING_VERSION,
  WhyNowFixture,
} from './why-now.types';

@Injectable()
export class WhyNowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyBrain: CompanyBrainService,
    private readonly signals: ProspectSignalProviderService,
    @InjectQueue(WHY_NOW_QUEUE) private readonly queue: Queue,
  ) {}

  async ingestSignals(
    tenantId: string,
    candidateId: string,
    rawSignals: unknown[],
    triggeredBy = 'admin-api',
  ) {
    await this.requireCandidate(tenantId, candidateId);
    const parsed = rawSignals.map(s => providerSignalSchema.parse(s));
    const results: Array<{ signal: ProspectSignal; created: boolean }> = [];

    for (const raw of parsed) {
      const signal = normalizeProviderSignal(raw);
      const dedupeKey = buildSignalDedupeKey({
        prospectCandidateId: candidateId,
        signalType: signal.signalType,
        source: signal.source,
        occurredAt: signal.occurredAt,
        title: signal.title,
        summary: signal.summary,
      });

      const existing = await this.prisma.prospectSignal.findUnique({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
      });
      if (existing) {
        await this.audit.log({
          tenantId,
          action: 'signal_duplicate_detected',
          resourceType: 'ProspectSignal',
          resourceTwentyId: existing.id,
          after: { dedupeKey, prospectCandidateId: candidateId },
          triggeredBy,
        });
        results.push({ signal: existing, created: false });
        continue;
      }

      const created = await this.prisma.prospectSignal.create({
        data: {
          tenantId,
          prospectCandidateId: candidateId,
          signalType: signal.signalType,
          category: signal.category,
          title: signal.title,
          summary: signal.summary ?? null,
          source: signal.source,
          sourceUrl: signal.sourceUrl ?? null,
          occurredAt: signal.occurredAt,
          confidence: signal.confidence,
          relevance: signal.relevance,
          evidence: signal.evidence as unknown as Prisma.InputJsonValue,
          providerKey: signal.providerKey ?? null,
          dedupeKey,
        },
      });

      await this.audit.log({
        tenantId,
        action: 'signal_ingested',
        resourceType: 'ProspectSignal',
        resourceTwentyId: created.id,
        after: {
          prospectCandidateId: candidateId,
          signalType: created.signalType,
          source: created.source,
          occurredAt: created.occurredAt,
        },
        triggeredBy,
      });
      results.push({ signal: created, created: true });
    }

    return {
      ingested: results.filter(r => r.created).length,
      duplicates: results.filter(r => !r.created).length,
      signals: results.map(r => this.serializeSignal(r.signal)),
    };
  }

  async scoreCandidate(
    tenantId: string,
    candidateId: string,
    input: {
      sync?: boolean;
      collectSignals?: boolean;
      fixture?: WhyNowFixture;
    } = {},
    triggeredBy = 'admin-api',
  ) {
    await this.requireCandidate(tenantId, candidateId);

    if (input.sync) {
      return this.executeScore({
        tenantId,
        candidateId,
        collectSignals: input.collectSignals ?? Boolean(input.fixture),
        fixture: input.fixture,
        triggeredBy,
      });
    }

    const job = await this.queue.add(
      'score',
      {
        tenantId,
        candidateId,
        collectSignals: input.collectSignals ?? Boolean(input.fixture),
        fixture: input.fixture,
        triggeredBy,
      },
      {
        jobId: `why-now:${tenantId}:${candidateId}:${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return {
      status: 'queued',
      jobId: job.id,
      prospectCandidateId: candidateId,
    };
  }

  async executeScore(input: {
    tenantId: string;
    candidateId: string;
    collectSignals?: boolean;
    fixture?: WhyNowFixture;
    triggeredBy: string;
  }) {
    const candidate = await this.requireCandidate(input.tenantId, input.candidateId);
    const run = await this.prisma.prospectDiscoveryRun.findFirst({
      where: { id: candidate.discoveryRunId, tenantId: input.tenantId },
    });
    if (!run) throw new NotFoundException('Discovery run not found');

    try {
      const brain = await this.companyBrain.getBrain(input.tenantId, run.companyBrainId);
      if (brain.status !== 'ready' || !brain.payload) {
        throw new BadRequestException('Company Brain must be ready before Why-Now scoring');
      }
      const payload = companyBrainPayloadSchema.parse(brain.payload);
      const icpInput: ProspectDiscoveryIcpInput = {
        companyName: brain.companyName,
        websiteUrl: brain.websiteUrl,
        icp: payload.icp,
        personas: payload.personas,
        qualificationRules: payload.qualificationRules,
      };

      if (input.collectSignals || input.fixture) {
        const collected = await this.signals.collect({
          companyName: candidate.companyName,
          domain: candidate.domain,
          industry: candidate.industry,
          companySize: candidate.companySize,
          geography: candidate.geography,
          description: candidate.description,
          providerKey: candidate.providerKey,
          buyingTriggers: payload.icp.buyingTriggers,
          fixture: input.fixture,
        });
        if (collected.signals.length) {
          await this.ingestSignals(
            input.tenantId,
            input.candidateId,
            collected.signals,
            input.triggeredBy,
          );
        }
      }

      const persisted = await this.prisma.prospectSignal.findMany({
        where: { tenantId: input.tenantId, prospectCandidateId: input.candidateId },
        orderBy: { occurredAt: 'desc' },
      });

      const priorCount = await this.prisma.prospectScoreSnapshot.count({
        where: { tenantId: input.tenantId, prospectCandidateId: input.candidateId },
      });

      const assessment = assessWhyNow({
        brain: icpInput,
        candidate: {
          companyName: candidate.companyName,
          industry: candidate.industry,
          companySize: candidate.companySize,
          geography: candidate.geography,
          description: candidate.description,
        },
        signals: persisted.map(s => ({
          id: s.id,
          signalType: s.signalType,
          category: s.category,
          title: s.title,
          summary: s.summary,
          source: s.source,
          occurredAt: s.occurredAt,
          confidence: s.confidence,
          relevance: s.relevance,
        })),
      });

      const snapshot = await this.prisma.prospectScoreSnapshot.create({
        data: {
          tenantId: input.tenantId,
          prospectCandidateId: input.candidateId,
          fitScore: assessment.fitScore,
          intentScore: assessment.intentScore,
          timingScore: assessment.timingScore,
          overallScore: assessment.overallScore,
          confidence: assessment.confidence,
          whyNow: assessment.whyNow,
          fitReasons: assessment.fitReasons as unknown as Prisma.InputJsonValue,
          intentReasons: assessment.intentReasons as unknown as Prisma.InputJsonValue,
          timingReasons: assessment.timingReasons as unknown as Prisma.InputJsonValue,
          signalIds: assessment.signalIds as unknown as Prisma.InputJsonValue,
          scoringVersion: WHY_NOW_SCORING_VERSION,
        },
      });

      await this.audit.log({
        tenantId: input.tenantId,
        action: priorCount > 0 ? 'why_now_rescored' : 'why_now_scored',
        resourceType: 'ProspectScoreSnapshot',
        resourceTwentyId: snapshot.id,
        after: {
          prospectCandidateId: input.candidateId,
          fitScore: snapshot.fitScore,
          intentScore: snapshot.intentScore,
          timingScore: snapshot.timingScore,
          overallScore: snapshot.overallScore,
          confidence: snapshot.confidence,
          scoringVersion: snapshot.scoringVersion,
          signalCount: persisted.length,
        },
        triggeredBy: input.triggeredBy,
      });

      return this.serializeSnapshot(snapshot, persisted);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Why-Now scoring failed';
      await this.audit.log({
        tenantId: input.tenantId,
        action: 'why_now_score_failed',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: input.candidateId,
        success: false,
        message,
        triggeredBy: input.triggeredBy,
      });
      throw err;
    }
  }

  async getLatest(tenantId: string, candidateId: string) {
    await this.requireCandidate(tenantId, candidateId);
    const snapshot = await this.prisma.prospectScoreSnapshot.findFirst({
      where: { tenantId, prospectCandidateId: candidateId },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshot) throw new NotFoundException('Why-Now score not found');
    const signals = await this.prisma.prospectSignal.findMany({
      where: {
        tenantId,
        prospectCandidateId: candidateId,
        id: { in: Array.isArray(snapshot.signalIds) ? (snapshot.signalIds as string[]) : [] },
      },
    });
    // If signalIds empty (no-signal score), still return all current signals for context
    const signalRows =
      signals.length > 0
        ? signals
        : await this.prisma.prospectSignal.findMany({
            where: { tenantId, prospectCandidateId: candidateId },
            orderBy: { occurredAt: 'desc' },
          });
    return this.serializeSnapshot(snapshot, signalRows);
  }

  async getHistory(tenantId: string, candidateId: string) {
    await this.requireCandidate(tenantId, candidateId);
    const rows = await this.prisma.prospectScoreSnapshot.findMany({
      where: { tenantId, prospectCandidateId: candidateId },
      orderBy: { createdAt: 'desc' },
    });
    return { snapshots: rows.map(r => this.serializeSnapshot(r)) };
  }

  async scoreDiscoveryRun(
    tenantId: string,
    runId: string,
    input: { sync?: boolean; collectSignals?: boolean; fixture?: WhyNowFixture } = {},
    triggeredBy = 'admin-api',
  ) {
    await this.requireTenant(tenantId);
    const run = await this.prisma.prospectDiscoveryRun.findFirst({
      where: { id: runId, tenantId },
      include: { candidates: true },
    });
    if (!run) throw new NotFoundException('Discovery run not found');

    const results = [];
    for (const c of run.candidates) {
      if (input.sync) {
        results.push(
          await this.executeScore({
            tenantId,
            candidateId: c.id,
            collectSignals: input.collectSignals,
            fixture: input.fixture,
            triggeredBy,
          }),
        );
      } else {
        results.push(await this.scoreCandidate(tenantId, c.id, input, triggeredBy));
      }
    }
    return { runId, scored: results.length, results };
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private async requireCandidate(tenantId: string, candidateId: string) {
    await this.requireTenant(tenantId);
    const candidate = await this.prisma.prospectCandidate.findFirst({
      where: { id: candidateId, tenantId },
    });
    if (!candidate) throw new NotFoundException('Prospect candidate not found');
    return candidate;
  }

  private serializeSignal(signal: ProspectSignal) {
    return {
      id: signal.id,
      tenantId: signal.tenantId,
      prospectCandidateId: signal.prospectCandidateId,
      signalType: signal.signalType,
      category: signal.category,
      title: signal.title,
      summary: signal.summary,
      source: signal.source,
      sourceUrl: signal.sourceUrl,
      occurredAt: signal.occurredAt,
      observedAt: signal.observedAt,
      confidence: signal.confidence,
      relevance: signal.relevance,
      evidence: signal.evidence,
      providerKey: signal.providerKey,
      dedupeKey: signal.dedupeKey,
      createdAt: signal.createdAt,
    };
  }

  private serializeSnapshot(snapshot: ProspectScoreSnapshot, signals: ProspectSignal[] = []) {
    return {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      prospectCandidateId: snapshot.prospectCandidateId,
      fitScore: snapshot.fitScore,
      intentScore: snapshot.intentScore,
      timingScore: snapshot.timingScore,
      overallScore: snapshot.overallScore,
      confidence: snapshot.confidence,
      whyNow: snapshot.whyNow,
      fitReasons: snapshot.fitReasons as ScoreReason[] | null,
      intentReasons: snapshot.intentReasons as ScoreReason[] | null,
      timingReasons: snapshot.timingReasons as ScoreReason[] | null,
      signalIds: snapshot.signalIds,
      scoringVersion: snapshot.scoringVersion,
      createdAt: snapshot.createdAt,
      signals: signals.map(s => this.serializeSignal(s)),
    };
  }
}
