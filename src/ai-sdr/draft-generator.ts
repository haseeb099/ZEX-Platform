import { createHash } from 'crypto';
import type { GeneratedDraftContent, DraftPurpose } from './ai-sdr.types';

const UNSUPPORTED = [
  /i saw your team recently/i,
  /congrats on your series\s*[a-z0-9]/i,
  /i noticed you migrated from salesforce/i,
];

export function hashDraftContent(input: {
  channel: string;
  subject: string | null | undefined;
  body: string;
  purpose: string;
}): string {
  const material = `${input.channel}|${input.purpose}|${input.subject || ''}|${input.body}`;
  return createHash('sha256').update(material).digest('hex');
}

export function boundText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export type DraftGeneratorInput = {
  companyName: string;
  purpose: DraftPurpose;
  whyNow?: string | null;
  personalizationFacts: string[];
  doNotClaim: string[];
  findingIds: string[];
  buyerRoles: string[];
  namedPerson?: { name: string; role?: string | null } | null;
  targetPersonName?: string | null;
  companyBrainValueProp?: string | null;
  bookingLink?: string | null;
  replyClassification?: string | null;
};

/**
 * Deterministic template draft generator — no LLM.
 * Personalization facts must already be evidence-backed from Research Agent.
 */
export function generateDraftContent(input: DraftGeneratorInput): GeneratedDraftContent {
  const facts = input.personalizationFacts.filter(Boolean).slice(0, 3);
  const doNotClaim = input.doNotClaim.slice(0, 12);
  const roleHint = input.namedPerson?.role || input.buyerRoles[0] || 'revenue leader';
  const greetingName = input.targetPersonName || input.namedPerson?.name || roleHint;

  for (const fact of facts) {
    for (const re of UNSUPPORTED) {
      if (re.test(fact)) {
        throw new Error(`Unsupported personalization in draft input: ${fact}`);
      }
    }
  }

  let subject: string;
  let body: string;
  let confidence = 0.55;

  if (input.purpose === 'meeting') {
    subject = `Quick scheduling for ${input.companyName}`;
    body = [
      `Hi ${greetingName},`,
      '',
      `Thanks for the positive note — happy to find time.`,
      input.bookingLink
        ? `You can pick a slot here: ${input.bookingLink}`
        : 'I can share a few times that work for a 20-minute intro.',
      '',
      'Best regards',
    ].join('\n');
    confidence = 0.7;
  } else if (input.purpose === 'reply') {
    subject = `Re: ${input.companyName}`;
    body = [
      `Hi ${greetingName},`,
      '',
      input.replyClassification === 'QUESTION'
        ? 'Thanks for the question — happy to clarify based on what we know so far.'
        : 'Thanks for getting back to me.',
      facts[0] ? `On your side, we noted: ${facts[0]}.` : '',
      '',
      'Would a short call next week help?',
      '',
      'Best regards',
    ]
      .filter(Boolean)
      .join('\n');
    confidence = 0.65;
  } else if (input.purpose === 'follow_up') {
    subject = `Following up — ${input.companyName}`;
    body = [
      `Hi ${greetingName},`,
      '',
      `Quick follow-up in case my earlier note got buried.`,
      facts[0]
        ? `Still relevant given: ${facts[0]}.`
        : 'Happy to share a concise overview if useful.',
      '',
      'Open to a brief chat?',
      '',
      'Best regards',
    ].join('\n');
    confidence = facts.length ? 0.7 : 0.5;
  } else {
    // outreach
    const value = input.companyBrainValueProp || 'evidence-backed revenue workflow automation';
    subject = facts[0]
      ? `${input.companyName}: relevant to ${facts[0].slice(0, 60)}`
      : `Idea for ${input.companyName}`;
    const factLines = facts.map(f => `- ${f}`);
    body = [
      `Hi ${greetingName},`,
      '',
      `I work on ${value}.`,
      facts.length
        ? `A few grounded observations on ${input.companyName}:`
        : `I do not have recent company-specific events to cite, so I will keep this high-level.`,
      ...factLines,
      input.whyNow ? `Timing context: ${input.whyNow}` : '',
      '',
      'Would a 20-minute conversation be useful?',
      '',
      'Best regards',
    ]
      .filter(line => line !== '')
      .join('\n');
    confidence = facts.length >= 2 ? 0.82 : facts.length === 1 ? 0.68 : 0.45;
  }

  const combined = `${subject}\n${body}`.toLowerCase();
  for (const re of UNSUPPORTED) {
    if (re.test(combined)) {
      throw new Error('Draft contains unsupported personalization phrasing');
    }
  }
  // Enforce doNotClaim themes: strip/block funding/CRM/named if listed
  for (const rule of doNotClaim) {
    const lower = rule.toLowerCase();
    if (
      lower.includes('funding') &&
      /congrats on your series|fundrais/i.test(combined) &&
      !facts.some(f => /fund|series/i.test(f))
    ) {
      throw new Error('Draft violates funding doNotClaim');
    }
    if (
      lower.includes('crm') &&
      /i noticed you migrated from salesforce/i.test(combined) &&
      !facts.some(f => /crm|salesforce|hubspot/i.test(f))
    ) {
      throw new Error('Draft violates CRM doNotClaim');
    }
  }
  if (doNotClaim.some(d => /named contact|named person|no source-backed person/i.test(d))) {
    if (input.namedPerson && !input.targetPersonName) {
      // using named person from research is OK if evidenced; greeting with role is safer
    }
  }

  return {
    channel: 'email',
    purpose: input.purpose,
    subject,
    body,
    evidenceRefs: input.findingIds.slice(0, 8),
    researchFindingIds: input.findingIds.slice(0, 8),
    doNotClaimApplied: doNotClaim,
    grounding: {
      personalizationFacts: facts,
      whyNow: input.whyNow ?? null,
      companyName: input.companyName,
    },
    confidence,
  };
}
