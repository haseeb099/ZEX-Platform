import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison for equal-length secrets; rejects length mismatch safely. */
export function secureCompareStrings(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) {
    // Compare against self to avoid early return timing leak on length.
    timingSafeEqual(providedBuf, providedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
