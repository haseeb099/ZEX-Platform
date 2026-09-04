import { assessIcpFit } from '@src/prospect-discovery/fit-scoring';
import { buildSignalDedupeKey, clampScore, daysBetween, timingDecayFactor } from './signal-utils';
import { assessWhyNow } from './why-now-scoring';
import { WHY_NOW_WEIGHTS } from './why-now.types';
import { DeterministicProspectSignalProvider } from './providers/deterministic.provider';

const brain = {
  companyName: 'ZEX',
  icp: {
    industries: ['SaaS'],
    companySize: ['11-50'],
    geography: ['US', 'UK'],
    useCases: ['lead enrichment'],
    buyingTriggers: ['CRM migration', 'outbound scaling'],
    disqualifiers: ['consumer marketplaces'],
  },
  personas: [{ id: 'p1', role: 'VP Sales' }],
  qualificationRules: [
    {
      id: 'r1',
      polarity: 'positive' as const,
      field: 'industry',
      operator: 'contains',
      value: 'SaaS',
      label: 'SaaS industry',
    },
  ],
};

const strongCandidate = {
  companyName: 'Northwind Analytics',
  industry: 'SaaS',
  companySize: '11-50',
  geography: 'US',
  description: 'B2B SaaS',
};

describe('signal-utils', () => {
  it('clamps scores to 0–100', () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(150)).toBe(100);
  });

  it('decays timing by age buckets', () => {
    expect(timingDecayFactor(3)).toBe(1);
    expect(timingDecayFactor(20)).toBe(0.7);
    expect(timingDecayFactor(60)).toBe(0.35);
    expect(timingDecayFactor(120)).toBe(0.15);
    expect(timingDecayFactor(400)).toBe(0.05);
  });

  it('builds stable dedupe keys', () => {
    const a = buildSignalDedupeKey({
      prospectCandidateId: 'c1',
      signalType: 'crm_migration',
      source: 'deterministic-provider',
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
      title: 'CRM migration project posted',
      summary: 'x',
    });
    const b = buildSignalDedupeKey({
      prospectCandidateId: 'c1',
      signalType: 'crm_migration',
      source: 'deterministic-provider',
      occurredAt: new Date('2026-09-01T12:00:00.000Z'),
      title: 'CRM migration project posted',
      summary: 'x',
    });
    expect(a).toBe(b);
  });

  it('computes day deltas', () => {
    expect(daysBetween(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-07T00:00:00Z'))).toBe(3);
  });
});

