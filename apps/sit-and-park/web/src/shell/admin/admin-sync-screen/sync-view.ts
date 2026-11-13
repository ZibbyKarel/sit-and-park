/**
 * What the employee-sync screen decides, as pure functions: which sentence a
 * rejection reason gets, and whether a capped list may hide rows.
 */

import { employeeSyncReasonCode, type EmployeeSyncReasonCode } from '@sit-and-park/contract';
import { EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT } from '@sit-and-park/i18n';
import type cs from '../../../../messages/cs.json';

type SyncKey = keyof (typeof cs)['adminSync'];

const REASON_KEYS: Record<EmployeeSyncReasonCode, SyncKey> = {
  NOT_CONFIGURED: 'reasonNotConfigured',
  INVALID_KEY: 'reasonInvalidKey',
  INVALID_PAYLOAD: 'reasonInvalidPayload',
  EMPTY_LIST: 'reasonEmptyList',
  INVALID_ROWS: 'reasonInvalidRows',
  LIST_SHRANK: 'reasonListShrank',
};

/** The catalogue key for a run's `reason`, or `null` for a code this build does not know. */
export function reasonKeyOf(reason: string): SyncKey | null {
  const code = employeeSyncReasonCode(reason);
  return code === null ? null : REASON_KEYS[code];
}

/** The English detail after `"<CODE>: "`, for operators; the whole string when there is no code. */
export function reasonDetailOf(reason: string): string {
  return employeeSyncReasonCode(reason) === null
    ? reason
    : reason.slice(reason.indexOf(':') + 1).trim();
}

/** A list at the cap may have been cut off, so its length is a lower bound. */
export function isCapped(list: readonly unknown[]): boolean {
  return list.length >= EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT;
}
