import { z } from 'zod';

export const RESEARCH_AGENT_VERSION = 'research-agent-v1';

/** Candidate statuses that may be researched. High Why-Now score is NOT authorization. */
export const RESEARCHABLE_STATUSES = ['APPROVED', 'CREATED'] as const;
export type ResearchableStatus = (typeof RESEARCHABLE_STATUSES)[number];

export const RESEARCH_RUN_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const FINDING_TYPES = [
  'COMPANY_OVERVIEW',
  'BUSINESS_MODEL',
  'PRODUCT',
  'ICP_RELEVANCE',
  'LEADERSHIP',
  'HIRING',
  'FUNDING',
  'EXPANSION',
  'TECH_STACK',
  'CRM_CHANGE',
  'STRATEGIC_INITIATIVE',
  'PAIN_SIGNAL',
  'COMPETITOR',
  'RECENT_NEWS',
  'OBJECTION_CONTEXT',
  'OUTREACH_HOOK',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const RESEARCH_FIXTURES = [
  'strong_research',
  'sparse_research',
  'conflicting_research',
  'stale_research',
  'no_research',
  'provider_failure',
] as const;
export type ResearchFixture = (typeof RESEARCH_FIXTURES)[number];

export const providerFindingSchema = z.object({
  findingType: z.enum(FINDING_TYPES),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(1000),
  claim: z.string().min(1).max(500),
  sourceUrl: z.string().url().nullable().optional(),
  sourceTitle: z.string().max(300).nullable().optional(),
  sourceType: z.string().max(80).nullable().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  evidenceType: z.enum(['EXPLICIT', 'INFERRED']).default('EXPLICIT'),
  /** Named person only when source explicitly supports them. */
  personName: z.string().max(200).nullable().optional(),
  personRole: z.string().max(200).nullable().optional(),
  stale: z.boolean().optional(),
  providerKey: z.string().max(120).nullable().optional(),
});

export type ProviderFinding = z.infer<typeof providerFindingSchema>;

export const providerResearchResultSchema = z.object({
  provider: z.string().min(1),
  findings: z.array(providerFindingSchema),
});

export type ProviderResearchResult = z.infer<typeof providerResearchResultSchema>;

export const outreachContextSchema = z.object({
  primaryAngle: z.string().max(500),
  supportingPoints: z.array(z.string().max(400)).max(8),
  personalizationFacts: z.array(z.string().max(400)).max(8),
  risks: z.array(z.string().max(400)).max(8),
  doNotClaim: z.array(z.string().max(400)).max(12),
  suggestedBuyerRoles: z.array(z.string().max(120)).max(12),
});

export type OutreachContext = z.infer<typeof outreachContextSchema>;

export const researchPackageSchema = z.object({
  companySummary: z.string().max(2000),
  whyRelevant: z.string().max(2000),
  whyNow: z.string().max(2000),
  whyNowSnapshotId: z.string().nullable(),
  keyFindings: z
    .array(
      z.object({
        id: z.string().optional(),
        findingType: z.string(),
        title: z.string(),
        summary: z.string(),
        claim: z.string(),
        sourceUrl: z.string().nullable().optional(),
        sourceTitle: z.string().nullable().optional(),
        confidence: z.number(),
        stale: z.boolean().optional(),
        personName: z.string().nullable().optional(),
        personRole: z.string().nullable().optional(),
      }),
    )
    .max(8),
  buyingCommitteeContext: z.object({
    likelyRoles: z.array(z.string()),
    namedPeople: z.array(
      z.object({
        name: z.string(),
        role: z.string().nullable().optional(),
        sourceUrl: z.string().nullable().optional(),
        findingId: z.string().optional(),
      }),
    ),
  }),
  risksObjections: z.array(z.string().max(400)).max(10),
  outreachContext: outreachContextSchema,
  confidence: z.number().min(0).max(1),
  researchVersion: z.string(),
  findingIds: z.array(z.string()),
});

export type ResearchPackage = z.infer<typeof researchPackageSchema>;

export type ProspectResearchProviderContext = {
  companyName: string;
  domain?: string | null;
  websiteUrl?: string | null;
  industry?: string | null;
  companySize?: string | null;
  geography?: string | null;
  description?: string | null;
  providerKey?: string | null;
  buyingTriggers?: string[];
  useCases?: string[];
  fixture?: ResearchFixture;
  now?: Date;
};

export interface ProspectResearchProvider {
  readonly name: string;
  research(context: ProspectResearchProviderContext): Promise<ProviderResearchResult>;
}

export const PROSPECT_RESEARCH_PROVIDER = Symbol('PROSPECT_RESEARCH_PROVIDER');
