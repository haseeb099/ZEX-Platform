import { z } from 'zod';

export const ACTION_FEED_VERSION = 'action-feed-v1';

export const ACTION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const ACTION_KINDS = [
  'approve_prospect',
  'reject_prospect',
  'approve_sdr_draft',
  'reject_sdr_draft',
  'review_reply',
  'confirm_meeting',
  'inspect_failure',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_FEED_ITEM_TYPES = [
  'meeting_opportunity',
  'reply_review',
  'sdr_draft_approval',
  'prospect_approval',
  'workflow_blocked',
] as const;
export type ActionFeedItemType = (typeof ACTION_FEED_ITEM_TYPES)[number];

/**
 * Deterministic ranking weights (higher = more urgent).
 * Ordering docs: docs/ACTION_FEED_V1.md
 */
export const TYPE_RANK: Record<ActionFeedItemType, number> = {
  meeting_opportunity: 1000,
  reply_review: 900,
  sdr_draft_approval: 700,
  workflow_blocked: 600,
  prospect_approval: 400,
};

export const PRIORITY_FROM_TYPE: Record<ActionFeedItemType, ActionPriority> = {
  meeting_opportunity: 'critical',
  reply_review: 'critical',
  sdr_draft_approval: 'high',
  workflow_blocked: 'high',
  prospect_approval: 'medium',
};

export type ActionEvidence = {
  label: string;
  text: string;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  findingId?: string | null;
};

export type ActionFeedItem = {
  id: string;
  type: ActionFeedItemType;
  priority: ActionPriority;
  /** Sort key only — higher first. Not shown as ML score. */
  rankScore: number;
  score?: number | null;
  title: string;
  summary: string;
  prospectCandidateId?: string | null;
  companyName?: string | null;
  whyNow?: string | null;
  evidence: ActionEvidence[];
  action: {
    kind: ActionKind;
    entityId: string;
    secondaryKind?: ActionKind | null;
  };
  /** Type-specific preview payload (bounded). */
  preview?: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionFeedResponse = {
  version: string;
  tenantId: string;
  generatedAt: string;
  summary: {
    needsApproval: number;
    replies: number;
    meetings: number;
    blocked: number;
    total: number;
  };
  items: ActionFeedItem[];
};

export const actionFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Downstream-wins dedupe: when multiple items share a prospect, keep the highest TYPE_RANK.
 */
export function dedupeByProspect(items: ActionFeedItem[]): ActionFeedItem[] {
  const byProspect = new Map<string, ActionFeedItem>();
  const withoutProspect: ActionFeedItem[] = [];

  for (const item of items) {
    const key = item.prospectCandidateId;
    if (!key) {
      withoutProspect.push(item);
      continue;
    }
    const existing = byProspect.get(key);
    if (!existing || item.rankScore > existing.rankScore) {
      byProspect.set(key, item);
    }
  }

  return [...byProspect.values(), ...withoutProspect];
}

/** Stable sort: rankScore desc, overall score desc, updatedAt desc, id asc. */
export function sortActionFeedItems(items: ActionFeedItem[]): ActionFeedItem[] {
  return [...items].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    const scoreA = a.score ?? -1;
    const scoreB = b.score ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const tA = Date.parse(a.updatedAt) || 0;
    const tB = Date.parse(b.updatedAt) || 0;
    if (tB !== tA) return tB - tA;
    return a.id.localeCompare(b.id);
  });
}
