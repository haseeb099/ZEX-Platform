import { companyBrainPayloadSchema } from './company-brain.types';
import { mergeGeneratedPayload } from './payload-merge';
import { DeterministicCompanyBrainAnalyzer } from './providers/deterministic.analyzer';

describe('company-brain analyzer + merge', () => {
  const analyzer = new DeterministicCompanyBrainAnalyzer();

  it('produces validated payload with evidence for all major sections', async () => {
    const payload = await analyzer.analyze({
      companyName: 'Acme',
      websiteUrl: 'https://acme.example',
      sources: [
        {
          id: 'src_1',
          sourceType: 'PASTED_TEXT',
          sourceUrl: null,
          title: 'Notes',
          text: `
Acme is a B2B SaaS platform.
Industry: SaaS, Fintech
Company size: 50-200
Geography: US, UK
Use cases: pipeline automation, enrichment
Buying triggers: new CRM rollout
Disqualifiers: consumer apps
Persona: VP Sales
Pain points: manual lead research
Competitors: CompetitorX, CompetitorY
Value propositions: save hours, better targeting
Differentiators: evidence-backed scoring
Objections: switching cost
Proof points: 3x productivity
Messaging themes: clarity, speed
          `,
        },
      ],
    });

    const parsed = companyBrainPayloadSchema.parse(payload);
    expect(parsed.icp.industries.length).toBeGreaterThan(0);
    expect(parsed.icp.evidence.length).toBeGreaterThan(0);
    expect(parsed.personas[0]?.evidence[0]?.sourceId).toBe('src_1');
    expect(parsed.painPoints[0]?.evidence.length).toBeGreaterThan(0);
    expect(parsed.competitors.map(c => c.name)).toEqual(
      expect.arrayContaining(['CompetitorX', 'CompetitorY']),
    );
    expect(parsed.competitors.every(c => c.certainty === 'supported')).toBe(true);
    expect(parsed.qualificationRules.some(r => r.polarity === 'positive')).toBe(true);
    expect(parsed.qualificationRules.some(r => r.polarity === 'negative')).toBe(true);
    expect(parsed.messagingSummary.oneLiner).toBeTruthy();
    expect(parsed.messagingSummary.evidence.length).toBeGreaterThan(0);
    expect(parsed.messagingSummary.evidence[0].excerpt.length).toBeLessThanOrEqual(500);
  });

  it('does not invent competitors when sources omit them', async () => {
    const payload = await analyzer.analyze({
      companyName: 'QuietCo',
      sources: [
        {
          id: 'src_2',
          sourceType: 'DOCUMENT_TEXT',
          sourceUrl: null,
          title: 'Doc',
          text: 'QuietCo helps ops teams. Industry: Healthcare. Persona: Director of Ops.',
        },
      ],
    });
    expect(payload.competitors).toEqual([]);
  });

  it('preserves human overrides on regeneration', async () => {
    const generated1 = await analyzer.analyze({
      companyName: 'Acme',
      sources: [
        {
          id: 'src_1',
          sourceType: 'PASTED_TEXT',
          sourceUrl: null,
          title: null,
          text: 'Industry: SaaS\nPersona: VP Sales\nPain points: slow research\nCompetitors: OldRival',
        },
      ],
    });

    const humanEdited = {
      ...generated1,
      icp: { ...generated1.icp, industries: ['Human Industry'] },
      messagingSummary: {
        ...generated1.messagingSummary,
        oneLiner: 'Human one-liner',
      },
    };

    const generated2 = await analyzer.analyze({
      companyName: 'Acme',
      sources: [
        {
          id: 'src_1',
          sourceType: 'PASTED_TEXT',
          sourceUrl: null,
          title: null,
          text: 'Industry: Fintech\nPersona: VP Sales\nPain points: slow research\nCompetitors: NewRival',
        },
      ],
    });

    const merged = mergeGeneratedPayload({
      current: humanEdited,
      generated: generated2,
      overrides: { icp: true, messagingSummary: true },
    });

    expect(merged.icp.industries).toEqual(['Human Industry']);
    expect(merged.messagingSummary.oneLiner).toBe('Human one-liner');
    expect(merged.competitors.map(c => c.name)).toContain('NewRival');
  });

  it('preserves individual persona overrides by id', async () => {
    const generated = await analyzer.analyze({
      companyName: 'Acme',
      sources: [
        {
          id: 'src_1',
          sourceType: 'PASTED_TEXT',
          sourceUrl: null,
          title: null,
          text: 'Persona: VP Sales\nIndustry: SaaS',
        },
      ],
    });
    const personaId = generated.personas[0].id;
    const current = {
      ...generated,
      personas: [{ ...generated.personas[0], role: 'Human VP RevOps' }],
    };
    const regenerated = {
      ...generated,
      personas: [{ ...generated.personas[0], role: 'AI VP Sales' }],
    };
    const merged = mergeGeneratedPayload({
      current,
      generated: regenerated,
      overrides: { personas: { [personaId]: true } },
    });
    expect(merged.personas[0].role).toBe('Human VP RevOps');
  });
});
