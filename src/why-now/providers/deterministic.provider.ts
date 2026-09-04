import { Injectable } from '@nestjs/common';
import {
  ProspectSignalProvider,
  ProspectSignalProviderContext,
  ProspectSignalProviderResult,
  providerSignalResultSchema,
  WhyNowFixture,
} from '../why-now.types';

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Deterministic signal fixtures for CI/tests — never invents production intent.
 */
@Injectable()
export class DeterministicProspectSignalProvider implements ProspectSignalProvider {
  readonly name = 'deterministic';

  async collect(context: ProspectSignalProviderContext): Promise<ProspectSignalProviderResult> {
    const now = context.now ?? new Date();
    const fixture: WhyNowFixture =
      context.fixture || inferFixture(context.providerKey, context.industry, context.description);

    const signals = buildFixtureSignals(fixture, context, now);
    return providerSignalResultSchema.parse({
      provider: this.name,
      signals,
    });
  }
}

function inferFixture(
  providerKey?: string | null,
  industry?: string | null,
  description?: string | null,
): WhyNowFixture {
  if (
    providerKey === 'det_disqualified' ||
    /consumer/i.test(industry || '') ||
    /consumer/i.test(description || '')
  ) {
    return 'bad_fit_recent';
  }
  if (providerKey === 'det_strong_fit') return 'strong_why_now';
  if (providerKey === 'det_new_valid') return 'no_signal';
  return 'no_signal';
}

function buildFixtureSignals(
  fixture: WhyNowFixture,
  context: ProspectSignalProviderContext,
  now: Date,
) {
  const company = context.companyName;
  switch (fixture) {
    case 'strong_why_now':
      return [
        {
          signalType: 'crm_migration' as const,
          category: 'buying_trigger' as const,
          title: 'CRM migration project posted',
          summary: `${company} is migrating CRM tooling — matches buying trigger`,
          source: 'deterministic-provider',
          sourceUrl: context.domain ? `https://${context.domain}/careers` : null,
          occurredAt: daysAgo(now, 3).toISOString(),
          confidence: 0.9,
          relevance: 0.95,
          evidence: [
            {
              source: 'deterministic-provider',
              excerpt: 'CRM migration',
              field: 'buying_trigger',
              confidence: 0.9,
            },
          ],
          providerKey: 'det_sig_crm_migration',
        },
        {
          signalType: 'hiring' as const,
          category: 'growth' as const,
          title: 'Hiring RevOps / outbound roles',
          summary: 'Open roles suggest outbound scaling',
          source: 'deterministic-provider',
          occurredAt: daysAgo(now, 5).toISOString(),
          confidence: 0.8,
          relevance: 0.85,
          evidence: [
            {
              source: 'deterministic-provider',
              excerpt: 'RevOps hiring',
              confidence: 0.8,
            },
          ],
          providerKey: 'det_sig_hiring',
        },
      ];
    case 'stale_signal':
      return [
        {
          signalType: 'crm_migration' as const,
          category: 'buying_trigger' as const,
          title: 'Historical CRM migration mention',
          summary: 'Relevant but stale migration signal',
          source: 'deterministic-provider',
          occurredAt: daysAgo(now, 200).toISOString(),
          confidence: 0.75,
          relevance: 0.9,
          evidence: [
            {
              source: 'deterministic-provider',
              excerpt: 'stale CRM migration',
              confidence: 0.75,
            },
          ],
          providerKey: 'det_sig_stale_crm',
        },
      ];
    case 'bad_fit_recent':
      return [
        {
          signalType: 'funding' as const,
          category: 'growth' as const,
          title: 'Recent funding announcement',
          summary: 'Fresh activity but company is outside ICP',
          source: 'deterministic-provider',
          occurredAt: daysAgo(now, 2).toISOString(),
          confidence: 0.85,
          relevance: 0.4,
          evidence: [
            {
              source: 'deterministic-provider',
              excerpt: 'funding',
              confidence: 0.85,
            },
          ],
          providerKey: 'det_sig_funding_bad_fit',
        },
      ];
    case 'conflicting':
      return [
        {
          signalType: 'crm_migration' as const,
          category: 'buying_trigger' as const,
          title: 'CRM evaluation underway',
          summary: 'Positive buying signal',
          source: 'deterministic-provider',
          occurredAt: daysAgo(now, 4).toISOString(),
          confidence: 0.8,
          relevance: 0.9,
          evidence: [
            { source: 'deterministic-provider', excerpt: 'CRM evaluation', confidence: 0.8 },
          ],
          providerKey: 'det_sig_conflict_pos',
        },
        {
          signalType: 'disqualifier_conflict' as const,
          category: 'negative' as const,
          title: 'Budget freeze announced',
          summary: 'Conflicting negative timing/intent signal',
          source: 'deterministic-provider',
          occurredAt: daysAgo(now, 1).toISOString(),
          confidence: 0.7,
          relevance: 0.8,
          evidence: [
            { source: 'deterministic-provider', excerpt: 'budget freeze', confidence: 0.7 },
          ],
          providerKey: 'det_sig_conflict_neg',
        },
      ];
    case 'no_signal':
    default:
      return [];
  }
}
