import { Injectable } from '@nestjs/common';
import {
  ProspectResearchProvider,
  ProspectResearchProviderContext,
  ProviderResearchResult,
  providerResearchResultSchema,
  ResearchFixture,
} from '../research-agent.types';

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Deterministic research fixtures for CI/tests — never invents production web research.
 */
@Injectable()
export class DeterministicProspectResearchProvider implements ProspectResearchProvider {
  readonly name = 'deterministic';

  async research(context: ProspectResearchProviderContext): Promise<ProviderResearchResult> {
    const now = context.now ?? new Date();
    const fixture: ResearchFixture =
      context.fixture || inferFixture(context.providerKey, context.industry);

    if (fixture === 'provider_failure') {
      throw new Error('Deterministic research provider failure (fixture)');
    }

    const findings = buildFixtureFindings(fixture, context, now);
    return providerResearchResultSchema.parse({
      provider: this.name,
      findings,
    });
  }
}

function inferFixture(providerKey?: string | null, industry?: string | null): ResearchFixture {
  if (providerKey === 'det_strong_fit') return 'strong_research';
  if (providerKey === 'det_new_valid') return 'sparse_research';
  if (providerKey === 'det_disqualified' || /consumer/i.test(industry || '')) {
    return 'conflicting_research';
  }
  return 'sparse_research';
}

