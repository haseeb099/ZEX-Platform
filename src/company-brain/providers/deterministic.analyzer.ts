import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CompanyBrainAnalyzer,
  CompanyBrainPayload,
  NormalizedSourceDocument,
  companyBrainPayloadSchema,
} from '../company-brain.types';
import { boundExcerpt, excerptAround } from '../source-normalize';

/**
 * Deterministic analyzer for tests and local/CI without LLM credentials.
 * Extracts structured conclusions only from source text markers / keywords — never invents competitors.
 */
@Injectable()
export class DeterministicCompanyBrainAnalyzer implements CompanyBrainAnalyzer {
  readonly name = 'deterministic';

  async analyze(input: {
    companyName: string;
    websiteUrl?: string | null;
    sources: NormalizedSourceDocument[];
  }): Promise<CompanyBrainPayload> {
    const combined = input.sources.map(s => s.text).join('\n');
    const primary = input.sources[0];
    if (!primary) {
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

    const industries = extractList(combined, /industr(?:y|ies)\s*:\s*([^\n]+)/i);
    const companySize = extractList(combined, /company\s*size\s*:\s*([^\n]+)/i);
    const geography = extractList(combined, /geograph(?:y|ies)\s*:\s*([^\n]+)/i);
    const useCases = extractList(combined, /use\s*cases?\s*:\s*([^\n]+)/i);
    const buyingTriggers = extractList(combined, /buying\s*triggers?\s*:\s*([^\n]+)/i);
    const disqualifiers = extractList(combined, /disqualifiers?\s*:\s*([^\n]+)/i);

    const personaRole =
      matchFirst(combined, /persona(?:s)?\s*:\s*([^\n]+)/i) ??
      matchFirst(combined, /for\s+(VP|Director|Head|CEO|CTO|CMO|Founder)s?\s+of\s+[^\n.,]+/i) ??
      'Economic buyer';

    const painStatement =
      matchFirst(combined, /pain(?:\s*points?)?\s*:\s*([^\n]+)/i) ??
      matchFirst(combined, /struggl(?:e|ing)\s+with\s+([^\n.]+)/i);

    const competitorNames = extractList(combined, /competitors?\s*:\s*([^\n]+)/i);
    const oneLiner =
      matchFirst(combined, /(?:one[- ]liner|tagline|product)\s*:\s*([^\n]+)/i) ??
      matchFirst(
        combined,
        new RegExp(`${escapeRegExp(input.companyName)}\\s+is\\s+([^.\\n]+)`, 'i'),
      );

    const valueProps = extractList(combined, /value\s*props?(?:itions)?\s*:\s*([^\n]+)/i);
    const differentiators = extractList(combined, /differentiat(?:or|ion)s?\s*:\s*([^\n]+)/i);
    const objections = extractList(combined, /objections?\s*:\s*([^\n]+)/i);
    const proofPoints = extractList(combined, /proof\s*points?\s*:\s*([^\n]+)/i);
    const themes = extractList(combined, /messaging\s*themes?\s*:\s*([^\n]+)/i);

    const targetIndustries = industries.length
      ? industries
      : extractKeywords(combined, ['saas', 'b2b', 'fintech', 'healthcare']);

    const evidenceFor = (
      claim: string | null | undefined,
      type: 'EXPLICIT' | 'INFERRED' = 'EXPLICIT',
    ) => {
      if (!claim) return [];
      const source = findSourceContaining(input.sources, claim) ?? primary;
      return [
        {
          sourceId: source.id,
          excerpt: excerptAround(source.text, claim),
          sourceUrl: source.sourceUrl,
          sourceTitle: source.title,
          confidence: type === 'EXPLICIT' ? 0.9 : 0.55,
          evidenceType: type,
        },
      ];
    };

    const icpEvidence = evidenceFor(
      industries[0] || companySize[0] || useCases[0] || targetIndustries[0] || input.companyName,
      industries.length ? 'EXPLICIT' : 'INFERRED',
    );

    const personaId = stableId('persona', personaRole);
    const painId = stableId('pain', painStatement ?? 'unspecified');
    const messagingEvidence = evidenceFor(oneLiner ?? valueProps[0] ?? input.companyName);

    const payload: CompanyBrainPayload = {
      icp: {
        industries: targetIndustries,
        companySize,
        geography,
        useCases,
        buyingTriggers,
        disqualifiers,
        evidence: icpEvidence,
      },
      personas: [
        {
          id: personaId,
          role: personaRole,
          seniority: inferSeniority(personaRole),
          function: null,
          goals: useCases.slice(0, 3),
          pains: painStatement ? [painStatement] : [],
          objections,
          buyingInfluence: 'champion',
          evidence: evidenceFor(personaRole),
        },
      ],
      painPoints: painStatement
        ? [
            {
              id: painId,
              statement: painStatement,
              severity: 'high',
              evidence: evidenceFor(painStatement),
            },
          ]
        : [],
      competitors: competitorNames.map(name => ({
        id: stableId('competitor', name),
        name,
        category: 'alternative',
        differentiation: differentiators[0] ?? null,
        certainty: 'supported' as const,
        evidence: evidenceFor(name),
      })),
      qualificationRules: [
        ...(targetIndustries.length
          ? [
              {
                id: stableId('rule', `industry-in-${targetIndustries.join(',')}`),
                polarity: 'positive' as const,
                field: 'industry',
                operator: 'in' as const,
                value: targetIndustries,
                label: 'Target industries',
                evidence: icpEvidence,
              },
            ]
          : []),
        ...(disqualifiers.length
          ? [
              {
                id: stableId('rule', `disqualify-${disqualifiers.join(',')}`),
                polarity: 'negative' as const,
                field: 'industry',
                operator: 'in' as const,
                value: disqualifiers,
                label: 'Excluded industries',
                evidence: evidenceFor(disqualifiers[0]),
              },
            ]
          : []),
        {
          id: stableId('rule', `persona-${personaRole}`),
          polarity: 'positive' as const,
          field: 'jobTitle',
          operator: 'contains' as const,
          value: personaRole.split(/\s+/)[0] ?? personaRole,
          label: 'Persona title fit',
          evidence: evidenceFor(personaRole),
        },
      ],
      messagingSummary: {
        oneLiner: oneLiner ?? `${input.companyName} helps teams operate more effectively`,
        valuePropositions: valueProps,
        differentiators,
        commonObjections: objections,
        proofPoints,
        themes: themes.length ? themes : ['efficiency', 'clarity'],
        evidence: messagingEvidence.length
          ? messagingEvidence
          : [
              {
                sourceId: primary.id,
                excerpt: boundExcerpt(primary.text),
                sourceUrl: primary.sourceUrl,
                sourceTitle: primary.title,
                confidence: 0.5,
                evidenceType: 'INFERRED' as const,
              },
            ],
      },
    };

    return companyBrainPayloadSchema.parse(payload);
  }
}

function matchFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

function extractList(text: string, re: RegExp): string[] {
  const raw = matchFirst(text, re);
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extractKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter(k => lower.includes(k));
}

function findSourceContaining(
  sources: NormalizedSourceDocument[],
  needle: string,
): NormalizedSourceDocument | undefined {
  const lower = needle.toLowerCase();
  return sources.find(s => s.text.toLowerCase().includes(lower));
}

function inferSeniority(role: string): string | null {
  if (/vp|vice president|c[a-z]o|chief|founder/i.test(role)) return 'executive';
  if (/director|head/i.test(role)) return 'director';
  if (/manager/i.test(role)) return 'manager';
  return null;
}

function stableId(prefix: string, value: string): string {
  const hash = createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 10);
  return `${prefix}_${hash}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
