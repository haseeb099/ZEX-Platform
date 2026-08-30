/** Map platform opportunity stage labels → pinned Twenty SELECT values. */
const STAGE_TO_TWENTY: Record<string, string> = {
  prospect: 'NEW',
  new: 'NEW',
  screening: 'SCREENING',
  meeting: 'MEETING',
  proposal: 'PROPOSAL',
  customer: 'CUSTOMER',
};

export function mapOpportunityStageToTwenty(stage?: string | null): string {
  if (!stage) return 'NEW';
  const normalized = stage.trim();
  const mapped = STAGE_TO_TWENTY[normalized.toLowerCase()];
  return mapped || normalized.toUpperCase();
}
