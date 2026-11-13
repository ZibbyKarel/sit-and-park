import { createHash, timingSafeEqual } from 'node:crypto';

/** A key shorter than this is refused before it is hashed. */
export const MIN_EMPLOYEE_SYNC_KEY_LENGTH = 32;

/**
 * Whether `authorization` is `Bearer <key>` with `sha256(key) === expectedHex`.
 *
 * Compares the two 32-byte digests with `timingSafeEqual`, so the time taken
 * says nothing about how much of the key was right. The key itself is never
 * logged, stored or returned.
 */
export function isValidEmployeeSyncKey(
  authorization: string | undefined,
  expectedHex: string
): boolean {
  const match = /^Bearer (\S+)$/.exec(authorization ?? '');
  const key = match?.[1];
  if (key === undefined || key.length < MIN_EMPLOYEE_SYNC_KEY_LENGTH) {
    return false;
  }
  const actual = createHash('sha256').update(key, 'utf8').digest();
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
