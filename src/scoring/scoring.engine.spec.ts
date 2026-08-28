import { ScoringEngine } from './scoring.engine';
import { EnrichmentResult } from '@src/enrichment/enrichment.types';

describe('ScoringEngine', () => {
  const engine = new ScoringEngine({} as never);

  it('scores a VP at mid-market tech company highly', () => {
    const person = {
      id: 'p1',
      jobTitle: 'VP of Sales',
      updatedAt: new Date().toISOString(),
    };
    const enrichment: EnrichmentResult = {
      companySize: '51-200',
      industry: 'SaaS',
      source: 'clearbit',
      confidence: 90,
    };

    const factors = engine.calculateFactors(person, enrichment, {
      titleKeywords: { keywords: ['CEO', 'VP', 'Director'], weight: 25 },
      companySizeMatch: { weight: 20 },
      industryMatch: { weight: 20 },
      activityRecency: { weight: 15, daysThreshold: 7 },
    });

    const score = Object.values(factors).reduce((a, b) => a + b, 0);
    expect(factors.titleMatch).toBe(25);
    expect(factors.companySizeMatch).toBe(20);
    expect(factors.industryMatch).toBe(20);
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('gives zero titleMatch when title does not match', () => {
    const factors = engine.calculateFactors(
      { id: 'p2', jobTitle: 'Intern' },
      { source: 'manual', confidence: 20, industry: 'Retail', companySize: '1-10' },
      {
        titleKeywords: { keywords: ['CEO', 'VP'], weight: 25 },
        companySizeMatch: { weight: 20 },
        industryMatch: { weight: 20 },
      },
    );
    expect(factors.titleMatch).toBe(0);
  });
});