function buildFixtureFindings(
  fixture: ResearchFixture,
  context: ProspectResearchProviderContext,
  now: Date,
) {
  const company = context.companyName;
  const domain = context.domain || 'example.com';
  const base = `https://${domain}`;

  switch (fixture) {
    case 'strong_research':
      return [
        {
          findingType: 'COMPANY_OVERVIEW' as const,
          title: `${company} overview`,
          summary: `${company} provides B2B SaaS tools for revenue teams.`,
          claim: `${company} is a B2B SaaS company serving revenue teams`,
          sourceUrl: `${base}/about`,
          sourceTitle: 'About',
          sourceType: 'company_site',
          excerpt: `${company} provides B2B SaaS tools for revenue teams.`,
          occurredAt: daysAgo(now, 30).toISOString(),
          confidence: 0.9,
          relevance: 0.85,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_overview',
        },
        {
          findingType: 'CRM_CHANGE' as const,
          title: 'CRM migration initiative',
          summary: `${company} posted a CRM migration project matching ICP buying triggers.`,
          claim: `${company} is running a CRM migration project`,
          sourceUrl: `${base}/careers/crm-migration`,
          sourceTitle: 'Careers',
          sourceType: 'careers',
          excerpt: 'CRM migration project — Salesforce evaluation',
          occurredAt: daysAgo(now, 4).toISOString(),
          confidence: 0.92,
          relevance: 0.95,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_crm',
        },
        {
          findingType: 'HIRING' as const,
          title: 'RevOps hiring',
          summary: `${company} is hiring RevOps / outbound roles.`,
          claim: `${company} is hiring RevOps roles`,
          sourceUrl: `${base}/careers`,
          sourceTitle: 'Careers',
          sourceType: 'careers',
          excerpt: 'Open role: Head of Revenue Operations',
          occurredAt: daysAgo(now, 6).toISOString(),
          confidence: 0.85,
          relevance: 0.88,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_hiring',
        },
        {
          findingType: 'PRODUCT' as const,
          title: 'Product focus',
          summary: 'Product messaging emphasizes outbound automation and CRM workflows.',
          claim: `${company} product emphasizes outbound automation`,
          sourceUrl: `${base}/product`,
          sourceTitle: 'Product',
          sourceType: 'company_site',
          excerpt: 'Outbound automation integrated with CRM workflows',
          confidence: 0.8,
          relevance: 0.9,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_product',
        },
        {
          findingType: 'ICP_RELEVANCE' as const,
          title: 'ICP relevance',
          summary: `Fits SaaS mid-market ICP and CRM migration / outbound scaling triggers.`,
          claim: `${company} aligns with SaaS ICP and CRM migration triggers`,
          sourceUrl: `${base}/about`,
          sourceTitle: 'About',
          sourceType: 'company_site',
          excerpt: 'SaaS mid-market revenue teams',
          confidence: 0.88,
          relevance: 0.95,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_icp',
        },
        {
          findingType: 'LEADERSHIP' as const,
          title: 'Named revenue leader',
          summary: 'Jordan Lee listed as VP Sales on the company leadership page.',
          claim: 'Jordan Lee is VP Sales',
          sourceUrl: `${base}/team`,
          sourceTitle: 'Team',
          sourceType: 'company_site',
          excerpt: 'Jordan Lee — VP Sales',
          confidence: 0.82,
          relevance: 0.8,
          evidenceType: 'EXPLICIT' as const,
          personName: 'Jordan Lee',
          personRole: 'VP Sales',
          providerKey: 'det_res_leader',
        },
        {
          findingType: 'OUTREACH_HOOK' as const,
          title: 'Outreach hook',
          summary: 'CRM migration plus RevOps hiring is a timely outreach angle.',
          claim: `${company} CRM migration coincides with RevOps hiring`,
          sourceUrl: `${base}/careers/crm-migration`,
          sourceTitle: 'Careers',
          sourceType: 'careers',
          excerpt: 'CRM migration project',
          confidence: 0.86,
          relevance: 0.92,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_hook',
        },
      ];
    case 'sparse_research':
      return [
        {
          findingType: 'COMPANY_OVERVIEW' as const,
          title: `${company} basic overview`,
          summary: `${company} appears to be a software company; limited public detail.`,
          claim: `${company} is a software company`,
          sourceUrl: `${base}/`,
          sourceTitle: 'Homepage',
          sourceType: 'company_site',
          excerpt: `${company} — software`,
          confidence: 0.55,
          relevance: 0.5,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_sparse_overview',
        },
      ];
    case 'conflicting_research':
      return [
        {
          findingType: 'CRM_CHANGE' as const,
          title: 'CRM evaluation',
          summary: `${company} evaluating CRM tooling.`,
          claim: `${company} is evaluating CRM tooling`,
          sourceUrl: `${base}/blog/crm`,
          sourceTitle: 'Blog',
          sourceType: 'news',
          excerpt: 'Evaluating CRM options',
          occurredAt: daysAgo(now, 5).toISOString(),
          confidence: 0.8,
          relevance: 0.85,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_conflict_pos',
        },
        {
          findingType: 'OBJECTION_CONTEXT' as const,
          title: 'Budget freeze',
          summary: 'Public note mentions a hiring and tooling budget freeze.',
          claim: `${company} announced a budget freeze`,
          sourceUrl: `${base}/news/budget`,
          sourceTitle: 'News',
          sourceType: 'news',
          excerpt: 'Budget freeze for hiring and tooling',
          occurredAt: daysAgo(now, 2).toISOString(),
          confidence: 0.78,
          relevance: 0.8,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_conflict_neg',
        },
      ];
    case 'stale_research':
      return [
        {
          findingType: 'CRM_CHANGE' as const,
          title: 'Historical CRM migration',
          summary: 'Older CRM migration post — contextual, not recent.',
          claim: `${company} migrated CRM tooling historically`,
          sourceUrl: `${base}/blog/old-crm`,
          sourceTitle: 'Blog archive',
          sourceType: 'news',
          excerpt: 'Completed CRM migration',
          occurredAt: daysAgo(now, 400).toISOString(),
          publishedAt: daysAgo(now, 400).toISOString(),
          confidence: 0.7,
          relevance: 0.6,
          evidenceType: 'EXPLICIT' as const,
          stale: true,
          providerKey: 'det_res_stale_crm',
        },
        {
          findingType: 'COMPANY_OVERVIEW' as const,
          title: `${company} overview`,
          summary: `${company} overview from company site.`,
          claim: `${company} is a B2B company`,
          sourceUrl: `${base}/about`,
          sourceTitle: 'About',
          sourceType: 'company_site',
          excerpt: 'B2B company',
          confidence: 0.75,
          relevance: 0.7,
          evidenceType: 'EXPLICIT' as const,
          providerKey: 'det_res_stale_overview',
        },
      ];
    case 'no_research':
      return [];
    default:
      return [];
  }
}
