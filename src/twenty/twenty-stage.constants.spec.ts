import { mapOpportunityStageToTwenty } from './twenty-stage.constants';

describe('mapOpportunityStageToTwenty', () => {
  it('maps platform prospect stage to pinned Twenty NEW', () => {
    expect(mapOpportunityStageToTwenty('prospect')).toBe('NEW');
  });

  it('passes through known Twenty stages', () => {
    expect(mapOpportunityStageToTwenty('MEETING')).toBe('MEETING');
  });
});
