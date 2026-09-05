import {
  dedupeByProspect,
  sortActionFeedItems,
  TYPE_RANK,
  ActionFeedItem,
} from './action-feed.types';

function item(
  partial: Partial<ActionFeedItem> & Pick<ActionFeedItem, 'id' | 'type' | 'rankScore'>,
): ActionFeedItem {
  return {
    priority: 'medium',
    title: partial.title || partial.id,
    summary: partial.summary || '',
    evidence: [],
    action: { kind: 'approve_prospect', entityId: 'x' },
    status: 'PROPOSED',
    createdAt: partial.createdAt || '2026-09-04T12:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-09-04T12:00:00.000Z',
    ...partial,
  };
}

describe('action-feed ranking helpers', () => {
  it('dedupes by prospect keeping highest rankScore (downstream wins)', () => {
    const items = [
      item({
        id: 'prospect_approval:p1',
        type: 'prospect_approval',
        rankScore: TYPE_RANK.prospect_approval,
        prospectCandidateId: 'cand-1',
      }),
      item({
        id: 'sdr_draft_approval:d1',
        type: 'sdr_draft_approval',
        rankScore: TYPE_RANK.sdr_draft_approval + 50,
        prospectCandidateId: 'cand-1',
      }),
      item({
        id: 'meeting_opportunity:m1',
        type: 'meeting_opportunity',
        rankScore: TYPE_RANK.meeting_opportunity,
        prospectCandidateId: 'cand-2',
      }),
    ];
    const out = dedupeByProspect(items);
    expect(out).toHaveLength(2);
    expect(out.find(i => i.prospectCandidateId === 'cand-1')?.type).toBe('sdr_draft_approval');
    expect(out.find(i => i.prospectCandidateId === 'cand-2')?.type).toBe('meeting_opportunity');
  });

  it('sorts meeting > reply > draft > prospect with stable id tie-break', () => {
    const items = [
      item({
        id: 'prospect_approval:a',
        type: 'prospect_approval',
        rankScore: TYPE_RANK.prospect_approval,
        score: 99,
      }),
      item({
        id: 'meeting_opportunity:z',
        type: 'meeting_opportunity',
        rankScore: TYPE_RANK.meeting_opportunity,
        score: 10,
      }),
      item({
        id: 'reply_review:m',
        type: 'reply_review',
        rankScore: TYPE_RANK.reply_review,
        score: 50,
      }),
      item({
        id: 'sdr_draft_approval:d',
        type: 'sdr_draft_approval',
        rankScore: TYPE_RANK.sdr_draft_approval,
        score: 80,
      }),
    ];
    const sorted = sortActionFeedItems(items).map(i => i.type);
    expect(sorted).toEqual([
      'meeting_opportunity',
      'reply_review',
      'sdr_draft_approval',
      'prospect_approval',
    ]);
  });

  it('uses overall score then updatedAt then id for ties', () => {
    const items = [
      item({
        id: 'prospect_approval:b',
        type: 'prospect_approval',
        rankScore: 400,
        score: 50,
        updatedAt: '2026-09-04T10:00:00.000Z',
      }),
      item({
        id: 'prospect_approval:a',
        type: 'prospect_approval',
        rankScore: 400,
        score: 90,
        updatedAt: '2026-09-04T09:00:00.000Z',
      }),
      item({
        id: 'prospect_approval:c',
        type: 'prospect_approval',
        rankScore: 400,
        score: 90,
        updatedAt: '2026-09-04T11:00:00.000Z',
      }),
    ];
    expect(sortActionFeedItems(items).map(i => i.id)).toEqual([
      'prospect_approval:c',
      'prospect_approval:a',
      'prospect_approval:b',
    ]);
  });
});
