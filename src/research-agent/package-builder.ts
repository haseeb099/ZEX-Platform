import type { ProspectDiscoveryIcpInput } from '@src/prospect-discovery/prospect-discovery.types';
import {
  assertFindingProvenance,
  boundExcerpt,
  clamp01,
  daysBetween,
  normalizeSourceUrl,
} from './finding-utils';
import {
  OutreachContext,
  ProviderFinding,
  RESEARCH_AGENT_VERSION,
  ResearchPackage,
  researchPackageSchema,
} from './research-agent.types';

export type PersistedFindingView = {
  id: string;
  findingType: string;
  title: string;
  summary: string;
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidence: number;
  relevance: number;
  stale: boolean;
  personName: string | null;
  personRole: string | null;
  excerpt: string | null;
  occurredAt: Date | null;
  evidenceType: string;
};

export type PackageBuildInput = {
  companyName: string;
  industry?: string | null;
  description?: string | null;
  brain: ProspectDiscoveryIcpInput;
  findings: PersistedFindingView[];
  whyNowText: string | null;
  whyNowSnapshotId: string | null;
  buyerRoles: string[];
  now?: Date;
};

const UNSUPPORTED_PERSONALIZATION_PATTERNS = [
  /i saw your team recently/i,
  /congrats on your series\s*[a-z0-9]/i,
  /i noticed you migrated from salesforce/i,
];

export function sanitizeProviderFindings(
  raw: ProviderFinding[],
  now = new Date(),
): ProviderFinding[] {
  const out: ProviderFinding[] = [];
  for (const f of raw) {
    assertFindingProvenance(f);
    const stale =
      f.stale ||
      (f.occurredAt ? daysBetween(now, new Date(f.occurredAt)) > 180 : false) ||
      (f.publishedAt ? daysBetween(now, new Date(f.publishedAt)) > 180 : false);
    out.push({
      ...f,
      sourceUrl: normalizeSourceUrl(f.sourceUrl ?? null),
      excerpt: boundExcerpt(f.excerpt),
      stale,
      personName: f.personName?.trim() || null,
      personRole: f.personRole?.trim() || null,
    });
  }
  return out;
}

export function computeResearchConfidence(findings: PersistedFindingView[]): number {
  if (findings.length === 0) return 0.15;
  const avgConf = findings.reduce((s, f) => s + f.confidence, 0) / Math.max(1, findings.length);
  const avgRel = findings.reduce((s, f) => s + f.relevance, 0) / Math.max(1, findings.length);
  const sourceBonus = Math.min(0.25, findings.filter(f => f.sourceUrl).length * 0.05);
  const stalePenalty = findings.some(f => f.stale) ? 0.12 : 0;
  const conflictPenalty = hasConflict(findings) ? 0.18 : 0;
  const sparsePenalty = findings.length < 2 ? 0.15 : 0;
  return clamp01(
    0.25 +
      avgConf * 0.35 +
      avgRel * 0.2 +
      sourceBonus -
      stalePenalty -
      conflictPenalty -
      sparsePenalty,
  );
}

function hasConflict(findings: PersistedFindingView[]): boolean {
  const types = new Set(findings.map(f => f.findingType));
  return (
    types.has('OBJECTION_CONTEXT') &&
    (types.has('CRM_CHANGE') || types.has('HIRING') || types.has('FUNDING'))
  );
}

