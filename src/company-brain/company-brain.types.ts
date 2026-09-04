import { z } from 'zod';

export const COMPANY_BRAIN_SOURCE_TYPES = [
  'WEBSITE',
  'URL',
  'PASTED_TEXT',
  'DOCUMENT_TEXT',
] as const;

export type CompanyBrainSourceType = (typeof COMPANY_BRAIN_SOURCE_TYPES)[number];

export const EVIDENCE_TYPES = ['EXPLICIT', 'INFERRED'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const evidenceSchema = z.object({
  sourceId: z.string().min(1),
  excerpt: z.string().min(1).max(500),
  sourceUrl: z.string().nullable().optional(),
  sourceTitle: z.string().nullable().optional(),
  locator: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceType: z.enum(EVIDENCE_TYPES),
});

export type CompanyBrainEvidence = z.infer<typeof evidenceSchema>;

export const icpSchema = z.object({
  industries: z.array(z.string()).default([]),
  companySize: z.array(z.string()).default([]),
  geography: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([]),
  buyingTriggers: z.array(z.string()).default([]),
  disqualifiers: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema).default([]),
});

export const personaSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  seniority: z.string().nullable().optional(),
  function: z.string().nullable().optional(),
  goals: z.array(z.string()).default([]),
  pains: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  buyingInfluence: z.string().nullable().optional(),
  evidence: z.array(evidenceSchema).default([]),
});

export const painPointSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).nullable().optional(),
  evidence: z.array(evidenceSchema).default([]),
});

export const competitorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  differentiation: z.string().nullable().optional(),
  /** supported = named in sources; inferred = reasonable alternative; uncertain = weak support */
  certainty: z.enum(['supported', 'inferred', 'uncertain']).default('uncertain'),
  evidence: z.array(evidenceSchema).default([]),
});

export const qualificationRuleSchema = z.object({
  id: z.string().min(1),
  polarity: z.enum(['positive', 'negative']),
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'in', 'not_in', 'contains', 'gte', 'lte', 'exists']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  label: z.string().nullable().optional(),
  evidence: z.array(evidenceSchema).default([]),
});

export const messagingSummarySchema = z.object({
  oneLiner: z.string().nullable().optional(),
  valuePropositions: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  commonObjections: z.array(z.string()).default([]),
  proofPoints: z.array(z.string()).default([]),
  themes: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema).default([]),
});

export const companyBrainPayloadSchema = z.object({
  icp: icpSchema,
  personas: z.array(personaSchema).default([]),
  painPoints: z.array(painPointSchema).default([]),
  competitors: z.array(competitorSchema).default([]),
  qualificationRules: z.array(qualificationRuleSchema).default([]),
  messagingSummary: messagingSummarySchema,
});

export type CompanyBrainPayload = z.infer<typeof companyBrainPayloadSchema>;

export type CompanyBrainUserOverrides = {
  icp?: boolean;
  messagingSummary?: boolean;
  personas?: Record<string, boolean>;
  painPoints?: Record<string, boolean>;
  competitors?: Record<string, boolean>;
  qualificationRules?: Record<string, boolean>;
};

export type NormalizedSourceDocument = {
  id: string;
  sourceType: CompanyBrainSourceType;
  sourceUrl: string | null;
  title: string | null;
  text: string;
};

export interface CompanyBrainAnalyzer {
  readonly name: string;
  analyze(input: {
    companyName: string;
    websiteUrl?: string | null;
    sources: NormalizedSourceDocument[];
  }): Promise<CompanyBrainPayload>;
}

export const COMPANY_BRAIN_ANALYZER = Symbol('COMPANY_BRAIN_ANALYZER');

export const COMPANY_BRAIN_SECTIONS = [
  'icp',
  'personas',
  'painPoints',
  'competitors',
  'qualificationRules',
  'messagingSummary',
] as const;

export type CompanyBrainSection = (typeof COMPANY_BRAIN_SECTIONS)[number];
