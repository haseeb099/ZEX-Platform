import { createHash } from 'crypto';
import type { ProviderFinding } from './research-agent.types';

const MAX_EXCERPT = 500;

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function boundExcerpt(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length <= MAX_EXCERPT ? trimmed : `${trimmed.slice(0, MAX_EXCERPT - 1)}…`;
}

/** Normalize http(s) URLs for dedupe; returns null if invalid/non-http. */
export function normalizeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    // Drop trailing slash on path (except root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

export function normalizeClaim(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildFindingDedupeKey(input: {
  prospectCandidateId: string;
  findingType: string;
  claim: string;
  sourceUrl?: string | null;
  occurredAt?: Date | string | null;
  personName?: string | null;
}): string {
  const occurred =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString().slice(0, 10)
      : input.occurredAt
        ? String(input.occurredAt).slice(0, 10)
        : '';
  const material = [
    input.prospectCandidateId,
    input.findingType,
    normalizeClaim(input.claim),
    normalizeSourceUrl(input.sourceUrl) || '',
    occurred,
    (input.personName || '').trim().toLowerCase(),
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function assertFindingProvenance(finding: ProviderFinding): void {
  const hasExcerpt = Boolean(finding.excerpt && finding.excerpt.trim());
  const hasSource = Boolean(finding.sourceUrl || finding.sourceTitle || finding.sourceType);
  if (!hasExcerpt && !hasSource) {
    throw new Error(`Finding lacks provenance: ${finding.title}`);
  }
  if (finding.personName) {
    const blob = `${finding.excerpt || ''} ${finding.summary} ${finding.claim}`.toLowerCase();
    if (!blob.includes(finding.personName.trim().toLowerCase())) {
      throw new Error(`Named person not evidenced in finding text: ${finding.personName}`);
    }
  }
}

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}
