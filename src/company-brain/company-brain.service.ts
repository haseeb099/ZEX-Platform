import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '@src/audit/audit.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { COMPANY_BRAIN_QUEUE } from '@src/jobs/jobs.constants';
import {
  CompanyBrainPayload,
  CompanyBrainSourceType,
  CompanyBrainUserOverrides,
  companyBrainPayloadSchema,
  competitorSchema,
  icpSchema,
  messagingSummarySchema,
  painPointSchema,
  personaSchema,
  qualificationRuleSchema,
} from './company-brain.types';
import {
  AddCompanyBrainSourceDto,
  CreateCompanyBrainDto,
  PatchCompanyBrainDto,
  PatchMessagingSummaryDto,
  UpsertPersonaDto,
  UpsertQualificationRuleDto,
} from './dto/company-brain.dto';
import { markSectionOverride, mergeGeneratedPayload } from './payload-merge';
import { CompanyBrainAnalyzerService } from './providers/company-brain-analyzer.service';
import { safeFetchText } from './safe-url-fetch';
import { hashSourceContent, normalizeSourceText } from './source-normalize';

type BrainRow = Prisma.CompanyBrainGetPayload<{ include: { sources: true } }>;

@Injectable()
export class CompanyBrainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly analyzer: CompanyBrainAnalyzerService,
    @InjectQueue(COMPANY_BRAIN_QUEUE) private readonly queue: Queue,
  ) {}

  async create(tenantId: string, dto: CreateCompanyBrainDto, triggeredBy = 'admin-api') {
    await this.requireTenant(tenantId);

    const brain = await this.prisma.companyBrain.create({
      data: {
        tenantId,
        companyName: dto.companyName,
        websiteUrl: dto.websiteUrl ?? null,
        status: 'draft',
        userOverrides: {},
      },
    });

    const sources: Awaited<ReturnType<CompanyBrainService['addSourceInternal']>>[] = [];

    if (dto.websiteUrl) {
      sources.push(
        await this.addSourceInternal(tenantId, brain.id, {
          sourceType: 'WEBSITE',
          sourceUrl: dto.websiteUrl,
        }),
      );
    }

    for (const url of dto.extraUrls ?? []) {
      sources.push(
        await this.addSourceInternal(tenantId, brain.id, {
          sourceType: 'URL',
          sourceUrl: url,
        }),
      );
    }

    if (dto.pastedText?.trim()) {
      sources.push(
        await this.addSourceInternal(tenantId, brain.id, {
          sourceType: 'PASTED_TEXT',
          title: 'Pasted text',
          text: dto.pastedText,
        }),
      );
    }

    if (dto.documentText?.trim()) {
      sources.push(
        await this.addSourceInternal(tenantId, brain.id, {
          sourceType: 'DOCUMENT_TEXT',
          title: 'Document text',
          text: dto.documentText,
        }),
      );
    }

    await this.audit.log({
      tenantId,
      action: 'company_brain_created',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brain.id,
      after: {
        id: brain.id,
        companyName: brain.companyName,
        websiteUrl: brain.websiteUrl,
        sourceCount: sources.length,
      },
      triggeredBy,
    });

    if (dto.analyze) {
      return this.enqueueOrRunAnalysis(tenantId, brain.id, {
        sync: dto.sync === true,
        triggeredBy,
      });
    }

    return this.getBrain(tenantId, brain.id);
  }

  async addSource(
    tenantId: string,
    brainId: string,
    dto: AddCompanyBrainSourceDto,
    triggeredBy = 'admin-api',
  ) {
    const source = await this.addSourceInternal(tenantId, brainId, dto);
    await this.audit.log({
      tenantId,
      action: 'company_brain_source_added',
      resourceType: 'CompanyBrainSource',
      resourceTwentyId: source.id,
      after: {
        id: source.id,
        companyBrainId: brainId,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        title: source.title,
        contentHash: source.contentHash,
        textLength: source.rawText.length,
        duplicated: source.duplicated === true,
      },
      triggeredBy,
    });
    return source;
  }

  async getBrain(tenantId: string, brainId: string) {
    const brain = await this.prisma.companyBrain.findFirst({
      where: { id: brainId, tenantId },
      include: {
        sources: { orderBy: { createdAt: 'asc' } },
        analysisJobs: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!brain) throw new NotFoundException('Company Brain not found');
    return this.serialize(brain);
  }

  async listBrains(tenantId: string) {
    await this.requireTenant(tenantId);
    const brains = await this.prisma.companyBrain.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        websiteUrl: true,
        status: true,
        version: true,
        lastAnalyzedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { brains };
  }

  async enqueueOrRunAnalysis(
    tenantId: string,
    brainId: string,
    options: { sync?: boolean; triggeredBy?: string } = {},
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    if (!brain.sources.length && options.sync !== true) {
      // still allow empty for sync empty-source tests via runAnalysis
    }

    const jobRow = await this.prisma.companyBrainAnalysisJob.create({
      data: {
        tenantId,
        companyBrainId: brainId,
        status: 'queued',
      },
    });

    await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: { status: 'analyzing', lastError: null },
    });

    if (options.sync) {
      await this.runAnalysis({
        tenantId,
        companyBrainId: brainId,
        analysisJobId: jobRow.id,
        triggeredBy: options.triggeredBy ?? 'admin-api:sync',
      });
      return this.getBrain(tenantId, brainId);
    }

    const bullJob = await this.queue.add(
      'analyze-company-brain',
      {
        tenantId,
        companyBrainId: brainId,
        analysisJobId: jobRow.id,
        triggeredBy: options.triggeredBy ?? 'admin-api',
      },
      {
        jobId: `company-brain:${tenantId}:${brainId}:${jobRow.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    await this.prisma.companyBrainAnalysisJob.update({
      where: { id: jobRow.id },
      data: { bullJobId: String(bullJob.id) },
    });

    return {
      companyBrainId: brainId,
      analysisJobId: jobRow.id,
      bullJobId: String(bullJob.id),
      status: 'queued',
    };
  }

  async runAnalysis(input: {
    tenantId: string;
    companyBrainId: string;
    analysisJobId: string;
    triggeredBy: string;
  }) {
    const brain = await this.requireBrain(input.tenantId, input.companyBrainId);

    await this.prisma.companyBrainAnalysisJob.updateMany({
      where: { id: input.analysisJobId, tenantId: input.tenantId },
      data: { status: 'processing' },
    });

    try {
      const sources = brain.sources.map(s => ({
        id: s.id,
        sourceType: s.sourceType as CompanyBrainSourceType,
        sourceUrl: s.sourceUrl,
        title: s.title,
        text: s.rawText,
      }));

      const generated = await this.analyzer.analyze({
        companyName: brain.companyName,
        websiteUrl: brain.websiteUrl,
        sources,
      });

      const overrides = (brain.userOverrides ?? {}) as CompanyBrainUserOverrides;
      const current = brain.payload ? companyBrainPayloadSchema.parse(brain.payload) : null;
      const merged = mergeGeneratedPayload({
        current,
        generated,
        overrides,
      });

      const updated = await this.prisma.companyBrain.update({
        where: { id: brain.id },
        data: {
          status: 'ready',
          version: { increment: 1 },
          generatedPayload: generated as unknown as Prisma.InputJsonValue,
          payload: merged as unknown as Prisma.InputJsonValue,
          lastAnalyzedAt: new Date(),
          lastError: null,
        },
      });

      await this.prisma.companyBrainAnalysisJob.updateMany({
        where: { id: input.analysisJobId, tenantId: input.tenantId },
        data: { status: 'completed', completedAt: new Date(), error: null },
      });

      await this.audit.log({
        tenantId: input.tenantId,
        action: 'company_brain_analyzed',
        resourceType: 'CompanyBrain',
        resourceTwentyId: brain.id,
        before: {
          status: brain.status,
          version: brain.version,
          hasPayload: Boolean(brain.payload),
        },
        after: {
          status: updated.status,
          version: updated.version,
          analyzer: this.analyzer.name,
          sections: {
            icp: true,
            personas: merged.personas.length,
            painPoints: merged.painPoints.length,
            competitors: merged.competitors.length,
            qualificationRules: merged.qualificationRules.length,
            messagingSummary: true,
          },
        },
        triggeredBy: input.triggeredBy,
      });

      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      await this.prisma.companyBrain.update({
        where: { id: brain.id },
        data: { status: 'failed', lastError: message },
      });
      await this.prisma.companyBrainAnalysisJob.updateMany({
        where: { id: input.analysisJobId, tenantId: input.tenantId },
        data: { status: 'failed', completedAt: new Date(), error: message },
      });
      await this.audit.log({
        tenantId: input.tenantId,
        action: 'company_brain_analyze_failed',
        resourceType: 'CompanyBrain',
        resourceTwentyId: brain.id,
        success: false,
        message,
        triggeredBy: input.triggeredBy,
      });
      throw err;
    }
  }

  async patchBrain(
    tenantId: string,
    brainId: string,
    dto: PatchCompanyBrainDto,
    triggeredBy = 'admin-api',
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    const currentPayload = this.parsePayload(brain.payload);
    let payload = currentPayload;
    let overrides = (brain.userOverrides ?? {}) as CompanyBrainUserOverrides;

    if (dto.icp) {
      payload = {
        ...payload,
        icp: icpSchema.parse({ ...payload.icp, ...dto.icp, evidence: payload.icp.evidence }),
      };
      overrides = markSectionOverride(overrides, 'icp');
    }
    if (dto.messagingSummary) {
      payload = {
        ...payload,
        messagingSummary: messagingSummarySchema.parse({
          ...payload.messagingSummary,
          ...dto.messagingSummary,
          evidence: payload.messagingSummary.evidence,
        }),
      };
      overrides = markSectionOverride(overrides, 'messagingSummary');
    }
    if (dto.personas) {
      payload = {
        ...payload,
        personas: dto.personas.map(p =>
          personaSchema.parse({
            evidence: [],
            goals: [],
            pains: [],
            objections: [],
            ...p,
            id: typeof p.id === 'string' ? p.id : this.newItemId('persona'),
          }),
        ),
      };
      overrides = {
        ...overrides,
        personas: Object.fromEntries(payload.personas.map(p => [p.id, true])),
      };
    }
    if (dto.painPoints) {
      payload = {
        ...payload,
        painPoints: dto.painPoints.map(p =>
          painPointSchema.parse({
            evidence: [],
            ...p,
            id: typeof p.id === 'string' ? p.id : this.newItemId('pain'),
          }),
        ),
      };
      overrides = {
        ...overrides,
        painPoints: Object.fromEntries(payload.painPoints.map(p => [p.id, true])),
      };
    }
    if (dto.competitors) {
      payload = {
        ...payload,
        competitors: dto.competitors.map(p =>
          competitorSchema.parse({
            evidence: [],
            certainty: 'uncertain',
            ...p,
            id: typeof p.id === 'string' ? p.id : this.newItemId('competitor'),
          }),
        ),
      };
      overrides = {
        ...overrides,
        competitors: Object.fromEntries(payload.competitors.map(p => [p.id, true])),
      };
    }
    if (dto.qualificationRules) {
      payload = {
        ...payload,
        qualificationRules: dto.qualificationRules.map(p =>
          qualificationRuleSchema.parse({
            evidence: [],
            ...p,
            id: typeof p.id === 'string' ? p.id : this.newItemId('rule'),
          }),
        ),
      };
      overrides = {
        ...overrides,
        qualificationRules: Object.fromEntries(payload.qualificationRules.map(p => [p.id, true])),
      };
    }

    const validated = companyBrainPayloadSchema.parse(payload);
    const updated = await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: {
        companyName: dto.companyName ?? undefined,
        websiteUrl: dto.websiteUrl === undefined ? undefined : dto.websiteUrl,
        payload: validated as unknown as Prisma.InputJsonValue,
        userOverrides: overrides as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'company_brain_edited',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brainId,
      before: { companyName: brain.companyName, websiteUrl: brain.websiteUrl },
      after: {
        companyName: updated.companyName,
        websiteUrl: updated.websiteUrl,
        overriddenSections: Object.keys(overrides),
      },
      triggeredBy,
    });

    return this.getBrain(tenantId, brainId);
  }

  async upsertPersona(
    tenantId: string,
    brainId: string,
    dto: UpsertPersonaDto,
    triggeredBy = 'admin-api',
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    const payload = this.parsePayload(brain.payload);
    const id = dto.id ?? this.newItemId('persona');
    const persona = personaSchema.parse({
      id,
      role: dto.role,
      seniority: dto.seniority ?? null,
      function: dto.function ?? null,
      goals: dto.goals ?? [],
      pains: dto.pains ?? [],
      objections: dto.objections ?? [],
      buyingInfluence: dto.buyingInfluence ?? null,
      evidence: payload.personas.find(p => p.id === id)?.evidence ?? [],
    });

    const idx = payload.personas.findIndex(p => p.id === id);
    if (idx >= 0) payload.personas[idx] = persona;
    else payload.personas.push(persona);

    const overrides = markSectionOverride(
      (brain.userOverrides ?? {}) as CompanyBrainUserOverrides,
      'personas',
      id,
    );

    await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: {
        payload: companyBrainPayloadSchema.parse(payload) as unknown as Prisma.InputJsonValue,
        userOverrides: overrides as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'company_brain_persona_upserted',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brainId,
      after: { personaId: id, role: persona.role },
      triggeredBy,
    });

    return this.getBrain(tenantId, brainId);
  }

  async removePersona(
    tenantId: string,
    brainId: string,
    personaId: string,
    triggeredBy = 'admin-api',
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    const payload = this.parsePayload(brain.payload);
    const beforeCount = payload.personas.length;
    payload.personas = payload.personas.filter(p => p.id !== personaId);
    if (payload.personas.length === beforeCount) {
      throw new NotFoundException('Persona not found');
    }

    const overrides = {
      ...((brain.userOverrides ?? {}) as CompanyBrainUserOverrides),
      personas: {
        ...(((brain.userOverrides ?? {}) as CompanyBrainUserOverrides).personas ?? {}),
        [personaId]: true,
      },
    };

    await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: {
        payload: companyBrainPayloadSchema.parse(payload) as unknown as Prisma.InputJsonValue,
        userOverrides: overrides as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'company_brain_persona_removed',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brainId,
      after: { personaId },
      triggeredBy,
    });

    return this.getBrain(tenantId, brainId);
  }

  async upsertQualificationRule(
    tenantId: string,
    brainId: string,
    dto: UpsertQualificationRuleDto,
    triggeredBy = 'admin-api',
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    const payload = this.parsePayload(brain.payload);
    const id = dto.id ?? this.newItemId('rule');
    const rule = qualificationRuleSchema.parse({
      id,
      polarity: dto.polarity,
      field: dto.field,
      operator: dto.operator,
      value: dto.value,
      label: dto.label ?? null,
      evidence: payload.qualificationRules.find(r => r.id === id)?.evidence ?? [],
    });

    const idx = payload.qualificationRules.findIndex(r => r.id === id);
    if (idx >= 0) payload.qualificationRules[idx] = rule;
    else payload.qualificationRules.push(rule);

    const overrides = markSectionOverride(
      (brain.userOverrides ?? {}) as CompanyBrainUserOverrides,
      'qualificationRules',
      id,
    );

    await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: {
        payload: companyBrainPayloadSchema.parse(payload) as unknown as Prisma.InputJsonValue,
        userOverrides: overrides as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'company_brain_qualification_rule_edited',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brainId,
      after: { ruleId: id, polarity: rule.polarity, field: rule.field },
      triggeredBy,
    });

    return this.getBrain(tenantId, brainId);
  }

  async patchMessaging(
    tenantId: string,
    brainId: string,
    dto: PatchMessagingSummaryDto,
    triggeredBy = 'admin-api',
  ) {
    const brain = await this.requireBrain(tenantId, brainId);
    const payload = this.parsePayload(brain.payload);
    payload.messagingSummary = messagingSummarySchema.parse({
      ...payload.messagingSummary,
      ...dto,
      evidence: payload.messagingSummary.evidence,
    });
    const overrides = markSectionOverride(
      (brain.userOverrides ?? {}) as CompanyBrainUserOverrides,
      'messagingSummary',
    );

    await this.prisma.companyBrain.update({
      where: { id: brainId },
      data: {
        payload: companyBrainPayloadSchema.parse(payload) as unknown as Prisma.InputJsonValue,
        userOverrides: overrides as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.log({
      tenantId,
      action: 'company_brain_messaging_edited',
      resourceType: 'CompanyBrain',
      resourceTwentyId: brainId,
      after: { oneLiner: payload.messagingSummary.oneLiner },
      triggeredBy,
    });

    return this.getBrain(tenantId, brainId);
  }

  async getAnalysisJob(tenantId: string, brainId: string, jobId: string) {
    const job = await this.prisma.companyBrainAnalysisJob.findFirst({
      where: { id: jobId, tenantId, companyBrainId: brainId },
    });
    if (!job) throw new NotFoundException('Analysis job not found');
    return job;
  }

  private async addSourceInternal(
    tenantId: string,
    brainId: string,
    dto: {
      sourceType: CompanyBrainSourceType;
      sourceUrl?: string;
      title?: string;
      text?: string;
    },
  ) {
    await this.requireBrain(tenantId, brainId);

    let rawText = dto.text ?? '';
    let sourceUrl = dto.sourceUrl ?? null;
    let title = dto.title ?? null;
    let fetchedAt: Date | null = null;
    let metadata: Prisma.InputJsonValue | undefined;

    if (dto.sourceType === 'WEBSITE' || dto.sourceType === 'URL') {
      if (!dto.sourceUrl) {
        throw new BadRequestException('sourceUrl is required for WEBSITE/URL sources');
      }
      const fetched = await safeFetchText(dto.sourceUrl);
      rawText = htmlToText(fetched.text);
      sourceUrl = fetched.finalUrl;
      fetchedAt = fetched.fetchedAt;
      metadata = {
        contentType: fetched.contentType,
        requestedUrl: dto.sourceUrl,
      };
      title = title ?? sourceUrl;
    }

    const normalized = normalizeSourceText(rawText);
    if (!normalized) {
      throw new BadRequestException('Source text is empty');
    }

    const contentHash = hashSourceContent(normalized, sourceUrl);
    const existing = await this.prisma.companyBrainSource.findUnique({
      where: {
        companyBrainId_contentHash: { companyBrainId: brainId, contentHash },
      },
    });
    if (existing) {
      if (existing.tenantId !== tenantId) {
        throw new NotFoundException('Company Brain not found');
      }
      return { ...existing, duplicated: true as const };
    }

    const created = await this.prisma.companyBrainSource.create({
      data: {
        tenantId,
        companyBrainId: brainId,
        sourceType: dto.sourceType,
        sourceUrl,
        title,
        rawText: normalized,
        contentHash,
        fetchedAt,
        metadata,
      },
    });
    return { ...created, duplicated: false as const };
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private async requireBrain(tenantId: string, brainId: string): Promise<BrainRow> {
    await this.requireTenant(tenantId);
    const brain = await this.prisma.companyBrain.findFirst({
      where: { id: brainId, tenantId },
      include: { sources: { orderBy: { createdAt: 'asc' } } },
    });
    if (!brain) throw new NotFoundException('Company Brain not found');
    return brain;
  }

  private parsePayload(raw: unknown): CompanyBrainPayload {
    if (!raw) {
      return companyBrainPayloadSchema.parse({
        icp: {
          industries: [],
          companySize: [],
          geography: [],
          useCases: [],
          buyingTriggers: [],
          disqualifiers: [],
          evidence: [],
        },
        personas: [],
        painPoints: [],
        competitors: [],
        qualificationRules: [],
        messagingSummary: {
          oneLiner: null,
          valuePropositions: [],
          differentiators: [],
          commonObjections: [],
          proofPoints: [],
          themes: [],
          evidence: [],
        },
      });
    }
    return companyBrainPayloadSchema.parse(raw);
  }

  private serialize(brain: {
    id: string;
    tenantId: string;
    companyName: string;
    websiteUrl: string | null;
    status: string;
    version: number;
    generatedPayload: unknown;
    payload: unknown;
    userOverrides: unknown;
    lastAnalyzedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    sources: Array<{
      id: string;
      sourceType: string;
      sourceUrl: string | null;
      title: string | null;
      contentHash: string;
      fetchedAt: Date | null;
      createdAt: Date;
      rawText: string;
      metadata: unknown;
    }>;
    analysisJobs?: Array<{
      id: string;
      status: string;
      bullJobId: string | null;
      error: string | null;
      createdAt: Date;
      completedAt: Date | null;
    }>;
  }) {
    const payload = brain.payload ? companyBrainPayloadSchema.parse(brain.payload) : null;
    return {
      id: brain.id,
      tenantId: brain.tenantId,
      companyName: brain.companyName,
      websiteUrl: brain.websiteUrl,
      status: brain.status,
      version: brain.version,
      payload,
      userOverrides: brain.userOverrides ?? {},
      lastAnalyzedAt: brain.lastAnalyzedAt,
      lastError: brain.lastError,
      createdAt: brain.createdAt,
      updatedAt: brain.updatedAt,
      sources: brain.sources.map(s => ({
        id: s.id,
        sourceType: s.sourceType,
        sourceUrl: s.sourceUrl,
        title: s.title,
        contentHash: s.contentHash,
        fetchedAt: s.fetchedAt,
        createdAt: s.createdAt,
        textPreview: s.rawText.slice(0, 280),
        textLength: s.rawText.length,
        metadata: s.metadata,
      })),
      recentAnalysisJobs: brain.analysisJobs ?? [],
    };
  }

  private newItemId(prefix: string): string {
    return `${prefix}_${createHash('sha1').update(randomBytes(12)).digest('hex').slice(0, 10)}`;
  }
}

function htmlToText(html: string): string {
  return normalizeSourceText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"'),
  );
}
