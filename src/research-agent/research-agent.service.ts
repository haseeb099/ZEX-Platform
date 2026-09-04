import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Prisma,
  ProspectCandidate,
  ProspectResearchFinding,
  ProspectResearchRun,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '@src/audit/audit.service';
import { CompanyBrainService } from '@src/company-brain/company-brain.service';
import { companyBrainPayloadSchema } from '@src/company-brain/company-brain.types';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { PROSPECT_RESEARCH_QUEUE } from '@src/jobs/jobs.constants';
import { ProspectDiscoveryIcpInput } from '@src/prospect-discovery/prospect-discovery.types';
import { buildFindingDedupeKey } from './finding-utils';
import { buildResearchPackage, sanitizeProviderFindings } from './package-builder';
import { ProspectResearchProviderService } from './providers/prospect-research-provider.service';
import {
  RESEARCH_AGENT_VERSION,
  RESEARCHABLE_STATUSES,
  ResearchFixture,
  ResearchPackage,
} from './research-agent.types';

@Injectable()
export class ResearchAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyBrain: CompanyBrainService,
    private readonly provider: ProspectResearchProviderService,
    @InjectQueue(PROSPECT_RESEARCH_QUEUE) private readonly queue: Queue,
  ) {}

  isResearchable(status: string): boolean {
    return (RESEARCHABLE_STATUSES as readonly string[]).includes(status);
  }

  async startResearch(
    tenantId: string,
    candidateId: string,
    input: { sync?: boolean; fixture?: ResearchFixture } = {},
    triggeredBy = 'admin-api',
  ) {
    const candidate = await this.requireCandidate(tenantId, candidateId);
    if (!this.isResearchable(candidate.status)) {
      await this.audit.log({
        tenantId,
        action: 'research_blocked_not_approved',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: candidateId,
        success: false,
        after: { status: candidate.status },
        triggeredBy,
      });
      throw new BadRequestException(
        `Research requires APPROVED or CREATED candidate; current status is ${candidate.status}`,
      );
    }

    const run = await this.prisma.prospectResearchRun.create({
      data: {
        tenantId,
        prospectCandidateId: candidateId,
        status: 'QUEUED',
        triggeredBy,
        fixture: input.fixture ?? null,
        researchVersion: RESEARCH_AGENT_VERSION,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'research_run_created',
      resourceType: 'ProspectResearchRun',
      resourceTwentyId: run.id,
      after: {
        prospectCandidateId: candidateId,
        status: run.status,
        fixture: input.fixture ?? null,
      },
      triggeredBy,
    });

    if (input.sync) {
      return this.executeResearch({
        tenantId,
        candidateId,
        runId: run.id,
        fixture: input.fixture,
        triggeredBy,
      });
    }

    const job = await this.queue.add(
      'research',
      {
        tenantId,
        candidateId,
        runId: run.id,
        fixture: input.fixture,
        triggeredBy,
      },
      {
        jobId: `research-${tenantId}-${candidateId}-${run.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return {
      status: 'queued',
      jobId: job.id,
      researchRunId: run.id,
      prospectCandidateId: candidateId,
    };
  }

  async executeResearch(input: {
    tenantId: string;
    candidateId: string;
    runId: string;
    fixture?: ResearchFixture;
    triggeredBy: string;
  }) {
    const run = await this.prisma.prospectResearchRun.findFirst({
      where: { id: input.runId, tenantId: input.tenantId, prospectCandidateId: input.candidateId },
    });
    if (!run) throw new NotFoundException('Research run not found');

    // Critical safety: re-check approval at execution time (not only at enqueue)
    const candidate = await this.requireCandidate(input.tenantId, input.candidateId);
    if (!this.isResearchable(candidate.status)) {
      const blocked = await this.prisma.prospectResearchRun.update({
        where: { id: run.id },
        data: {
          status: 'BLOCKED',
          completedAt: new Date(),
          error: `Blocked: candidate status is ${candidate.status}`,
          startedAt: run.startedAt ?? new Date(),
        },
      });
      await this.audit.log({
        tenantId: input.tenantId,
        action: 'research_blocked_not_approved',
        resourceType: 'ProspectResearchRun',
        resourceTwentyId: run.id,
        success: false,
        after: { prospectCandidateId: input.candidateId, status: candidate.status },
        triggeredBy: input.triggeredBy,
      });
      return this.serializeRun(blocked, []);
    }

    const discoveryRun = await this.prisma.prospectDiscoveryRun.findFirst({
      where: { id: candidate.discoveryRunId, tenantId: input.tenantId },
    });
    if (!discoveryRun) throw new NotFoundException('Discovery run not found');

    await this.prisma.prospectResearchRun.update({
      where: { id: run.id },
      data: { status: 'PROCESSING', startedAt: new Date(), error: null },
    });

    await this.audit.log({
      tenantId: input.tenantId,
      action: 'research_started',
      resourceType: 'ProspectResearchRun',
      resourceTwentyId: run.id,
      after: { prospectCandidateId: input.candidateId, provider: 'pending' },
      triggeredBy: input.triggeredBy,
    });

    try {
      const brain = await this.companyBrain.getBrain(input.tenantId, discoveryRun.companyBrainId);
      if (brain.status !== 'ready' || !brain.payload) {
        throw new BadRequestException('Company Brain must be ready before research');
      }
      const payload = companyBrainPayloadSchema.parse(brain.payload);
      const icpInput: ProspectDiscoveryIcpInput = {
        companyName: brain.companyName,
        websiteUrl: brain.websiteUrl,
        icp: payload.icp,
        personas: payload.personas,
        qualificationRules: payload.qualificationRules,
      };

      const whyNow = await this.prisma.prospectScoreSnapshot.findFirst({
        where: { tenantId: input.tenantId, prospectCandidateId: input.candidateId },
        orderBy: { createdAt: 'desc' },
      });

      const collected = await this.provider.research({
        companyName: candidate.companyName,
        domain: candidate.domain,
        websiteUrl: candidate.websiteUrl,
        industry: candidate.industry,
        companySize: candidate.companySize,
        geography: candidate.geography,
        description: candidate.description,
        providerKey: candidate.providerKey,
        buyingTriggers: payload.icp.buyingTriggers,
        useCases: payload.icp.useCases,
        fixture: input.fixture ?? (run.fixture as ResearchFixture | null) ?? undefined,
      });

      const sanitized = sanitizeProviderFindings(collected.findings);
      const persistedViews: Array<{
        id: string;
        findingType: string;
        title: string;
        summary: string;
        claim: string;
        sourceUrl: string | null;
        sourceTitle: string | null;
        confidence: number;
        relevance: number;
        stale: boolean;
        personName: string | null;
        personRole: string | null;
        excerpt: string | null;
        occurredAt: Date | null;
        evidenceType: string;
        created: boolean;
      }> = [];

      for (const raw of sanitized) {
        const dedupeKey = buildFindingDedupeKey({
          prospectCandidateId: input.candidateId,
          findingType: raw.findingType,
          claim: raw.claim,
          sourceUrl: raw.sourceUrl,
          occurredAt: raw.occurredAt,
          personName: raw.personName,
        });

        const existing = await this.prisma.prospectResearchFinding.findUnique({
          where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey } },
        });

        if (existing) {
          await this.audit.log({
            tenantId: input.tenantId,
            action: 'research_finding_duplicate_detected',
            resourceType: 'ProspectResearchFinding',
            resourceTwentyId: existing.id,
            after: { dedupeKey, researchRunId: run.id, prospectCandidateId: input.candidateId },
            triggeredBy: input.triggeredBy,
          });
          persistedViews.push({ ...this.toFindingView(existing), created: false });
          continue;
        }

        const created = await this.prisma.prospectResearchFinding.create({
          data: {
            tenantId: input.tenantId,
            researchRunId: run.id,
            prospectCandidateId: input.candidateId,
            findingType: raw.findingType,
            title: raw.title,
            summary: raw.summary,
            claim: raw.claim,
            sourceUrl: raw.sourceUrl ?? null,
            sourceTitle: raw.sourceTitle ?? null,
            sourceType: raw.sourceType ?? null,
            excerpt: raw.excerpt ?? null,
            occurredAt: raw.occurredAt ? new Date(raw.occurredAt) : null,
            publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
            confidence: raw.confidence,
            relevance: raw.relevance,
            evidenceType: raw.evidenceType,
            personName: raw.personName ?? null,
            personRole: raw.personRole ?? null,
            stale: raw.stale ?? false,
            providerKey: raw.providerKey ?? null,
            dedupeKey,
          },
        });

        await this.audit.log({
          tenantId: input.tenantId,
          action: 'research_finding_created',
          resourceType: 'ProspectResearchFinding',
          resourceTwentyId: created.id,
          after: {
            researchRunId: run.id,
            findingType: created.findingType,
            sourceUrl: created.sourceUrl,
            personName: created.personName,
          },
          triggeredBy: input.triggeredBy,
        });
        persistedViews.push({ ...this.toFindingView(created), created: true });
      }

      const buyerRoles = this.extractBuyerRoles(candidate);
      const pkg = buildResearchPackage({
        companyName: candidate.companyName,
        industry: candidate.industry,
        description: candidate.description,
        brain: icpInput,
        findings: persistedViews,
        whyNowText: whyNow?.whyNow ?? null,
        whyNowSnapshotId: whyNow?.id ?? null,
        buyerRoles,
      });

      const completed = await this.prisma.prospectResearchRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          provider: collected.provider,
          package: pkg as unknown as Prisma.InputJsonValue,
          confidence: pkg.confidence,
          whyNowSnapshotId: whyNow?.id ?? null,
          findingCount: persistedViews.length,
          error: null,
          researchVersion: RESEARCH_AGENT_VERSION,
        },
      });

      await this.audit.log({
        tenantId: input.tenantId,
        action: 'research_completed',
        resourceType: 'ProspectResearchRun',
        resourceTwentyId: completed.id,
        after: {
          prospectCandidateId: input.candidateId,
          provider: completed.provider,
          findingCount: completed.findingCount,
          confidence: completed.confidence,
          status: completed.status,
          createdFindings: persistedViews.filter(f => f.created).length,
          duplicateFindings: persistedViews.filter(f => !f.created).length,
        },
        triggeredBy: input.triggeredBy,
      });

      return this.serializeRun(completed, persistedViews, pkg);
    } catch (err) {
      const message = this.sanitizeError(err);
      const failed = await this.prisma.prospectResearchRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: message,
          // Do not set package — failed runs must not become "latest"
          package: Prisma.DbNull,
          confidence: null,
        },
      });
      await this.audit.log({
        tenantId: input.tenantId,
        action: 'research_failed',
        resourceType: 'ProspectResearchRun',
        resourceTwentyId: failed.id,
        success: false,
        message,
        after: { prospectCandidateId: input.candidateId, status: 'FAILED' },
        triggeredBy: input.triggeredBy,
      });
      throw err instanceof BadRequestException || err instanceof NotFoundException
        ? err
        : new BadRequestException(message);
    }
  }

  async getLatest(tenantId: string, candidateId: string) {
    await this.requireCandidate(tenantId, candidateId);
    const run = await this.prisma.prospectResearchRun.findFirst({
      where: { tenantId, prospectCandidateId: candidateId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    if (!run) throw new NotFoundException('Research package not found');
    return this.loadRunDetail(tenantId, run);
  }

  async getRun(tenantId: string, candidateId: string, runId: string) {
    await this.requireCandidate(tenantId, candidateId);
    const run = await this.prisma.prospectResearchRun.findFirst({
      where: { id: runId, tenantId, prospectCandidateId: candidateId },
    });
    if (!run) throw new NotFoundException('Research run not found');
    return this.loadRunDetail(tenantId, run);
  }

  async getHistory(tenantId: string, candidateId: string) {
    await this.requireCandidate(tenantId, candidateId);
    const runs = await this.prisma.prospectResearchRun.findMany({
      where: { tenantId, prospectCandidateId: candidateId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      prospectCandidateId: candidateId,
      runs: runs.map(r => ({
        id: r.id,
        status: r.status,
        provider: r.provider,
        confidence: r.confidence,
        findingCount: r.findingCount,
        researchVersion: r.researchVersion,
        whyNowSnapshotId: r.whyNowSnapshotId,
        requestedAt: r.requestedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        error: r.error,
        createdAt: r.createdAt,
      })),
    };
  }

  private async loadRunDetail(tenantId: string, run: ProspectResearchRun) {
    const pkg = run.package as ResearchPackage | null;
    const findingIds = pkg?.findingIds ?? [];
    const findings =
      findingIds.length > 0
        ? await this.prisma.prospectResearchFinding.findMany({
            where: { tenantId, id: { in: findingIds } },
          })
        : await this.prisma.prospectResearchFinding.findMany({
            where: { tenantId, researchRunId: run.id },
          });

    return this.serializeRun(
      run,
      findings.map(f => this.toFindingView(f)),
      pkg ?? undefined,
    );
  }

  private extractBuyerRoles(candidate: ProspectCandidate): string[] {
    const raw = candidate.buyerRoles;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(r => {
        if (
          r &&
          typeof r === 'object' &&
          'role' in r &&
          typeof (r as { role: unknown }).role === 'string'
        ) {
          return (r as { role: string }).role;
        }
        return null;
      })
      .filter((r): r is string => Boolean(r));
  }

  private toFindingView(f: ProspectResearchFinding) {
    return {
      id: f.id,
      findingType: f.findingType,
      title: f.title,
      summary: f.summary,
      claim: f.claim,
      sourceUrl: f.sourceUrl,
      sourceTitle: f.sourceTitle,
      confidence: f.confidence,
      relevance: f.relevance,
      stale: f.stale,
      personName: f.personName,
      personRole: f.personRole,
      excerpt: f.excerpt,
      occurredAt: f.occurredAt,
      evidenceType: f.evidenceType,
    };
  }

  private serializeRun(
    run: ProspectResearchRun,
    findings: Array<ReturnType<ResearchAgentService['toFindingView']> & { created?: boolean }>,
    pkg?: ResearchPackage,
  ) {
    return {
      id: run.id,
      tenantId: run.tenantId,
      prospectCandidateId: run.prospectCandidateId,
      status: run.status,
      provider: run.provider,
      requestedAt: run.requestedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
      researchVersion: run.researchVersion,
      confidence: run.confidence,
      findingCount: run.findingCount,
      whyNowSnapshotId: run.whyNowSnapshotId,
      package: pkg ?? (run.package as ResearchPackage | null),
      findings: findings.map(f => ({
        id: f.id,
        findingType: f.findingType,
        title: f.title,
        summary: f.summary,
        claim: f.claim,
        sourceUrl: f.sourceUrl,
        sourceTitle: f.sourceTitle,
        confidence: f.confidence,
        relevance: f.relevance,
        stale: f.stale,
        personName: f.personName,
        personRole: f.personRole,
        excerpt: f.excerpt,
        occurredAt: f.occurredAt,
        evidenceType: f.evidenceType,
      })),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private sanitizeError(err: unknown): string {
    const message = err instanceof Error ? err.message : 'Research failed';
    return message.slice(0, 500);
  }

  private async requireCandidate(tenantId: string, candidateId: string) {
    const candidate = await this.prisma.prospectCandidate.findFirst({
      where: { id: candidateId, tenantId },
    });
    if (!candidate) throw new NotFoundException('Prospect candidate not found');
    return candidate;
  }
}
