import { mergeGeneratedPayload, mergeList, markListItemSuppressed } from './payload-merge';
import { CompanyBrainPayload } from './company-brain.types';

function basePayload(overrides: Partial<CompanyBrainPayload> = {}): CompanyBrainPayload {
  return {
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
    ...overrides,
  };
}

const evidence = [
  {
    sourceId: 'src_1',
    excerpt: 'evidence snippet',
    evidenceType: 'EXPLICIT' as const,
    confidence: 0.9,
  },
];

describe('mergeGeneratedPayload deletion / list overrides', () => {
  it('keeps a deleted persona suppressed across regenerations', () => {
    const persona = {
      id: 'persona_x',
      role: 'VP Sales',
      goals: [],
      pains: [],
      objections: [],
      evidence,
    };
    const generated = basePayload({ personas: [persona] });
    const current = basePayload({ personas: [] });
    const overrides = markListItemSuppressed({}, 'personas', 'persona_x');

    const first = mergeGeneratedPayload({ current, generated, overrides });
    expect(first.personas.map(p => p.id)).not.toContain('persona_x');

    const second = mergeGeneratedPayload({
      current: first,
      generated: basePayload({
        personas: [{ ...persona, role: 'VP Sales regenerated' }],
      }),
      overrides,
    });
    expect(second.personas.map(p => p.id)).not.toContain('persona_x');
  });

  it('keeps an edited persona sticky while allowing new generated personas', () => {
    const edited = {
      id: 'persona_x',
      role: 'Human VP RevOps',
      goals: [],
      pains: [],
      objections: [],
      evidence,
    };
    const generatedNew = {
      id: 'persona_new',
      role: 'Director Marketing',
      goals: [],
      pains: [],
      objections: [],
      evidence,
    };
    const merged = mergeGeneratedPayload({
      current: basePayload({ personas: [edited] }),
      generated: basePayload({
        personas: [{ ...edited, role: 'AI VP Sales' }, generatedNew],
      }),
      overrides: { personas: { items: { persona_x: true } } },
    });

    expect(merged.personas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'persona_x', role: 'Human VP RevOps' }),
        expect.objectContaining({ id: 'persona_new', role: 'Director Marketing' }),
      ]),
    );
    expect(merged.personas).toHaveLength(2);
  });

  it('whole-section persona replacement stays exactly human-controlled', () => {
    const humanOnly = {
      id: 'persona_human',
      role: 'Custom Buyer',
      goals: ['close deals'],
      pains: [],
      objections: [],
      evidence: [],
    };
    const merged = mergeGeneratedPayload({
      current: basePayload({ personas: [humanOnly] }),
      generated: basePayload({
        personas: [
          {
            id: 'persona_ai',
            role: 'VP Sales',
            goals: [],
            pains: [],
            objections: [],
            evidence,
          },
        ],
      }),
      overrides: {
        personas: {
          wholeSection: true,
          items: { persona_human: true },
          suppressedIds: { persona_ai: true },
        },
      },
    });

    expect(merged.personas).toEqual([humanOnly]);
  });

  it('suppresses deleted qualification rules on regeneration', () => {
    const rule = {
      id: 'rule_x',
      polarity: 'positive' as const,
      field: 'industry',
      operator: 'in' as const,
      value: ['SaaS'],
      evidence,
    };
    const merged = mergeGeneratedPayload({
      current: basePayload({ qualificationRules: [] }),
      generated: basePayload({ qualificationRules: [rule] }),
      overrides: {
        qualificationRules: { suppressedIds: { rule_x: true } },
      },
    });
    expect(merged.qualificationRules.map(r => r.id)).not.toContain('rule_x');
  });

  it.each([
    [
      'personas',
      'persona_del',
      (id: string) => ({
        id,
        role: 'Role',
        goals: [],
        pains: [],
        objections: [],
        evidence,
      }),
    ],
    [
      'painPoints',
      'pain_del',
      (id: string) => ({
        id,
        statement: 'Pain',
        evidence,
      }),
    ],
    [
      'competitors',
      'comp_del',
      (id: string) => ({
        id,
        name: 'Rival',
        certainty: 'supported' as const,
        evidence,
      }),
    ],
    [
      'qualificationRules',
      'rule_del',
      (id: string) => ({
        id,
        polarity: 'negative' as const,
        field: 'industry',
        operator: 'in' as const,
        value: ['consumer'],
        evidence,
      }),
    ],
  ] as const)('table: %s deletion stays suppressed', (section, id, factory) => {
    const item = factory(id);
    const merged = mergeList([], [item], {
      suppressedIds: { [id]: true },
    });
    expect(merged.map(x => x.id)).not.toContain(id);

    const whole = mergeList([], [item, factory(`${id}_other`)], { wholeSection: true });
    expect(whole).toEqual([]);
  });
});
