/** Normalize company domain for dedupe (strip protocol, www, path, port, lowercase). */
export function normalizeDomain(input?: string | null): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^www\./, '');
  value = value.split('/')[0] ?? value;
  value = value.split('?')[0] ?? value;
  value = value.split('#')[0] ?? value;
  value = value.split(':')[0] ?? value;
  value = value.replace(/\.$/, '');

  if (!value || value.includes(' ') || !value.includes('.')) {
    // allow single-label only if it looks like a host from tests (e.g. localhost) — reject empty
    if (!/^[a-z0-9.-]+$/.test(value)) return null;
  }

  return value || null;
}

export function normalizeCompanyName(input?: string | null): string | null {
  if (!input) return null;
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value || null;
}

export function domainFromWebsite(websiteUrl?: string | null): string | null {
  return normalizeDomain(websiteUrl);
}
