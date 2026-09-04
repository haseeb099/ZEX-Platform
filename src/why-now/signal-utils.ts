import { createHash } from 'crypto';
import type { ProviderSignal } from './why-now.types';

/** Build stable signal dedupe key (tenant-scoped uniqueness). */
export function buildSignalDedupeKey(input: {
  prospectCandidateId: string;
  signalType: string;
  source: string;
  occurredAt: Date;
  title: string;
  summary?: string | null;
}): string {
  const occurred = input.occurredAt.toISOString().slice(0, 10);
  const normalized = [
    input.prospectCandidateId,
    input.signalType.trim().toLowerCase(),
    input.source.trim().toLowerCase(),
    occurred,
    input.title.trim().toLowerCase(),
    (input.summary ?? '').trim().toLowerCase().slice(0, 120),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export function coerceOccurredAt(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

/**
 * Timing decay factor from signal age in days.
 * Fresh (≤7d)=1.0 → 8–30d=0.7 → 31–90d=0.35 → 91–180d=0.15 → >180d=0.05
 */
export function timingDecayFactor(ageDays: number): number {
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.35;
  if (ageDays <= 180) return 0.15;
  return 0.05;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

export function normalizeProviderSignal(
  raw: ProviderSignal,
): ProviderSignal & { occurredAt: Date } {
  return {
    ...raw,
    occurredAt: coerceOccurredAt(raw.occurredAt),
  };
}
