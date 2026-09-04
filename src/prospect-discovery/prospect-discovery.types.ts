import { z } from 'zod';

export const PROSPECT_CANDIDATE_STATUSES = [
  'PROPOSED',
  'DUPLICATE',
  'APPROVED',
  'REJECTED',
  'CREATED',
  'FAILED',
] as const;

export type ProspectCandidateStatus = (typeof PROSPECT_CANDIDATE_STATUSES)[number];

export const DEDUPE_STATUSES = ['NEW', 'EXACT_MATCH', 'POSSIBLE_MATCH'] as const;
export type DedupeStatus = (typeof DEDUPE_STATUSES)[number];

export const evidenceSchema = z.object({
  source: z.string().min(1),
  sourceUrl: z.string().nullable().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  field: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type ProspectEvidence = z.infer<typeof evidenceSchema>;

export const buyerRoleSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  function: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  buyingInfluence: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  matchedCompanyBrainPersonaId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(evidenceSchema).default([]),
});

export type BuyingCommitteeRole = z.infer<typeof buyerRoleSchema>;

export const fitReasonSchema = z.object({
  type: z.enum(['positive', 'negative', 'rule']),
  label: z.string(),
  detail: z.string().optional(),
  ruleId: z.string().optional(),
  field: z.string().optional(),
});

export type FitReason = z.infer<typeof fitReasonSchema>;

export const providerCandidateSchema = z.object({
  providerKey: z.string().min(1),
  companyName: z.string().min(1),
  domain: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  companySize: z.string().nullable().optional(),
  geography: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  buyerRoles: z.array(buyerRoleSchema).default([]),
  evidence: z.array(evidenceSchema).default([]),
});

export type ProviderCandidate = z.infer<typeof providerCandidateSchema>;

export const providerResultSchema = z.object({
  provider: z.string().min(1),
  candidates: z.array(providerCandidateSchema),
});

export type ProspectDiscoveryProviderResult = z.infer<typeof providerResultSchema>;

export type ProspectDiscoveryIcpInput = {
  companyName: string;
  websiteUrl?: string | null;
  icp: {
    industries: string[];
    companySize: string[];
    geography: string[];
    useCases: string[];
    buyingTriggers: string[];
    disqualifiers: string[];
  };
  personas: Array<{
    id: string;
    role: string;
    seniority?: string | null;
    function?: string | null;
    buyingInfluence?: string | null;
  }>;
  qualificationRules: Array<{
    id: string;
    polarity: 'positive' | 'negative';
    field: string;
    operator: string;
    value: string | number | boolean | string[];
    label?: string | null;
  }>;
  limit?: number;
};

export interface ProspectDiscoveryProvider {
  readonly name: string;
  discover(input: ProspectDiscoveryIcpInput): Promise<ProspectDiscoveryProviderResult>;
}

export const PROSPECT_DISCOVERY_PROVIDER = Symbol('PROSPECT_DISCOVERY_PROVIDER');

export type FitAssessment = {
  fitScore: number;
  fitBand: 'strong' | 'moderate' | 'weak' | 'disqualified' | 'unknown';
  fitReasons: FitReason[];
  disqualifiers: string[];
};

export type CompanyDedupeResult = {
  status: DedupeStatus;
  existingTwentyCompanyId?: string;
  matchedName?: string;
  matchedDomain?: string;
  reason: string;
};

export type TwentyCompany = {
  id: string;
  name?: string | null;
  domain?: string | null;
  websiteUrl?: string | null;
};
