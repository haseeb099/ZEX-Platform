import {
  CompanyBrainPayload,
  CompanyBrainUserOverrides,
  companyBrainPayloadSchema,
} from './company-brain.types';

function clonePayload(payload: CompanyBrainPayload): CompanyBrainPayload {
  return companyBrainPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
}

/**
 * Merge regeneration into the effective payload without overwriting human-protected sections/items.
 *
 * Semantics (v1):
 * - Section-level overrides (`icp`, `messagingSummary`) keep the entire current section.
 * - List sections (`personas`, `painPoints`, `competitors`, `qualificationRules`):
 *   - items marked in overrides keep the current item (matched by id)
 *   - unmarked items are replaced from the new generated draft
 *   - new generated items (new ids) are added
 */
export function mergeGeneratedPayload(input: {
  current: CompanyBrainPayload | null | undefined;
  generated: CompanyBrainPayload;
  overrides: CompanyBrainUserOverrides | null | undefined;
}): CompanyBrainPayload {
  const generated = clonePayload(input.generated);
  const current = input.current ? clonePayload(input.current) : null;
  const overrides = input.overrides ?? {};

  if (!current) return generated;

  const next = clonePayload(generated);

  if (overrides.icp) {
    next.icp = current.icp;
  }
  if (overrides.messagingSummary) {
    next.messagingSummary = current.messagingSummary;
  }

  next.personas = mergeList(current.personas, generated.personas, overrides.personas);
  next.painPoints = mergeList(current.painPoints, generated.painPoints, overrides.painPoints);
  next.competitors = mergeList(current.competitors, generated.competitors, overrides.competitors);
  next.qualificationRules = mergeList(
    current.qualificationRules,
    generated.qualificationRules,
    overrides.qualificationRules,
  );

  return companyBrainPayloadSchema.parse(next);
}

function mergeList<T extends { id: string }>(
  current: T[],
  generated: T[],
  itemOverrides?: Record<string, boolean>,
): T[] {
  const protectedIds = new Set(
    Object.entries(itemOverrides ?? {})
      .filter(([, v]) => v)
      .map(([id]) => id),
  );
  if (protectedIds.size === 0) return generated;

  const currentById = new Map(current.map(item => [item.id, item]));
  const result: T[] = [];
  const seen = new Set<string>();

  for (const item of generated) {
    if (protectedIds.has(item.id) && currentById.has(item.id)) {
      result.push(currentById.get(item.id)!);
    } else {
      result.push(item);
    }
    seen.add(item.id);
  }

  for (const id of protectedIds) {
    if (!seen.has(id) && currentById.has(id)) {
      result.push(currentById.get(id)!);
    }
  }

  return result;
}

export function markSectionOverride(
  overrides: CompanyBrainUserOverrides | null | undefined,
  section: keyof CompanyBrainUserOverrides,
  itemId?: string,
): CompanyBrainUserOverrides {
  const next: CompanyBrainUserOverrides = {
    ...(overrides ?? {}),
    personas: { ...(overrides?.personas ?? {}) },
    painPoints: { ...(overrides?.painPoints ?? {}) },
    competitors: { ...(overrides?.competitors ?? {}) },
    qualificationRules: { ...(overrides?.qualificationRules ?? {}) },
  };

  if (section === 'icp' || section === 'messagingSummary') {
    next[section] = true;
    return next;
  }

  if (!itemId) {
    // Whole-section replacement: mark all current keys if provided via empty itemId means section-level list replace
    (next as Record<string, unknown>)[section] = { ...(next[section] as object), __section: true };
    return next;
  }

  const map = (next[section] as Record<string, boolean>) ?? {};
  map[itemId] = true;
  next[section] = map;
  return next;
}
