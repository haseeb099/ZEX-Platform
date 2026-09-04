import { z } from 'zod';

export const WHY_NOW_SCORING_VERSION = 'why-now-v1';

/** Explicit overall weighting — documented in docs/WHY_NOW_V1.md */
export const WHY_NOW_WEIGHTS = {
  fit: 0.4,
  intent: 0.35,
  timing: 0.25,
} as const;

export const SIGNAL_TYPES = [
  'crm_migration',
  'hiring',
  'funding',
  'leadership_change',
  'tech_change',
  'expansion',
  'job_opening',
  'public_announcement',
  'inbound_engagement',
  'manual',
  'provider',
  'disqualifier_conflict',
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_CATEGORIES = [
  'buying_trigger',
  'growth',
  'risk',
  'engagement',
  'context',
  'negative',
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const signalEvidenceSchema = z.object({
  source: z.string().min(1),
  sourceUrl: z.string().nullable().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  field: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type SignalEvidence = z.infer<typeof signalEvidenceSchema>;

export const providerSignalSchema = z.object({
  signalType: z.enum(SIGNAL_TYPES),
  category: z.enum(SIGNAL_CATEGORIES),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).nullable().optional(),
  source: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  occurredAt: z.union([z.string().datetime(), z.date()]),
  confidence: z.number().min(0).max(1).default(0.7),
  relevance: z.number().min(0).max(1).default(0.7),
  evidence: z.array(signalEvidenceSchema).default([]),
  providerKey: z.string().min(1).optional(),
});

export type ProviderSignal = z.infer<typeof providerSignalSchema>;

export const providerSignalResultSchema = z.object({
  provider: z.string().min(1),
  signals: z.array(providerSignalSchema),
});

export type ProspectSignalProviderResult = z.infer<typeof providerSignalResultSchema>;

export const scoreReasonSchema = z.object({
  type: z.enum(['positive', 'negative', 'neutral', 'rule', 'decay', 'conflict']),
  label: z.string(),
  detail: z.string().optional(),
  signalId: z.string().optional(),
  field: z.string().optional(),
  weight: z.number().optional(),
});

export type ScoreReason = z.infer<typeof scoreReasonSchema>;

export type WhyNowAssessment = {
  fitScore: number;
  intentScore: number;
  timingScore: number;
  overallScore: number;
  confidence: number;
  whyNow: string;
  fitReasons: ScoreReason[];
  intentReasons: ScoreReason[];
  timingReasons: ScoreReason[];
  signalIds: string[];
  scoringVersion: string;
};

export type WhyNowFixture =
  'strong_why_now' | 'no_signal' | 'stale_signal' | 'bad_fit_recent' | 'conflicting';

export const PROSPECT_SIGNAL_PROVIDER = Symbol('PROSPECT_SIGNAL_PROVIDER');

export type ProspectSignalProviderContext = {
  companyName: string;
  domain?: string | null;
  industry?: string | null;
  companySize?: string | null;
  geography?: string | null;
  description?: string | null;
  providerKey?: string | null;
  buyingTriggers: string[];
  fixture?: WhyNowFixture;
  now?: Date;
};

export interface ProspectSignalProvider {
  readonly name: string;
  collect(context: ProspectSignalProviderContext): Promise<ProspectSignalProviderResult>;
}
