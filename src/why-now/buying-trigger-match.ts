/**
 * Explicit, conservative signal-type → buying-trigger keyword mappings.
 * A type only aligns when the Company Brain trigger text contains one of these terms.
 * Unrelated types never inherit alignment from other concepts (e.g. expansion ≠ CRM migration).
 */
export const SIGNAL_TYPE_TRIGGER_KEYWORDS: Record<string, string[]> = {
  crm_migration: ['crm', 'migration', 'salesforce', 'hubspot'],
  hiring: ['hiring', 'headcount', 'sales hiring', 'outbound scaling', 'revops'],
  funding: ['funding', 'fundraise', 'raised', 'series'],
  expansion: ['expansion', 'new market', 'geographic expansion', 'international expansion'],
  tech_change: ['tech change', 'technology change', 'stack migration', 'platform migration'],
};

export type BuyingTriggerSignalRef = {
  signalType: string;
  title: string;
  summary?: string | null;
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function triggerMentionsKeyword(trigger: string, keyword: string): boolean {
  const t = normalize(trigger);
  const k = normalize(keyword);
  return t.includes(k);
}

/**
 * True only when the signal is grounded against a specific Company Brain buying trigger:
 * 1) title/summary contains the full normalized trigger text, OR
 * 2) this signal type has an explicit keyword mapping that appears in that trigger text.
 */
export function signalMatchesBuyingTrigger(
  signal: BuyingTriggerSignalRef,
  buyingTriggers: string[],
): boolean {
  if (!buyingTriggers.length) return false;

  const title = normalize(signal.title);
  const summary = normalize(signal.summary ?? '');
  const haystack = `${title} ${summary}`;

  // 1) Direct text match against the full buying-trigger phrase
  for (const trigger of buyingTriggers) {
    const t = normalize(trigger);
    if (!t) continue;
    if (haystack.includes(t)) return true;
  }

  // 2) Explicit per-type mapping — only against triggers that mention mapped keywords
  const keywords = SIGNAL_TYPE_TRIGGER_KEYWORDS[signal.signalType];
  if (!keywords?.length) return false;

  return buyingTriggers.some(trigger =>
    keywords.some(keyword => triggerMentionsKeyword(trigger, keyword)),
  );
}
