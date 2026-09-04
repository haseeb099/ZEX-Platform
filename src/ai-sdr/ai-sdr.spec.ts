import { generateDraftContent, hashDraftContent } from './draft-generator';

describe('AI SDR draft generator', () => {
  it('hashes content stably', () => {
    const a = hashDraftContent({
      channel: 'email',
      subject: 'Hi',
      body: 'Body',
      purpose: 'outreach',
    });
    const b = hashDraftContent({
      channel: 'email',
      subject: 'Hi',
      body: 'Body',
      purpose: 'outreach',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('grounds personalization in provided facts only', () => {
    const draft = generateDraftContent({
      companyName: 'Acme',
      purpose: 'outreach',
      personalizationFacts: ['Acme is running a CRM migration project'],
      doNotClaim: ['Do not congratulate on funding or Series rounds — no funding evidence.'],
      findingIds: ['f1'],
      buyerRoles: ['VP Sales'],
      namedPerson: { name: 'Jordan Lee', role: 'VP Sales' },
      whyNow: 'CRM migration makes outreach timely',
    });
    expect(draft.body).toContain('CRM migration');
    expect(draft.grounding.personalizationFacts).toEqual([
      'Acme is running a CRM migration project',
    ]);
    expect(draft.doNotClaimApplied.some(d => /funding/i.test(d))).toBe(true);
    expect(JSON.stringify(draft).toLowerCase()).not.toMatch(/congrats on your series/);
    expect(JSON.stringify(draft).toLowerCase()).not.toMatch(/i saw your team recently/);
  });

  it('blocks unsupported personalization phrases in facts', () => {
    expect(() =>
      generateDraftContent({
        companyName: 'Acme',
        purpose: 'outreach',
        personalizationFacts: ['I saw your team recently hiring'],
        doNotClaim: [],
        findingIds: [],
        buyerRoles: [],
      }),
    ).toThrow(/Unsupported personalization/);
  });

  it('does not invent funding personalization when doNotClaim forbids it', () => {
    const draft = generateDraftContent({
      companyName: 'Acme',
      purpose: 'outreach',
      personalizationFacts: [],
      doNotClaim: [
        'Do not congratulate on funding or Series rounds — no funding evidence.',
        'Do not claim CRM migration/switching without evidence.',
      ],
      findingIds: [],
      buyerRoles: ['VP Sales'],
    });
    expect(JSON.stringify(draft).toLowerCase()).not.toMatch(/congrats on your series/);
    expect(JSON.stringify(draft).toLowerCase()).not.toMatch(/migrated from salesforce/);
    expect(draft.doNotClaimApplied.length).toBeGreaterThanOrEqual(2);
  });

  it('creates meeting draft with booking link', () => {
    const draft = generateDraftContent({
      companyName: 'Acme',
      purpose: 'meeting',
      personalizationFacts: [],
      doNotClaim: [],
      findingIds: [],
      buyerRoles: ['VP Sales'],
      bookingLink: 'https://book.example.test/x',
    });
    expect(draft.body).toContain('https://book.example.test/x');
    expect(draft.purpose).toBe('meeting');
  });
});
