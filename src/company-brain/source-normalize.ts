import { createHash } from 'crypto';

const MAX_EXCERPT = 500;

/** Normalize whitespace and trim for stable hashing / analysis. */
export function normalizeSourceText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hashSourceContent(normalizedText: string, sourceUrl?: string | null): string {
  const material = `${sourceUrl ?? ''}\n${normalizedText}`;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export function boundExcerpt(text: string, max = MAX_EXCERPT): string {
  const normalized = normalizeSourceText(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

/** Extract a short excerpt around the first occurrence of a needle, or a head excerpt. */
export function excerptAround(
  sourceText: string,
  needle?: string | null,
  max = MAX_EXCERPT,
): string {
  const text = normalizeSourceText(sourceText);
  if (!needle) return boundExcerpt(text, max);
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return boundExcerpt(text, max);

  const prefix = idx > 0;
  const roughEnd = Math.min(text.length, Math.max(0, idx - Math.floor(max / 2)) + max);
  const suffix = roughEnd < text.length;
  const window = Math.max(16, max - (prefix ? 1 : 0) - (suffix ? 1 : 0));
  const half = Math.floor(window / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + window);
  const slice = text.slice(start, end);
  const withMarks = `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
  return boundExcerpt(withMarks, max);
}