describe('why-now scoring', () => {
  const now = new Date('2026-09-04T12:00:00.000Z');

  it('uses documented overall weights', () => {
    expect(WHY_NOW_WEIGHTS.fit + WHY_NOW_WEIGHTS.intent + WHY_NOW_WEIGHTS.timing).toBeCloseTo(1);
  });

  it('reuses ICP fit for strong candidates', () => {
    const fit = assessIcpFit(brain, strongCandidate);
    const scored = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [],
      now,
    });
    expect(scored.fitScore).toBe(fit.fitScore);
    expect(scored.fitScore).toBeGreaterThanOrEqual(75);
  });

  it('scores strong why-now with recent buying-trigger signal', () => {
    const scored = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [
        {
          id: 's1',
          signalType: 'crm_migration',
          category: 'buying_trigger',
          title: 'CRM migration project posted',
          summary: 'CRM migration',
          source: 'test',
          occurredAt: new Date('2026-09-01T12:00:00.000Z'),
          confidence: 0.9,
          relevance: 0.95,
        },
      ],
      now,
    });
    expect(scored.fitScore).toBeGreaterThanOrEqual(75);
    expect(scored.intentScore).toBeGreaterThanOrEqual(60);
    expect(scored.timingScore).toBeGreaterThanOrEqual(55);
    expect(scored.overallScore).toBeGreaterThanOrEqual(65);
    expect(scored.confidence).toBeGreaterThan(0.5);
    expect(scored.confidence).not.toBe(scored.overallScore / 100);
    expect(scored.whyNow.toLowerCase()).toContain('crm');
    expect(scored.intentReasons.some(r => r.type === 'positive')).toBe(true);
  });

  it('keeps intent/timing low with no signals', () => {
    const scored = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [],
      now,
    });
    expect(scored.fitScore).toBeGreaterThanOrEqual(75);
    expect(scored.intentScore).toBeLessThan(30);
    expect(scored.timingScore).toBeLessThan(25);
    expect(scored.whyNow.toLowerCase()).toMatch(/no recent intent|not supported/);
  });

  it('decays timing for stale signals', () => {
    const recent = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [
        {
          id: 's1',
          signalType: 'crm_migration',
          category: 'buying_trigger',
          title: 'CRM migration project posted',
          source: 'test',
          occurredAt: new Date('2026-09-01T12:00:00.000Z'),
          confidence: 0.9,
          relevance: 0.95,
        },
      ],
      now,
    });
    const stale = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [
        {
          id: 's2',
          signalType: 'crm_migration',
          category: 'buying_trigger',
          title: 'CRM migration project posted',
          source: 'test',
          occurredAt: new Date('2025-12-01T12:00:00.000Z'),
          confidence: 0.9,
          relevance: 0.95,
        },
      ],
      now,
    });
    expect(stale.timingScore).toBeLessThan(recent.timingScore);
    expect(stale.timingReasons.some(r => r.type === 'decay')).toBe(true);
  });

  it('keeps overall prioritization low for recent signal with bad fit', () => {
    const scored = assessWhyNow({
      brain,
      candidate: {
        companyName: 'Consumer Bazaar',
        industry: 'consumer marketplaces',
        companySize: '1-10',
        geography: 'Global',
        description: 'consumer marketplaces',
      },
      signals: [
        {
          id: 's1',
          signalType: 'funding',
          category: 'growth',
          title: 'Recent funding',
          source: 'test',
          occurredAt: new Date('2026-09-02T12:00:00.000Z'),
          confidence: 0.85,
          relevance: 0.4,
        },
      ],
      now,
    });
    expect(scored.fitScore).toBeLessThan(50);
    expect(scored.overallScore).toBeLessThan(55);
    expect(scored.whyNow.toLowerCase()).toMatch(/weak icp|disqualifier|limited icp/);
  });

  it('explains conflicting evidence and reduces confidence', () => {
    const scored = assessWhyNow({
      brain,
      candidate: strongCandidate,
      signals: [
        {
          id: 's1',
          signalType: 'crm_migration',
          category: 'buying_trigger',
          title: 'CRM evaluation',
          source: 'test',
          occurredAt: new Date('2026-08-31T12:00:00.000Z'),
          confidence: 0.8,
          relevance: 0.9,
        },
        {
          id: 's2',
          signalType: 'disqualifier_conflict',
          category: 'negative',
          title: 'Budget freeze',
          source: 'test',
          occurredAt: new Date('2026-09-03T12:00:00.000Z'),
          confidence: 0.7,
          relevance: 0.8,
        },
      ],
      now,
    });
    expect(scored.intentReasons.some(r => r.type === 'conflict')).toBe(true);
    expect(scored.confidence).toBeLessThan(0.85);
  });
});

describe('deterministic signal provider', () => {
  it('returns empty signals for no_signal fixture', async () => {
    const provider = new DeterministicProspectSignalProvider();
    const result = await provider.collect({
      companyName: 'Brightline',
      buyingTriggers: ['CRM migration'],
      fixture: 'no_signal',
    });
    expect(result.signals).toHaveLength(0);
  });

  it('returns recent CRM migration for strong_why_now', async () => {
    const provider = new DeterministicProspectSignalProvider();
    const now = new Date('2026-09-04T12:00:00.000Z');
    const result = await provider.collect({
      companyName: 'Northwind',
      buyingTriggers: ['CRM migration'],
      fixture: 'strong_why_now',
      now,
    });
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals[0].signalType).toBe('crm_migration');
  });
});