export function buildOutreachContext(input: {
  findings: PersistedFindingView[];
  buyerRoles: string[];
  companyName: string;
  confidence: number;
}): OutreachContext {
  const { findings, buyerRoles, companyName, confidence } = input;
  const evidencedClaims = findings.map(f => f.claim);
  const personalizationFacts = findings
    .filter(f => !f.stale && f.evidenceType === 'EXPLICIT')
    .slice(0, 5)
    .map(f => f.claim);

  for (const fact of personalizationFacts) {
    for (const re of UNSUPPORTED_PERSONALIZATION_PATTERNS) {
      if (
        re.test(fact) &&
        !evidencedClaims.some(
          c => c.toLowerCase().includes('series') || c.toLowerCase().includes('salesforce'),
        )
      ) {
        // Pattern phrases must not appear unless claim material supports them —
        // strip any hallucinated phrasing by rejecting these templates entirely.
        throw new Error(`Unsupported personalization phrase generated: ${fact}`);
      }
    }
  }

  const doNotClaim: string[] = [];
  if (!findings.some(f => f.findingType === 'FUNDING')) {
    doNotClaim.push('Do not congratulate on funding or Series rounds — no funding evidence.');
  }
  if (!findings.some(f => f.findingType === 'CRM_CHANGE')) {
    doNotClaim.push('Do not claim CRM migration/switching without evidence.');
  }
  if (!findings.some(f => f.personName)) {
    doNotClaim.push('Do not address a named contact — no source-backed person identified.');
  }
  if (findings.length === 0) {
    doNotClaim.push('Do not invent recent company activity or personalization hooks.');
    doNotClaim.push(`Do not claim firsthand observation of ${companyName} without evidence.`);
  }
  if (findings.some(f => f.stale)) {
    doNotClaim.push('Do not present stale findings as recent events.');
  }
  if (confidence < 0.45) {
    doNotClaim.push('Do not overstate research certainty — evidence is sparse or conflicting.');
  }
  if (hasConflict(findings)) {
    doNotClaim.push('Acknowledge conflicting signals; do not pick only the positive narrative.');
  }

  const primaryAngle =
    findings.find(f => f.findingType === 'OUTREACH_HOOK' || f.findingType === 'CRM_CHANGE')
      ?.claim ||
    findings.find(f => f.findingType === 'ICP_RELEVANCE')?.claim ||
    (findings[0]?.claim ??
      `Limited evidence on ${companyName}; lead with verified ICP fit rather than unverified events.`);

  const supportingPoints = findings
    .filter(f => f.findingType !== 'OBJECTION_CONTEXT')
    .slice(0, 4)
    .map(f => f.claim);

  const risks = findings
    .filter(f => f.findingType === 'OBJECTION_CONTEXT' || f.stale)
    .map(f => (f.stale ? `Stale evidence: ${f.claim}` : f.claim));

  if (findings.length === 0) {
    risks.push('No external research findings available.');
  }

  return {
    primaryAngle,
    supportingPoints,
    personalizationFacts,
    risks,
    doNotClaim,
    suggestedBuyerRoles: buyerRoles.slice(0, 8),
  };
}

export function buildResearchPackage(input: PackageBuildInput): ResearchPackage {
  const findings = [...input.findings].sort(
    (a, b) => b.confidence * b.relevance - a.confidence * a.relevance,
  );
  const confidence = computeResearchConfidence(findings);
  const keyFindings = findings.slice(0, 8).map(f => ({
    id: f.id,
    findingType: f.findingType,
    title: f.title,
    summary: f.summary,
    claim: f.claim,
    sourceUrl: f.sourceUrl,
    sourceTitle: f.sourceTitle,
    confidence: f.confidence,
    stale: f.stale,
    personName: f.personName,
    personRole: f.personRole,
  }));

  const overview = findings.find(f => f.findingType === 'COMPANY_OVERVIEW');
  const companySummary =
    overview?.summary ||
    input.description ||
    `${input.companyName} — limited public overview available from research.`;

  const useCases = input.brain.icp.useCases?.slice(0, 3).join(', ') || 'ICP use cases';
  const industries = input.brain.icp.industries?.slice(0, 3).join(', ') || 'target industries';
  const whyRelevant = findings.find(f => f.findingType === 'ICP_RELEVANCE')?.summary
    ? findings.find(f => f.findingType === 'ICP_RELEVANCE')!.summary
    : input.industry
      ? `${input.companyName} (${input.industry}) maps to Company Brain focus on ${industries} / ${useCases}.`
      : `Relevance to Company Brain ICP (${industries}) is inferred from discovery fit; research evidence is limited.`;

  const whyNow =
    input.whyNowText ||
    'No Why-Now snapshot available — do not invent urgency from research alone.';

  const namedPeople = findings
    .filter(f => f.personName)
    .map(f => ({
      name: f.personName!,
      role: f.personRole,
      sourceUrl: f.sourceUrl,
      findingId: f.id,
    }));

  const risksObjections = findings
    .filter(f => f.findingType === 'OBJECTION_CONTEXT' || f.stale)
    .map(f => (f.stale ? `[Stale] ${f.claim}` : f.claim));
  if (findings.length === 0) {
    risksObjections.push('Research returned no usable external findings.');
  }

  const outreachContext = buildOutreachContext({
    findings,
    buyerRoles: input.buyerRoles,
    companyName: input.companyName,
    confidence,
  });

  // Guard: outreach must not invent unsupported personalization templates
  const packageText = JSON.stringify(outreachContext).toLowerCase();
  for (const re of UNSUPPORTED_PERSONALIZATION_PATTERNS) {
    if (re.test(packageText)) {
      const supported = findings.some(f => re.test(f.claim) || re.test(f.summary));
      if (!supported) {
        throw new Error('Outreach context contains unsupported personalization phrasing');
      }
    }
  }

  return researchPackageSchema.parse({
    companySummary,
    whyRelevant,
    whyNow,
    whyNowSnapshotId: input.whyNowSnapshotId,
    keyFindings,
    buyingCommitteeContext: {
      likelyRoles: input.buyerRoles,
      namedPeople,
    },
    risksObjections,
    outreachContext,
    confidence,
    researchVersion: RESEARCH_AGENT_VERSION,
    findingIds: findings.map(f => f.id),
  });
}
