import { FitAssessment, FitReason, ProspectDiscoveryIcpInput } from './prospect-discovery.types';

type CandidateSignals = {
  industry?: string | null;
  companySize?: string | null;
  geography?: string | null;
  description?: string | null;
  companyName?: string | null;
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(haystack: string | null | undefined, needles: string[]): boolean {
  if (!haystack || !needles.length) return false;
  const h = normalizeToken(haystack);
  return needles.some(n => h.includes(normalizeToken(n)));
}

function fieldValue(candidate: CandidateSignals, field: string): string | null {
  switch (field) {
    case 'industry':
      return candidate.industry ?? null;
    case 'companySize':
    case 'employeeCount':
      return candidate.companySize ?? null;
    case 'geography':
    case 'location':
      return candidate.geography ?? null;
    case 'description':
      return candidate.description ?? null;
    case 'companyName':
    case 'name':
      return candidate.companyName ?? null;
    default:
      return null;
  }
}

function ruleMatches(
  operator: string,
  actual: string | null,
  expected: string | number | boolean | string[],
): boolean {
  const a = actual ? normalizeToken(actual) : '';
  if (operator === 'exists') return Boolean(a);
  if (expected === undefined || expected === null) return false;

  if (Array.isArray(expected)) {
    const values = expected.map(v => normalizeToken(String(v)));
    if (operator === 'in') return values.some(v => a.includes(v) || v.includes(a));
    if (operator === 'not_in') return !values.some(v => a.includes(v) || v.includes(a));
  }

  const e = normalizeToken(String(expected));
  switch (operator) {
    case 'eq':
      return a === e;
    case 'neq':
      return a !== e;
    case 'contains':
      return a.includes(e);
    case 'gte':
      return Number(a) >= Number(e);
    case 'lte':
      return Number(a) <= Number(e);
    default:
      return false;
  }
}

/**
 * Explainable ICP-fit assessment (not Why-Now).
 * Uses Company Brain ICP + qualification rules against candidate signals.
 */
export function assessIcpFit(
  brain: ProspectDiscoveryIcpInput,
  candidate: CandidateSignals,
): FitAssessment {
  const reasons: FitReason[] = [];
  const disqualifiers: string[] = [];
  let score = 40;

  const icp = brain.icp;

  if (includesAny(candidate.industry, icp.industries)) {
    score += 20;
    reasons.push({
      type: 'positive',
      label: 'Industry matches ICP',
      detail: candidate.industry ?? undefined,
      field: 'industry',
    });
  } else if (icp.industries.length) {
    score -= 10;
    reasons.push({
      type: 'negative',
      label: 'Industry not in ICP list',
      detail: candidate.industry ?? 'unknown',
      field: 'industry',
    });
  }

  if (includesAny(candidate.companySize, icp.companySize)) {
    score += 15;
    reasons.push({
      type: 'positive',
      label: 'Company size matches ICP',
      field: 'companySize',
    });
  }

  if (includesAny(candidate.geography, icp.geography)) {
    score += 10;
    reasons.push({
      type: 'positive',
      label: 'Geography matches ICP',
      field: 'geography',
    });
  }

  for (const d of icp.disqualifiers) {
    if (
      includesAny(candidate.industry, [d]) ||
      includesAny(candidate.description, [d]) ||
      includesAny(candidate.companyName, [d])
    ) {
      disqualifiers.push(d);
      score -= 40;
      reasons.push({
        type: 'negative',
        label: `ICP disqualifier: ${d}`,
        field: 'disqualifier',
      });
    }
  }

  for (const rule of brain.qualificationRules) {
    const actual = fieldValue(candidate, rule.field);
    const matched = ruleMatches(rule.operator, actual, rule.value);
    if (!matched) continue;

    if (rule.polarity === 'positive') {
      score += 8;
      reasons.push({
        type: 'rule',
        label: rule.label || `Positive rule ${rule.field}`,
        ruleId: rule.id,
        field: rule.field,
      });
    } else {
      score -= 25;
      disqualifiers.push(rule.label || rule.field);
      reasons.push({
        type: 'rule',
        label: rule.label || `Negative rule ${rule.field}`,
        ruleId: rule.id,
        field: rule.field,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));

  let fitBand: FitAssessment['fitBand'] = 'unknown';
  if (disqualifiers.length) fitBand = 'disqualified';
  else if (score >= 75) fitBand = 'strong';
  else if (score >= 55) fitBand = 'moderate';
  else fitBand = 'weak';

  return { fitScore: score, fitBand, fitReasons: reasons, disqualifiers };
}
