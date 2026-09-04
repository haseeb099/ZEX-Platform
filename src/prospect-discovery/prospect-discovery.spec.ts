import { normalizeCompanyName, normalizeDomain } from './domain-normalize';
import { dedupeCompanyAgainstCrm } from './company-dedupe';
import { assessIcpFit } from './fit-scoring';
import { mapBuyerRolesFromPersonas } from './buyer-role-mapper';
import { DeterministicProspectDiscoveryProvider } from './providers/deterministic.provider';

describe('domain-normalize', () => {
  it('normalizes domains from URLs', () => {
    expect(normalizeDomain('https://WWW.Acme.Example/path?x=1')).toBe('acme.example');
    expect(normalizeDomain('acme.example.')).toBe('acme.example');
  });

  it('normalizes company names', () => {
    expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
    expect(normalizeCompanyName('Acme LLC')).toBe('acme');
  });
});

describe('company-dedupe', () => {
  const crm = [
    {
      id: 'co_1',
      name: 'Acme Duplicate Co',
      domain: 'acme-duplicate.example',
      websiteUrl: 'https://acme-duplicate.example',
    },
  ];

  it('exact domain match', () => {
    const result = dedupeCompanyAgainstCrm({
      companyName: 'Other Name',
      domain: 'acme-duplicate.example',
      crmCompanies: crm,
    });
    expect(result.status).toBe('EXACT_MATCH');
    expect(result.existingTwentyCompanyId).toBe('co_1');
  });

  it('possible name match when domain differs', () => {
    const result = dedupeCompanyAgainstCrm({
      companyName: 'Acme Duplicate Co',
      domain: 'different.example',
      crmCompanies: crm,
    });
    expect(result.status).toBe('POSSIBLE_MATCH');
  });

  it('new when no match', () => {
    const result = dedupeCompanyAgainstCrm({
      companyName: 'Brightline Ops',
      domain: 'brightline.example',
      crmCompanies: crm,
    });
    expect(result.status).toBe('NEW');
  });
});

describe('fit-scoring', () => {
  const brain = {
    companyName: 'ZEX',
    icp: {
      industries: ['SaaS'],
      companySize: ['11-50'],
      geography: ['US'],
      useCases: [],
      buyingTriggers: [],
      disqualifiers: ['consumer'],
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
      {
        id: 'r2',
        polarity: 'negative' as const,
        field: 'industry',
        operator: 'contains',
        value: 'consumer',
        label: 'No consumer',
      },
    ],
  };

  it('scores strong ICP match', () => {
    const fit = assessIcpFit(brain, {
      industry: 'SaaS',
      companySize: '11-50',
      geography: 'US',
    });
    expect(fit.fitScore).toBeGreaterThanOrEqual(75);
    expect(fit.fitBand).toBe('strong');
    expect(fit.fitReasons.some(r => r.type === 'positive')).toBe(true);
  });

  it('disqualifies consumer industry', () => {
    const fit = assessIcpFit(brain, { industry: 'consumer marketplaces' });
    expect(fit.fitBand).toBe('disqualified');
    expect(fit.disqualifiers.length).toBeGreaterThan(0);
  });
});

describe('buyer-role-mapper + deterministic provider', () => {
  it('maps personas to buyer roles with evidence', () => {
    const roles = mapBuyerRolesFromPersonas(
      {
        companyName: 'ZEX',
        icp: {
          industries: [],
          companySize: [],
          geography: [],
          useCases: [],
          buyingTriggers: [],
          disqualifiers: [],
        },
        personas: [{ id: 'persona_1', role: 'VP Sales', buyingInfluence: 'champion' }],
        qualificationRules: [],
      },
      { companyName: 'Northwind', providerKey: 'k1' },
    );
    expect(roles[0].matchedCompanyBrainPersonaId).toBe('persona_1');
    expect(roles[0].evidence[0].source).toBe('company-brain-persona');
  });

  it('returns strong, disqualified, duplicate, and new candidates', async () => {
    const provider = new DeterministicProspectDiscoveryProvider();
    const result = await provider.discover({
      companyName: 'ZEX',
      icp: {
        industries: ['SaaS'],
        companySize: ['11-50'],
        geography: ['US'],
        useCases: [],
        buyingTriggers: [],
        disqualifiers: ['consumer'],
      },
      personas: [{ id: 'persona_1', role: 'VP Sales' }],
      qualificationRules: [],
    });
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map(c => c.providerKey)).toEqual(
      expect.arrayContaining([
        'det_strong_fit',
        'det_disqualified',
        'det_crm_duplicate',
        'det_new_valid',
      ]),
    );
    expect(result.candidates[0].buyerRoles.length).toBeGreaterThan(0);
  });
});
