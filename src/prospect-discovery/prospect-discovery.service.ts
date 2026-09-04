import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '@src/audit/audit.service';
import { CompanyBrainService } from '@src/company-brain/company-brain.service';
import { companyBrainPayloadSchema } from '@src/company-brain/company-brain.types';
import { PrismaService } from '@src/common/prisma/prisma.service';
import {
  CRM_WRITE_ACTIONS,
  JobActionCheckpointService,
} from '@src/jobs/job-action-checkpoint.service';
import { PROSPECT_DISCOVERY_QUEUE } from '@src/jobs/jobs.constants';
import { TwentyClient } from '@src/twenty/twenty.client';
import { assessIcpFit } from './fit-scoring';
import { dedupeCompanyAgainstCrm } from './company-dedupe';
import { normalizeDomain } from './domain-normalize';
import { ProspectDiscoveryProviderService } from './providers/prospect-discovery-provider.service';
import {
  ProspectDiscoveryIcpInput,
  TwentyCompany,
  buyerRoleSchema,
  fitReasonSchema,
} from './prospect-discovery.types';

@Injectable()
export class ProspectDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyBrain: CompanyBrainService,
    private readonly provider: ProspectDiscoveryProviderService,
    private readonly twenty: TwentyClient,
    private readonly checkpoints: JobActionCheckpointService,
    @InjectQueue(PROSPECT_DISCOVERY_QUEUE) private readonly queue: Queue,
  ) {}

  async startDiscovery(
    tenantId: string,
    input: { companyBrainId: string; limit?: number; sync?: boolean },
    triggeredBy = 'admin-api',
  ) {
    await this.requireTenant(tenantId);
    const brain = await this.companyBrain.getBrain(tenantId, input.companyBrainId);
    if (brain.status !== 'ready' || !brain.payload) {
      throw new BadRequestException('Company Brain must be ready with a payload before discovery');
    }

    const run = await this.prisma.prospectDiscoveryRun.create({
      data: {
        tenantId,
        companyBrainId: input.companyBrainId,
        status: 'queued',
        provider: this.provider.name,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'prospect_discovery_run_created',
      resourceType: 'ProspectDiscoveryRun',
      resourceTwentyId: run.id,
      after: { companyBrainId: input.companyBrainId, provider: this.provider.name },
      triggeredBy,
    });

    if (input.sync) {
      await this.executeDiscovery({
        tenantId,
        discoveryRunId: run.id,
        limit: input.limit,
        triggeredBy: `${triggeredBy}:sync`,
      });
      return this.getRun(tenantId, run.id);
    }

    const bullJob = await this.queue.add(
      'discover-prospects',
      {
        tenantId,
        discoveryRunId: run.id,
        limit: input.limit,
        triggeredBy,
      },
      {
        jobId: `prospect-discovery:${tenantId}:${run.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return {
      id: run.id,
      status: 'queued',
      bullJobId: String(bullJob.id),
      companyBrainId: input.companyBrainId,
    };
  }

  async executeDiscovery(input: {
    tenantId: string;
    discoveryRunId: string;
    limit?: number;
    triggeredBy: string;
  }) {
    const run = await this.prisma.prospectDiscoveryRun.findFirst({
      where: { id: input.discoveryRunId, tenantId: input.tenantId },
    });
    if (!run) throw new NotFoundException('Discovery run not found');

    await this.prisma.prospectDiscoveryRun.update({
      where: { id: run.id },
      data: { status: 'processing', error: null },
    });

    try {
      const brain = await this.companyBrain.getBrain(input.tenantId, run.companyBrainId);
      const payload = companyBrainPayloadSchema.parse(brain.payload);
      const icpInput: ProspectDiscoveryIcpInput = {
        companyName: brain.companyName,
        websiteUrl: brain.websiteUrl,
        icp: payload.icp,
        personas: payload.personas,
        qualificationRules: payload.qualificationRules,
        limit: input.limit,
      };

      const discovered = await this.provider.discover(icpInput);
      const crmCompanies = await this.loadCrmCompaniesForDedupe(
        input.tenantId,
        discovered.candidates,
      );

      const createdIds: string[] = [];
      for (const raw of discovered.candidates) {
        const fit = assessIcpFit(icpInput, raw);
        const dedupe = dedupeCompanyAgainstCrm({
          companyName: raw.companyName,
          domain: raw.domain,
          websiteUrl: raw.websiteUrl,
          crmCompanies,
        });

        let status: string = 'PROPOSED';
        if (dedupe.status === 'EXACT_MATCH') status = 'DUPLICATE';
        else if (dedupe.status === 'POSSIBLE_MATCH') status = 'PROPOSED';

        const candidate = await this.prisma.prospectCandidate.create({
          data: {
            tenantId: input.tenantId,
            discoveryRunId: run.id,
            providerKey: raw.providerKey,
            companyName: raw.companyName,
            domain: normalizeDomain(raw.domain) ?? normalizeDomain(raw.websiteUrl),
            websiteUrl: raw.websiteUrl ?? null,
            industry: raw.industry ?? null,
            companySize: raw.companySize ?? null,
            geography: raw.geography ?? null,
            description: raw.description ?? null,
            fitScore: fit.fitScore,
            fitBand: fit.fitBand,
            fitReasons: fit.fitReasons as unknown as Prisma.InputJsonValue,
            disqualifiers: fit.disqualifiers as unknown as Prisma.InputJsonValue,
            status,
            dedupeStatus: dedupe.status,
            existingTwentyCompanyId: dedupe.existingTwentyCompanyId ?? null,
            evidence: raw.evidence as unknown as Prisma.InputJsonValue,
            buyerRoles: raw.buyerRoles as unknown as Prisma.InputJsonValue,
          },
        });
        createdIds.push(candidate.id);

        await this.audit.log({
          tenantId: input.tenantId,
          action:
            dedupe.status === 'EXACT_MATCH'
              ? 'prospect_candidate_duplicate_detected'
              : 'prospect_candidate_proposed',
          resourceType: 'ProspectCandidate',
          resourceTwentyId: candidate.id,
          after: {
            companyName: candidate.companyName,
            domain: candidate.domain,
            status: candidate.status,
            dedupeStatus: candidate.dedupeStatus,
            fitScore: candidate.fitScore,
            existingTwentyCompanyId: candidate.existingTwentyCompanyId,
          },
          triggeredBy: input.triggeredBy,
        });
      }

      await this.prisma.prospectDiscoveryRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          provider: discovered.provider,
          completedAt: new Date(),
          error: null,
        },
      });

      await this.audit.log({
        tenantId: input.tenantId,
        action: 'prospect_discovery_completed',
        resourceType: 'ProspectDiscoveryRun',
        resourceTwentyId: run.id,
        after: { candidateCount: createdIds.length, provider: discovered.provider },
        triggeredBy: input.triggeredBy,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery failed';
      await this.prisma.prospectDiscoveryRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: message, completedAt: new Date() },
      });
      await this.audit.log({
        tenantId: input.tenantId,
        action: 'prospect_discovery_failed',
        resourceType: 'ProspectDiscoveryRun',
        resourceTwentyId: run.id,
        success: false,
        message,
        triggeredBy: input.triggeredBy,
      });
      throw err;
    }
  }

  async getRun(tenantId: string, runId: string) {
    const run = await this.prisma.prospectDiscoveryRun.findFirst({
      where: { id: runId, tenantId },
      include: {
        candidates: {
          orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!run) throw new NotFoundException('Discovery run not found');
    return this.serializeRun(run);
  }

  async listCandidates(tenantId: string, runId: string) {
    await this.getRun(tenantId, runId);
    const candidates = await this.prisma.prospectCandidate.findMany({
      where: { tenantId, discoveryRunId: runId },
      orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
    });
    return { candidates: candidates.map(c => this.serializeCandidate(c)) };
  }

  async getCandidate(tenantId: string, candidateId: string) {
    const candidate = await this.requireCandidate(tenantId, candidateId);
    return this.serializeCandidate(candidate);
  }

  async approveCandidate(tenantId: string, candidateId: string, triggeredBy = 'admin-api') {
    const candidate = await this.requireCandidate(tenantId, candidateId);
    if (candidate.status === 'DUPLICATE' || candidate.dedupeStatus === 'EXACT_MATCH') {
      throw new BadRequestException('Exact CRM duplicates cannot be approved for creation');
    }
    if (candidate.dedupeStatus === 'POSSIBLE_MATCH') {
      throw new BadRequestException(
        'Possible CRM matches require explicit override (not supported in v1 auto-approve)',
      );
    }
    if (!['PROPOSED', 'FAILED'].includes(candidate.status)) {
      throw new BadRequestException(`Cannot approve candidate in status ${candidate.status}`);
    }

    const updated = await this.prisma.prospectCandidate.update({
      where: { id: candidateId },
      data: { status: 'APPROVED', lastError: null },
    });

    await this.audit.log({
      tenantId,
      action: 'prospect_candidate_approved',
      resourceType: 'ProspectCandidate',
      resourceTwentyId: candidateId,
      before: { status: candidate.status },
      after: { status: updated.status },
      triggeredBy,
    });

    return this.serializeCandidate(updated);
  }

  async rejectCandidate(tenantId: string, candidateId: string, triggeredBy = 'admin-api') {
    const candidate = await this.requireCandidate(tenantId, candidateId);
    if (['CREATED', 'REJECTED'].includes(candidate.status)) {
      throw new BadRequestException(`Cannot reject candidate in status ${candidate.status}`);
    }

    const updated = await this.prisma.prospectCandidate.update({
      where: { id: candidateId },
      data: { status: 'REJECTED' },
    });

    await this.audit.log({
      tenantId,
      action: 'prospect_candidate_rejected',
      resourceType: 'ProspectCandidate',
      resourceTwentyId: candidateId,
      before: { status: candidate.status },
      after: { status: updated.status },
      triggeredBy,
    });

    return this.serializeCandidate(updated);
  }

  async createApprovedCandidate(tenantId: string, candidateId: string, triggeredBy = 'admin-api') {
    const candidate = await this.requireCandidate(tenantId, candidateId);
    if (candidate.status !== 'APPROVED' && candidate.status !== 'FAILED') {
      throw new BadRequestException(
        'Only APPROVED (or FAILED retry) candidates can be created in CRM',
      );
    }

    // Re-dedupe immediately before write (race-safe). Own prior create is not a blocker.
    const crmCompanies = await this.loadCrmCompaniesForCandidate(tenantId, candidate);
    const dedupe = dedupeCompanyAgainstCrm({
      companyName: candidate.companyName,
      domain: candidate.domain,
      websiteUrl: candidate.websiteUrl,
      crmCompanies,
    });

    const checkpointKey = candidateId;
    const existingCheckpoint = await this.checkpoints.getCompleted(
      tenantId,
      checkpointKey,
      CRM_WRITE_ACTIONS.CREATE_COMPANY,
    );
    const knownCompanyId =
      (existingCheckpoint.completed ? existingCheckpoint.externalId : undefined) ||
      candidate.createdTwentyCompanyId ||
      undefined;

    if (
      dedupe.status === 'EXACT_MATCH' &&
      dedupe.existingTwentyCompanyId &&
      knownCompanyId &&
      dedupe.existingTwentyCompanyId === knownCompanyId
    ) {
      const updated = await this.prisma.prospectCandidate.update({
        where: { id: candidateId },
        data: {
          status: 'CREATED',
          createdTwentyCompanyId: knownCompanyId,
          lastError: null,
        },
      });
      await this.audit.log({
        tenantId,
        action: 'prospect_candidate_crm_created',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: candidateId,
        after: { createdTwentyCompanyId: knownCompanyId, recovered: true },
        triggeredBy,
      });
      return this.serializeCandidate(updated);
    }

    if (dedupe.status === 'EXACT_MATCH') {
      const updated = await this.prisma.prospectCandidate.update({
        where: { id: candidateId },
        data: {
          status: 'DUPLICATE',
          dedupeStatus: 'EXACT_MATCH',
          existingTwentyCompanyId: dedupe.existingTwentyCompanyId ?? null,
          lastError: null,
        },
      });
      await this.audit.log({
        tenantId,
        action: 'prospect_candidate_duplicate_detected',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: candidateId,
        after: { existingTwentyCompanyId: updated.existingTwentyCompanyId },
        triggeredBy,
      });
      throw new BadRequestException('Candidate is an exact CRM duplicate; creation blocked');
    }

    if (dedupe.status === 'POSSIBLE_MATCH') {
      await this.prisma.prospectCandidate.update({
        where: { id: candidateId },
        data: {
          dedupeStatus: 'POSSIBLE_MATCH',
          existingTwentyCompanyId: dedupe.existingTwentyCompanyId ?? null,
        },
      });
      throw new BadRequestException('Possible CRM match — creation blocked in v1');
    }

    let twentyCompanyId = knownCompanyId;

    try {
      if (!twentyCompanyId) {
        const created = await this.twenty.createCompany(tenantId, {
          name: candidate.companyName,
          domain: candidate.domain,
          websiteUrl: candidate.websiteUrl,
        });
        twentyCompanyId = created.id;
        await this.checkpoints.recordSuccess(
          tenantId,
          checkpointKey,
          candidateId,
          CRM_WRITE_ACTIONS.CREATE_COMPANY,
          twentyCompanyId,
        );
      }

      const updated = await this.prisma.prospectCandidate.update({
        where: { id: candidateId },
        data: {
          status: 'CREATED',
          createdTwentyCompanyId: twentyCompanyId,
          lastError: null,
        },
      });

      await this.audit.log({
        tenantId,
        action: 'prospect_candidate_crm_created',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: candidateId,
        after: { createdTwentyCompanyId: twentyCompanyId },
        triggeredBy,
      });

      return this.serializeCandidate(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CRM create failed';
      await this.prisma.prospectCandidate.update({
        where: { id: candidateId },
        data: {
          status: 'FAILED',
          lastError: message,
          createdTwentyCompanyId: twentyCompanyId ?? candidate.createdTwentyCompanyId,
        },
      });
      await this.audit.log({
        tenantId,
        action: 'prospect_candidate_crm_create_failed',
        resourceType: 'ProspectCandidate',
        resourceTwentyId: candidateId,
        success: false,
        message,
        triggeredBy,
      });
      throw err;
    }
  }

  private async loadCrmCompaniesForDedupe(
    tenantId: string,
    candidates: Array<{ domain?: string | null; websiteUrl?: string | null; companyName: string }>,
  ): Promise<TwentyCompany[]> {
    const byId = new Map<string, TwentyCompany>();
    for (const c of candidates) {
      const domain = normalizeDomain(c.domain) ?? normalizeDomain(c.websiteUrl);
      if (domain) {
        try {
          for (const hit of await this.twenty.findCompaniesByDomain(tenantId, domain)) {
            byId.set(hit.id, hit);
          }
        } catch {
          // CRM read failures should not invent matches; continue with what we have
        }
      }
      try {
        for (const hit of await this.twenty.findCompaniesByName(tenantId, c.companyName)) {
          byId.set(hit.id, hit);
        }
      } catch {
        // ignore
      }
    }
    return [...byId.values()];
  }

  private async loadCrmCompaniesForCandidate(
    tenantId: string,
    candidate: { domain: string | null; websiteUrl: string | null; companyName: string },
  ): Promise<TwentyCompany[]> {
    return this.loadCrmCompaniesForDedupe(tenantId, [candidate]);
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

  private serializeRun(run: any) {
    return {
      id: run.id,
      tenantId: run.tenantId,
      companyBrainId: run.companyBrainId,
      status: run.status,
      provider: run.provider,
      error: run.error,
      requestedAt: run.requestedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      candidateSummary: {
        total: run.candidates?.length ?? 0,
        byStatus: (run.candidates ?? []).reduce((acc: Record<string, number>, c: any) => {
          acc[c.status] = (acc[c.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      candidates: (run.candidates ?? []).map((c: any) => this.serializeCandidate(c)),
    };
  }

  private serializeCandidate(candidate: any) {
    return {
      id: candidate.id,
      tenantId: candidate.tenantId,
      discoveryRunId: candidate.discoveryRunId,
      providerKey: candidate.providerKey,
      companyName: candidate.companyName,
      domain: candidate.domain,
      websiteUrl: candidate.websiteUrl,
      industry: candidate.industry,
      companySize: candidate.companySize,
      geography: candidate.geography,
      description: candidate.description,
      fitScore: candidate.fitScore,
      fitBand: candidate.fitBand,
      fitReasons: Array.isArray(candidate.fitReasons)
        ? candidate.fitReasons.map((r: unknown) => fitReasonSchema.parse(r))
        : candidate.fitReasons,
      disqualifiers: candidate.disqualifiers ?? [],
      status: candidate.status,
      dedupeStatus: candidate.dedupeStatus,
      existingTwentyCompanyId: candidate.existingTwentyCompanyId,
      createdTwentyCompanyId: candidate.createdTwentyCompanyId,
      evidence: candidate.evidence ?? [],
      buyerRoles: Array.isArray(candidate.buyerRoles)
        ? candidate.buyerRoles.map((r: unknown) => buyerRoleSchema.parse(r))
        : candidate.buyerRoles,
      lastError: candidate.lastError,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  }
}
