import { Injectable } from '@nestjs/common';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { EnrichmentResult } from '@src/enrichment/enrichment.types';
import { TwentyPerson } from '@src/twenty/twenty.types';

type ScoringConfig = {
  filters?: Array<{ field: string; operator: string; value: unknown }>;
  scoring?: {
    titleKeywords?: { keywords?: string[]; weight?: number };
    companySizeMatch?: { weight?: number };
    industryMatch?: { weight?: number };
    activityRecency?: { weight?: number; daysThreshold?: number };
  };
};

@Injectable()
export class ScoringEngine {
  constructor(private readonly prisma: PrismaService) {}

  async score(
    tenantId: string,
    person: TwentyPerson,
    enrichment: EnrichmentResult,
  ): Promise<{ score: number; factors: Record<string, number>; ruleName?: string }> {
    const rules = await this.prisma.scoringRule.findMany({
      where: { tenantId, enabled: true },
      orderBy: { priority: 'desc' },
    });

    for (const rule of rules) {
      const config = rule.rules as ScoringConfig;
      if (!this.matchesFilters(enrichment, config.filters || [])) {
        continue;
      }
      const factors = this.calculateFactors(person, enrichment, config.scoring || {});
      const total = Object.values(factors).reduce((a, b) => a + b, 0);
      return {
        score: Math.min(100, Math.max(0, total)),
        factors,
        ruleName: rule.name,
      };
    }

    // Default factors if no rule matched
    const factors = this.calculateFactors(person, enrichment, {
      titleKeywords: { keywords: ['CEO', 'VP', 'Director', 'Founder'], weight: 25 },
      companySizeMatch: { weight: 20 },
      industryMatch: { weight: 20 },
      activityRecency: { weight: 15, daysThreshold: 7 },
    });
    const total = Object.values(factors).reduce((a, b) => a + b, 0);
    return { score: Math.min(100, Math.max(0, total)), factors, ruleName: 'builtin-default' };
  }

  calculateFactors(
    person: TwentyPerson,
    enrichment: EnrichmentResult,
    scoringConfig: NonNullable<ScoringConfig['scoring']>,
  ): Record<string, number> {
    const factors: Record<string, number> = {};
    const title = (person.jobTitle || enrichment.jobTitle || '').toLowerCase();

    if (scoringConfig.titleKeywords) {
      const keywords = scoringConfig.titleKeywords.keywords || [];
      const weight = scoringConfig.titleKeywords.weight ?? 25;
      const match = keywords.some(kw => title.includes(kw.toLowerCase()));
      factors.titleMatch = match ? weight : 0;
    }

    if (scoringConfig.companySizeMatch) {
      const sizeMap: Record<string, number> = {
        '1-10': 5,
        '11-50': 15,
        '51-200': 20,
        '201-500': 18,
        '500+': 20,
        '501-1000': 20,
        '1000+': 20,
      };
      factors.companySizeMatch = sizeMap[enrichment.companySize || ''] || 0;
    }

    if (scoringConfig.industryMatch) {
      const weight = scoringConfig.industryMatch.weight ?? 20;
      factors.industryMatch = enrichment.industry ? weight : 0;
    }

    if (scoringConfig.activityRecency) {
      const weight = scoringConfig.activityRecency.weight ?? 15;
      const threshold = scoringConfig.activityRecency.daysThreshold ?? 7;
      if (person.updatedAt) {
        const daysOld = Math.floor(
          (Date.now() - new Date(person.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
        );
        factors.activityRecency = daysOld <= threshold ? weight : daysOld <= 30 ? Math.floor(weight * 0.66) : 0;
      } else {
        factors.activityRecency = Math.floor(weight * 0.5);
      }
    }

    return factors;
  }

  private matchesFilters(
    data: EnrichmentResult,
    filters: Array<{ field: string; operator: string; value: unknown }>,
  ): boolean {
    if (!filters.length) return true;
    return filters.every(filter => {
      const value = (data as Record<string, unknown>)[filter.field];
      switch (filter.operator) {
        case 'eq':
          return value === filter.value;
        case 'gte':
          return Number(value) >= Number(filter.value);
        case 'lte':
          return Number(value) <= Number(filter.value);
        case 'in':
          return Array.isArray(filter.value) && filter.value.includes(value);
        case 'contains':
          return String(value || '').includes(String(filter.value));
        default:
          return true;
      }
    });
  }
}
