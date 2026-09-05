import {
  compareActionFeedItems,
  dedupeByProspect,
  sortActionFeedItems,
  TYPE_RANK,
  ActionFeedItem,
  ActionFeedItemType,
} from './action-feed.types';

function item(
  partial: Partial<ActionFeedItem> & Pick<ActionFeedItem, 'id' | 'type'>,
): ActionFeedItem {
  const { type, id, rankScore, ...rest } = partial;
  return {
    priority: 'medium',
    title: rest.title || id,
    summary: rest.summary || '',
    evidence: [],
    action: { kind: 'approve_prospect', entityId: 'x' },
    status: 'PROPOSED',
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
    ...rest,
    id,
    type,
    rankScore: rankScore ?? TYPE_RANK[type],
  };
}

describe('action-feed ranking helpers', () => {
  describe('cross-tier ordering (type absolute; score must not invert)', () => {
    it('meeting score 0 beats reply score 100', () => {
      const meeting = item({
        id: 'meeting_opportunity:m0',
        type: 'meeting_opportunity',
        score: 0,
      });
      const reply = item({
        id: 'reply_review:r100',
        type: 'reply_review',
        score: 100,
      });
      expect(compareActionFeedItems(meeting, reply)).toBeLessThan(0);
      expect(sortActionFeedItems([reply, meeting]).map(i => i.type)).toEqual([
        'meeting_opportunity',
        'reply_review',
      ]);
    });

    it('reply score 0 beats SDR draft score 100', () => {
      const reply = item({ id: 'reply_review:r0', type: 'reply_review', score: 0 });
      const draft = item({
        id: 'sdr_draft_approval:d100',
        type: 'sdr_draft_approval',
        score: 100,
      });
      expect(compareActionFeedItems(reply, draft)).toBeLessThan(0);
      expect(sortActionFeedItems([draft, reply]).map(i => i.type)).toEqual([
        'reply_review',
        'sdr_draft_approval',
      ]);
    });

    it('SDR draft score 0 beats blocked score 100', () => {
      const draft = item({
        id: 'sdr_draft_approval:d0',
        type: 'sdr_draft_approval',
        score: 0,
      });
      const blocked = item({
        id: 'workflow_blocked:b100',
        type: 'workflow_blocked',
        score: 100,
      });
      expect(compareActionFeedItems(draft, blocked)).toBeLessThan(0);
      expect(sortActionFeedItems([blocked, draft]).map(i => i.type)).toEqual([
        'sdr_draft_approval',
        'workflow_blocked',
      ]);
    });

    it('blocked score 0 beats prospect score 100', () => {
      const blocked = item({
        id: 'workflow_blocked:b0',
        type: 'workflow_blocked',
        score: 0,
      });
      const prospect = item({
        id: 'prospect_approval:p100',
        type: 'prospect_approval',
        score: 100,
      });
      expect(compareActionFeedItems(blocked, prospect)).toBeLessThan(0);
      expect(sortActionFeedItems([prospect, blocked]).map(i => i.type)).toEqual([
        'workflow_blocked',
        'prospect_approval',
      ]);
    });

    it('full chain meeting > reply > draft > blocked > prospect even with inverted scores', () => {
      const types: ActionFeedItemType[] = [
        'prospect_approval',
        'workflow_blocked',
        'sdr_draft_approval',
        'reply_review',
        'meeting_opportunity',
      ];
      const items = types.map((type, idx) =>
        item({
          id: `${type}:x`,
          type,
          // Invert score vs tier so score*2 would have inverted under old model
          score: (types.length - 1 - idx) * 25,
        }),
      );
      expect(sortActionFeedItems(items).map(i => i.type)).toEqual([
        'meeting_opportunity',
        'reply_review',
        'sdr_draft_approval',
        'workflow_blocked',
        'prospect_approval',
      ]);
    });
  });

  describe('same-type score ordering', () => {
    it('same-type higher score wins', () => {
      const low = item({
        id: 'prospect_approval:low',
        type: 'prospect_approval',
        score: 10,
      });
      const high = item({
        id: 'prospect_approval:high',
        type: 'prospect_approval',
        score: 90,
      });
      expect(compareActionFeedItems(high, low)).toBeLessThan(0);
      expect(sortActionFeedItems([low, high]).map(i => i.id)).toEqual([
        'prospect_approval:high',
        'prospect_approval:low',
      ]);
    });
  });

  describe('prospect dedupe (downstream wins)', () => {
    it('same prospect with meeting + reply dedupes to meeting', () => {
      const out = dedupeByProspect([
        item({
          id: 'reply_review:r',
          type: 'reply_review',
          score: 100,
          prospectCandidateId: 'cand-1',
        }),
        item({
          id: 'meeting_opportunity:m',
          type: 'meeting_opportunity',
          score: 0,
          prospectCandidateId: 'cand-1',
        }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('meeting_opportunity');
    });

    it('same prospect with reply + draft dedupes to reply', () => {
      const out = dedupeByProspect([
        item({
          id: 'sdr_draft_approval:d',
          type: 'sdr_draft_approval',
          score: 100,
          prospectCandidateId: 'cand-1',
        }),
        item({
          id: 'reply_review:r',
          type: 'reply_review',
          score: 0,
          prospectCandidateId: 'cand-1',
        }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('reply_review');
    });

    it('dedupes keeping highest type tier even when lower tier has higher score', () => {
      const items = [
        item({
          id: 'prospect_approval:p1',
          type: 'prospect_approval',
          score: 100,
          prospectCandidateId: 'cand-1',
        }),
        item({
          id: 'sdr_draft_approval:d1',
          type: 'sdr_draft_approval',
          score: 0,
          prospectCandidateId: 'cand-1',
        }),
        item({
          id: 'meeting_opportunity:m1',
          type: 'meeting_opportunity',
          score: 0,
          prospectCandidateId: 'cand-2',
        }),
      ];
      const out = dedupeByProspect(items);
      expect(out).toHaveLength(2);
      expect(out.find(i => i.prospectCandidateId === 'cand-1')?.type).toBe('sdr_draft_approval');
      expect(out.find(i => i.prospectCandidateId === 'cand-2')?.type).toBe('meeting_opportunity');
    });
  });

  describe('deterministic tie-break', () => {
    it('uses overall score then updatedAt then id for same-type ties', () => {
      const items = [
        item({
          id: 'prospect_approval:b',
          type: 'prospect_approval',
          score: 50,
          updatedAt: '2026-09-04T10:00:00.000Z',
        }),
        item({
          id: 'prospect_approval:a',
          type: 'prospect_approval',
          score: 90,
          updatedAt: '2026-09-04T09:00:00.000Z',
        }),
        item({
          id: 'prospect_approval:c',
          type: 'prospect_approval',
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

    it('id tie-break remains stable when score and updatedAt match', () => {
      const items = [
        item({
          id: 'prospect_approval:z',
          type: 'prospect_approval',
          score: 40,
          updatedAt: '2026-09-04T12:00:00.000Z',
        }),
        item({
          id: 'prospect_approval:a',
          type: 'prospect_approval',
          score: 40,
          updatedAt: '2026-09-04T12:00:00.000Z',
        }),
        item({
          id: 'prospect_approval:m',
          type: 'prospect_approval',
          score: 40,
          updatedAt: '2026-09-04T12:00:00.000Z',
        }),
      ];
      expect(sortActionFeedItems(items).map(i => i.id)).toEqual([
        'prospect_approval:a',
        'prospect_approval:m',
        'prospect_approval:z',
      ]);
      // second pass identical
      expect(sortActionFeedItems(items).map(i => i.id)).toEqual([
        'prospect_approval:a',
        'prospect_approval:m',
        'prospect_approval:z',
      ]);
    });
  });

  it('rankScore stays type-only and never overlaps across tiers via score', () => {
    const meeting = item({
      id: 'meeting_opportunity:m',
      type: 'meeting_opportunity',
      score: 0,
    });
    const reply = item({ id: 'reply_review:r', type: 'reply_review', score: 100 });
    expect(meeting.rankScore).toBe(TYPE_RANK.meeting_opportunity);
    expect(reply.rankScore).toBe(TYPE_RANK.reply_review);
    expect(meeting.rankScore).toBeGreaterThan(reply.rankScore);
  });
});
