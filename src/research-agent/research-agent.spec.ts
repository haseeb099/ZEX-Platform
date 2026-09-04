import {
  buildFindingDedupeKey,
  normalizeSourceUrl,
  assertFindingProvenance,
} from './finding-utils';
import {
  buildOutreachContext,
  buildResearchPackage,
  computeResearchConfidence,
  sanitizeProviderFindings,
} from './package-builder';
import { RESEARCHABLE_STATUSES } from './research-agent.types';
import { DeterministicProspectResearchProvider } from './providers/deterministic.provider';

const brain = {
  companyName: 'ZEX',
  icp: {
    industries: ['SaaS'],
    companySize: ['11-50'],
    geography: ['US', 'UK'],
    useCases: ['lead enrichment'],
    buyingTriggers: ['CRM migration'],
    disqualifiers: ['consumer marketplaces'],
  },
  personas: [{ id: 'p1', role: 'VP Sales' }],
  qualificationRules: [],
};

describe('research finding utils', () => {
  it('normalizes source URLs', () => {
    expect(normalizeSourceUrl('https://WWW.Example.com/path/')).toBe(
      'https://www.example.com/path',
    );
    expect(normalizeSourceUrl('ftp://x')).toBeNull();
    expect(normalizeSourceUrl('not-a-url')).toBeNull();
  });

  it('builds stable dedupe keys', () => {
    const a = buildFindingDedupeKey({
      prospectCandidateId: 'c1',
      findingType: 'CRM_CHANGE',
      claim: 'CRM migration project',
      sourceUrl: 'https://example.com/a/',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    const b = buildFindingDedupeKey({
      prospectCandidateId: 'c1',
      findingType: 'CRM_CHANGE',
      claim: '  CRM migration project ',
      sourceUrl: 'https://example.com/a',
      occurredAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    expect(a).toBe(b);
  });

  it('rejects findings without provenance', () => {
    expect(() =>
      assertFindingProvenance({
        findingType: 'PRODUCT',
        title: 'x',
        summary: 'y',
        claim: 'z',
        confidence: 0.5,
        relevance: 0.5,
        evidenceType: 'EXPLICIT',
      }),
    ).toThrow(/provenance/);
  });

  it('rejects named people not evidenced in text', () => {
    expect(() =>
      assertFindingProvenance({
        findingType: 'LEADERSHIP',
        title: 'Leader',
        summary: 'Someone leads sales',
        claim: 'A leader exists',
        excerpt: 'Someone leads sales',
        sourceUrl: 'https://example.com/team',
        confidence: 0.8,
        relevance: 0.8,
        evidenceType: 'EXPLICIT',
        personName: 'Alex Fake',
      }),
    ).toThrow(/Named person/);
  });
});

describe('research package builder', () => {
  it('computes lower confidence for sparse/no findings', () => {
    expect(computeResearchConfidence([])).toBeLessThan(0.3);
    expect(
      computeResearchConfidence([
        {
          id: '1',
          findingType: 'COMPANY_OVERVIEW',
          title: 'o',
          summary: 's',
          claim: 'c',
          sourceUrl: null,
          sourceTitle: null,
          confidence: 0.5,
          relevance: 0.5,
          stale: false,
          personName: null,
          personRole: null,
          excerpt: 'e',
          occurredAt: null,
          evidenceType: 'EXPLICIT',
        },
      ]),
    ).toBeLessThan(0.7);
  });

  it('reduces confidence on conflict + builds doNotClaim', () => {
    const findings = [
      {
        id: '1',
        findingType: 'CRM_CHANGE',
        title: 'CRM',
        summary: 'Evaluating CRM',
        claim: 'Evaluating CRM tooling',
        sourceUrl: 'https://example.com/a',
        sourceTitle: 'a',
        confidence: 0.8,
        relevance: 0.8,
        stale: false,
        personName: null,
        personRole: null,
        excerpt: 'CRM',
        occurredAt: new Date(),
        evidenceType: 'EXPLICIT',
      },
      {
        id: '2',
        findingType: 'OBJECTION_CONTEXT',
        title: 'Freeze',
        summary: 'Budget freeze',
        claim: 'Budget freeze announced',
        sourceUrl: 'https://example.com/b',
        sourceTitle: 'b',
        confidence: 0.8,
        relevance: 0.8,
        stale: false,
        personName: null,
        personRole: null,
        excerpt: 'freeze',
        occurredAt: new Date(),
        evidenceType: 'EXPLICIT',
      },
    ];
    const conf = computeResearchConfidence(findings);
    const outreach = buildOutreachContext({
      findings,
      buyerRoles: ['VP Sales'],
      companyName: 'Acme',
      confidence: conf,
    });
    expect(outreach.doNotClaim.some(d => /conflict/i.test(d))).toBe(true);
    expect(outreach.doNotClaim.some(d => /funding/i.test(d))).toBe(true);
    expect(outreach.personalizationFacts.every(f => findings.some(x => x.claim === f))).toBe(true);
  });

  it('marks stale findings and avoids inventing urgency', () => {
    const stale = sanitizeProviderFindings([
      {
        findingType: 'CRM_CHANGE',
        title: 'Old CRM',
        summary: 'Old migration',
        claim: 'Migrated CRM years ago',
        sourceUrl: 'https://example.com/old',
        sourceTitle: 'Archive',
        excerpt: 'CRM migration',
        occurredAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
        confidence: 0.7,
        relevance: 0.6,
        evidenceType: 'EXPLICIT',
        stale: true,
      },
    ]);
    expect(stale[0].stale).toBe(true);
    const pkg = buildResearchPackage({
      companyName: 'Acme',
      brain,
      findings: stale.map((f, i) => ({
        id: `f${i}`,
        findingType: f.findingType,
        title: f.title,
        summary: f.summary,
        claim: f.claim,
        sourceUrl: f.sourceUrl ?? null,
        sourceTitle: f.sourceTitle ?? null,
        confidence: f.confidence,
        relevance: f.relevance,
        stale: f.stale ?? false,
        personName: null,
        personRole: null,
        excerpt: f.excerpt ?? null,
        occurredAt: f.occurredAt ? new Date(f.occurredAt) : null,
        evidenceType: f.evidenceType,
      })),
      whyNowText: null,
      whyNowSnapshotId: null,
      buyerRoles: ['VP Sales'],
    });
    expect(pkg.outreachContext.doNotClaim.some(d => /stale/i.test(d))).toBe(true);
    expect(pkg.whyNow).toMatch(/No Why-Now/);
  });

  it('does not invent unsupported personalization for empty research', () => {
    const pkg = buildResearchPackage({
      companyName: 'Acme',
      brain,
      findings: [],
      whyNowText: 'Strong ICP fit. No recent intent signals.',
      whyNowSnapshotId: 'snap1',
      buyerRoles: ['VP Sales', 'Head of RevOps'],
    });
    expect(pkg.outreachContext.personalizationFacts).toEqual([]);
    expect(pkg.outreachContext.doNotClaim.length).toBeGreaterThan(0);
    expect(JSON.stringify(pkg).toLowerCase()).not.toMatch(/congrats on your series/);
    expect(JSON.stringify(pkg).toLowerCase()).not.toMatch(/i saw your team recently/);
    expect(pkg.buyingCommitteeContext.namedPeople).toEqual([]);
  });

  it('includes named people only from evidenced findings', () => {
    const pkg = buildResearchPackage({
      companyName: 'Acme',
      brain,
      findings: [
        {
          id: '1',
          findingType: 'LEADERSHIP',
          title: 'VP',
          summary: 'Jordan Lee — VP Sales',
          claim: 'Jordan Lee is VP Sales',
          sourceUrl: 'https://example.com/team',
          sourceTitle: 'Team',
          confidence: 0.9,
          relevance: 0.8,
          stale: false,
          personName: 'Jordan Lee',
          personRole: 'VP Sales',
          excerpt: 'Jordan Lee — VP Sales',
          occurredAt: null,
          evidenceType: 'EXPLICIT',
        },
      ],
      whyNowText: 'why',
      whyNowSnapshotId: 's1',
      buyerRoles: ['VP Sales'],
    });
    expect(pkg.buyingCommitteeContext.namedPeople).toEqual([
      expect.objectContaining({ name: 'Jordan Lee', role: 'VP Sales' }),
    ]);
  });
});

describe('deterministic research provider', () => {
  const provider = new DeterministicProspectResearchProvider();

  it('returns strong source-backed findings', async () => {
    const result = await provider.research({
      companyName: 'Northwind',
      domain: 'northwind.test',
      fixture: 'strong_research',
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(5);
    expect(result.findings.some(f => f.findingType === 'CRM_CHANGE')).toBe(true);
    expect(result.findings.some(f => f.personName === 'Jordan Lee')).toBe(true);
  });

  it('returns empty findings for no_research', async () => {
    const result = await provider.research({
      companyName: 'Ghost',
      fixture: 'no_research',
    });
    expect(result.findings).toEqual([]);
  });

  it('throws for provider_failure fixture', async () => {
    await expect(
      provider.research({ companyName: 'X', fixture: 'provider_failure' }),
    ).rejects.toThrow(/failure/);
  });
});

describe('approval gate constants', () => {
  it('allows only APPROVED and CREATED', () => {
    expect(RESEARCHABLE_STATUSES).toEqual(['APPROVED', 'CREATED']);
  });
});
