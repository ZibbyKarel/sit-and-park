/**
 * The desk booking rules, pure: one place that decides access, a day's status,
 * a series day's verdict and the series-level blockers, shared by the
 * directory, the series preview, booking and approval
 * (`doc/desk-merge-plan.md` §"Rules carried over").
 *
 * Nothing here reads the database. The services load the facts — the caller's
 * office, role, hive membership, grants and permanent desk, inside the same
 * transaction as the write — and hand them in.
 */

import type { DeskAccess, DeskSeriesDay, DeskSkipReason, DeskStatus } from '@sit-and-park/contract';
import type { DateOnly } from '@sit-and-park/shared-types';
import { compareDateOnly } from '@sit-and-park/shared-types';
import { DomainError } from '../common/errors/domain-error';

/** What the rules need to know about the caller. */
export interface DeskCaller {
  id: string;
  /** `null`: no office assigned yet, so no desk is bookable. */
  officeId: string | null;
  isAdmin: boolean;
  /** The one hive the caller is a member of, if any. */
  hiveId: string | null;
  /** Desks the caller holds a direct grant for. */
  grantedDeskIds: ReadonlySet<string>;
  /** The caller's own permanent desk, if any. */
  permanentDeskId: string | null;
}

/** What the rules need to know about a desk. */
export interface DeskFacts {
  id: string;
  officeId: string;
  hiveId: string | null;
  active: boolean;
  permanentAssigneeId: string | null;
}

/** One desk on one day. */
export interface DeskDayFacts {
  /** Who holds the desk's reservation that day, if anybody. */
  reservedByUserId: string | null;
  /** The permanent holder released the desk that day. */
  released: boolean;
}

/**
 * `DIRECT` iff the desk is in the caller's office AND (no hive, OR admin, OR a
 * member of its hive, OR a grant). Otherwise `APPROVAL` for a hive desk of the
 * caller's office, else `NONE`. Another office is never accessible, admin
 * included.
 */
export function deskAccess(
  desk: Pick<DeskFacts, 'id' | 'officeId' | 'hiveId'>,
  caller: DeskCaller
): DeskAccess {
  if (caller.officeId === null || desk.officeId !== caller.officeId) {
    return 'NONE';
  }
  if (
    desk.hiveId === null ||
    caller.isAdmin ||
    caller.hiveId === desk.hiveId ||
    caller.grantedDeskIds.has(desk.id)
  ) {
    return 'DIRECT';
  }
  return 'APPROVAL';
}

/** The desk has a permanent holder who did not release it that day. */
export function isAssignedOn(
  desk: Pick<DeskFacts, 'permanentAssigneeId'>,
  day: Pick<DeskDayFacts, 'released'>
): boolean {
  return desk.permanentAssigneeId !== null && !day.released;
}

/** First match wins: `INACTIVE`, `ASSIGNED`, `RESERVED_BY_ME` / `RESERVED`, `FREE`. */
export function deskStatus(
  desk: Pick<DeskFacts, 'active' | 'permanentAssigneeId'>,
  day: DeskDayFacts,
  callerId: string
): DeskStatus {
  if (!desk.active) {
    return 'INACTIVE';
  }
  if (isAssignedOn(desk, day)) {
    return 'ASSIGNED';
  }
  if (day.reservedByUserId !== null) {
    return day.reservedByUserId === callerId ? 'RESERVED_BY_ME' : 'RESERVED';
  }
  return 'FREE';
}

/** One series day, and the caller's own reservation that day (any desk). */
export interface SeriesDayFacts extends DeskDayFacts {
  date: DateOnly;
  /** The desk the caller already holds that day, if any. */
  callerReservedDeskId: string | null;
}

/** Why the day would not be booked, in the source's order; `null` = bookable. */
export function seriesDayVerdict(
  desk: Pick<DeskFacts, 'id' | 'permanentAssigneeId'>,
  day: SeriesDayFacts,
  today: DateOnly
): DeskSkipReason | null {
  if (compareDateOnly(day.date, today) < 0) {
    return 'PAST_DATE';
  }
  if (isAssignedOn(desk, day)) {
    return 'DESK_ASSIGNED';
  }
  if (day.callerReservedDeskId !== null) {
    return day.callerReservedDeskId === desk.id
      ? 'ALREADY_RESERVED_THIS_DESK'
      : 'ALREADY_RESERVED_OTHER_DESK';
  }
  if (day.reservedByUserId !== null) {
    return 'DESK_TAKEN';
  }
  return null;
}

/** The per-day plan, ascending by date. */
export function planSeries(
  desk: Pick<DeskFacts, 'id' | 'permanentAssigneeId'>,
  days: readonly SeriesDayFacts[],
  today: DateOnly
): DeskSeriesDay[] {
  return [...days]
    .sort((a, b) => compareDateOnly(a.date, b.date))
    .map((day) => {
      const reason = seriesDayVerdict(desk, day, today);
      return { date: day.date, ok: reason === null, reason };
    });
}

/**
 * The blockers that fail a whole series call, in the source's order: no
 * office, the caller holds a permanent desk (even on a day they released it),
 * no such desk, inactive desk, no direct access. Narrows `desk` to present.
 */
export function assertSeriesAllowed(
  desk: DeskFacts | null,
  caller: DeskCaller
): asserts desk is DeskFacts {
  if (caller.officeId === null) {
    throw new DomainError('NO_OFFICE_ASSIGNED');
  }
  if (caller.permanentDeskId !== null) {
    throw new DomainError('PERMANENT_DESK_HOLDER');
  }
  if (desk === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such desk.' });
  }
  if (!desk.active) {
    throw new DomainError('DESK_NOT_AVAILABLE');
  }
  if (deskAccess(desk, caller) !== 'DIRECT') {
    throw new DomainError('DESK_ACCESS_DENIED');
  }
}
