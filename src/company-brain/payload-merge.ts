import {
  CompanyBrainListOverrides,
  CompanyBrainPayload,
  CompanyBrainUserOverrides,
  companyBrainPayloadSchema,
} from './company-brain.types';

type ListSection = 'personas' | 'painPoints' | 'competitors' | 'qualificationRules';

function clonePayload(payload: CompanyBrainPayload): CompanyBrainPayload {
  return companyBrainPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
}

/**
 * Normalize list overrides.
 * Supports the v1 structured shape and a legacy flat `Record<id, true>` (treated as items).
 */
export function normalizeListOverrides(raw: unknown): CompanyBrainListOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { items: {}, suppressedIds: {}, wholeSection: false };
  }
  const obj = raw as Record<string, unknown>;
  if ('items' in obj || 'suppressedIds' in obj || 'wholeSection' in obj) {
    return {
      items: asBoolMap(obj.items),
      suppressedIds: asBoolMap(obj.suppressedIds),
      wholeSection: obj.wholeSection === true,
    };
  }
  return {
    items: asBoolMap(obj),
    suppressedIds: {},
    wholeSection: false,
  };
}

function asBoolMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, true] => entry[1] === true,
  );
  return Object.fromEntries(entries);
}

function cloneUserOverrides(
  overrides: CompanyBrainUserOverrides | null | undefined,
): CompanyBrainUserOverrides {
  return {
    icp: overrides?.icp,
    messagingSummary: overrides?.messagingSummary,
    personas: normalizeListOverrides(overrides?.personas),
    painPoints: normalizeListOverrides(overrides?.painPoints),
    competitors: normalizeListOverrides(overrides?.competitors),
    qualificationRules: normalizeListOverrides(overrides?.qualificationRules),
  };
}

/**
 * Merge regeneration into the effective payload without overwriting human-protected data.
 *
 * Semantics (v1):
 * - Section-level overrides (`icp`, `messagingSummary`) keep the entire current section.
 * - List sections (`personas`, `painPoints`, `competitors`, `qualificationRules`):
 *   - `wholeSection`: keep the current list exactly; do not inject new generated items
 *   - `items[id]`: keep the current item (if present) instead of the generated one
 *   - `suppressedIds[id]`: never re-add that generated id (tombstone)
 *   - otherwise: take generated items (including genuinely new ids)
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

export function mergeList<T extends { id: string }>(
  current: T[],
  generated: T[],
  rawOverrides?: CompanyBrainListOverrides | Record<string, boolean> | null,
): T[] {
  const overrides = normalizeListOverrides(rawOverrides);

  if (overrides.wholeSection) {
    return current;
  }

  const protectedIds = new Set(
    Object.entries(overrides.items ?? {})
      .filter(([, v]) => v)
      .map(([id]) => id),
  );
  const suppressedIds = new Set(
    Object.entries(overrides.suppressedIds ?? {})
      .filter(([, v]) => v)
      .map(([id]) => id),
  );

  if (protectedIds.size === 0 && suppressedIds.size === 0) {
    return generated;
  }

  const currentById = new Map(current.map(item => [item.id, item]));
  const result: T[] = [];
  const seen = new Set<string>();

  for (const item of generated) {
    if (suppressedIds.has(item.id)) {
      continue;
    }
    if (protectedIds.has(item.id)) {
      if (currentById.has(item.id)) {
        result.push(currentById.get(item.id)!);
        seen.add(item.id);
      }
      // Protected but missing from current = already deleted without tombstone; skip resurrect.
      continue;
    }
    result.push(item);
    seen.add(item.id);
  }

  for (const id of protectedIds) {
    if (suppressedIds.has(id)) continue;
    if (!seen.has(id) && currentById.has(id)) {
      result.push(currentById.get(id)!);
    }
  }

  return result;
}

/** Mark a scalar section (icp / messaging) as human-overridden. */
export function markSectionOverride(
  overrides: CompanyBrainUserOverrides | null | undefined,
  section: 'icp' | 'messagingSummary',
): CompanyBrainUserOverrides {
  const next = cloneUserOverrides(overrides);
  next[section] = true;
  return next;
}

/** Mark a list item as human-edited (sticky on regeneration). */
function omitKey(map: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** Mark a list item as human-edited (sticky on regeneration). */
export function markListItemOverride(
  overrides: CompanyBrainUserOverrides | null | undefined,
  section: ListSection,
  itemId: string,
): CompanyBrainUserOverrides {
  const next = cloneUserOverrides(overrides);
  const list = { ...normalizeListOverrides(next[section]) };
  list.items = { ...list.items, [itemId]: true };
  list.suppressedIds = omitKey(list.suppressedIds ?? {}, itemId);
  next[section] = list;
  return next;
}

/** Tombstone a deleted generated item so regeneration cannot resurrect it. */
export function markListItemSuppressed(
  overrides: CompanyBrainUserOverrides | null | undefined,
  section: ListSection,
  itemId: string,
): CompanyBrainUserOverrides {
  const next = cloneUserOverrides(overrides);
  const list = { ...normalizeListOverrides(next[section]) };
  list.suppressedIds = { ...list.suppressedIds, [itemId]: true };
  list.items = omitKey(list.items ?? {}, itemId);
  next[section] = list;
  return next;
}

/**
 * Mark an entire list as human-controlled (PATCH whole-list replacement).
 * Optionally tombstone generated ids that were dropped from the replacement.
 */
export function markWholeListOverride(
  overrides: CompanyBrainUserOverrides | null | undefined,
  section: ListSection,
  input: {
    retainedIds: string[];
    previousIds?: string[];
  },
): CompanyBrainUserOverrides {
  const next = cloneUserOverrides(overrides);
  const retained = new Set(input.retainedIds);
  const suppressed: Record<string, boolean> = {
    ...normalizeListOverrides(next[section]).suppressedIds,
  };
  for (const id of input.previousIds ?? []) {
    if (!retained.has(id)) suppressed[id] = true;
  }
  next[section] = {
    wholeSection: true,
    items: Object.fromEntries(input.retainedIds.map(id => [id, true])),
    suppressedIds: suppressed,
  };
  return next;
}
