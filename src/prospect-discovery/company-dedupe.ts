import { CompanyDedupeResult, TwentyCompany } from './prospect-discovery.types';
import { normalizeCompanyName, normalizeDomain } from './domain-normalize';

/**
 * Company CRM dedupe (v1).
 *
 * Priority:
 * 1. Exact normalized domain match → EXACT_MATCH
 * 2. Exact normalized name when candidate has no domain → EXACT_MATCH (weak but only fallback)
 * 3. Exact normalized name when domain exists but no domain hit → POSSIBLE_MATCH (do not auto-create)
 * 4. Otherwise NEW
 *
 * Name-only matching is never preferred when a domain exists for an EXACT create path.
 */
export function dedupeCompanyAgainstCrm(input: {
  companyName: string;
  domain?: string | null;
  websiteUrl?: string | null;
  crmCompanies: TwentyCompany[];
}): CompanyDedupeResult {
  const candidateDomain = normalizeDomain(input.domain) ?? normalizeDomain(input.websiteUrl);
  const candidateName = normalizeCompanyName(input.companyName);

  if (candidateDomain) {
    const byDomain = input.crmCompanies.find(c => {
      const d = normalizeDomain(c.domain) ?? normalizeDomain(c.websiteUrl);
      return d && d === candidateDomain;
    });
    if (byDomain) {
      return {
        status: 'EXACT_MATCH',
        existingTwentyCompanyId: byDomain.id,
        matchedDomain: candidateDomain,
        matchedName: byDomain.name ?? undefined,
        reason: 'Exact domain match',
      };
    }

    if (candidateName) {
      const byName = input.crmCompanies.find(c => normalizeCompanyName(c.name) === candidateName);
      if (byName) {
        return {
          status: 'POSSIBLE_MATCH',
          existingTwentyCompanyId: byName.id,
          matchedName: byName.name ?? undefined,
          reason:
            'Name match without domain confirmation — requires reviewer decision (no auto-create)',
        };
      }
    }

    return { status: 'NEW', reason: 'No CRM domain or confirmed name match' };
  }

  if (candidateName) {
    const byName = input.crmCompanies.find(c => normalizeCompanyName(c.name) === candidateName);
    if (byName) {
      return {
        status: 'EXACT_MATCH',
        existingTwentyCompanyId: byName.id,
        matchedName: byName.name ?? undefined,
        reason: 'Exact name match (candidate has no domain)',
      };
    }
  }

  return { status: 'NEW', reason: 'No CRM match' };
}
