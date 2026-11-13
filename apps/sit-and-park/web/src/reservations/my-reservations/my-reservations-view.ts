/**
 * The decisions behind "Moje rezervace", as pure functions: which reservations are
 * upcoming, how a month lays out as a calendar with its events, and which days a
 * "release my desk" date range turns into. No React, no network.
 *
 * "Today" is always an argument (`todayInPrague()` at the call site), never read
 * here, so every rule below is testable around the day boundary.
 */

import {
  MAX_DESK_RELEASE_DATES,
  addDays,
  addMonths,
  compareDateOnly,
  isBusinessDay,
  startOfMonth,
  type DateOnly,
} from '@sit-and-park/i18n';
import type {
  DeskApprovalStatus,
  MyDeskReleasesOutput,
  MyDeskRequest,
  MyDeskReservation,
  MyParkingReservation,
} from '@sit-and-park/contract';
import { buildCalendarGrid } from '../../lot/calendar-grid';

export type MyListEntry =
  | {
      readonly kind: 'parking';
      readonly key: string;
      readonly date: DateOnly;
      readonly reservation: MyParkingReservation;
    }
  | {
      readonly kind: 'desk';
      readonly key: string;
      readonly date: DateOnly;
      readonly reservation: MyDeskReservation;
    };

/** One list from both kinds; `key` is `kind:id` because the two id spaces may collide. Parking first. */
export function mergeMyReservations(
  parking: readonly MyParkingReservation[],
  desks: readonly MyDeskReservation[]
): MyListEntry[] {
  return [
    ...parking.map((reservation) => ({
      kind: 'parking' as const,
      key: `parking:${reservation.id}`,
      date: reservation.date,
      reservation,
    })),
    ...desks.map((reservation) => ({
      kind: 'desk' as const,
      key: `desk:${reservation.id}`,
      date: reservation.date,
      reservation,
    })),
  ];
}

export interface SplitReservations<T> {
  /** Today and later, ascending. */
  readonly upcoming: readonly T[];
  /** Before today, newest first. */
  readonly history: readonly T[];
}

/** Today counts as upcoming: the holder can still cancel it. Stable sort keeps same-day input order. */
export function splitReservations<T extends { readonly date: DateOnly }>(
  items: readonly T[],
  today: DateOnly
): SplitReservations<T> {
  const upcoming = items
    .filter((item) => compareDateOnly(item.date, today) >= 0)
    .sort((a, b) => compareDateOnly(a.date, b.date));
  const history = items
    .filter((item) => compareDateOnly(item.date, today) < 0)
    .sort((a, b) => compareDateOnly(b.date, a.date));
  return { upcoming, history };
}

/** `Zóna · Hive`, the hive omitted when the desk has none. */
export function reservationDetail(reservation: MyDeskReservation): string {
  return [reservation.zoneName, reservation.hiveName].filter((part) => part !== null).join(' · ');
}

// --- calendar ---------------------------------------------------------------

export type CalendarEvent =
  | { readonly kind: 'parking'; readonly label: string; readonly reservationId: string }
  | { readonly kind: 'waitlist'; readonly label: string; readonly position: number }
  | { readonly kind: 'desk'; readonly code: string; readonly reservation: MyDeskReservation }
  | { readonly kind: 'permanent'; readonly code: string }
  | { readonly kind: 'released'; readonly code: string }
  | { readonly kind: 'request'; readonly code: string; readonly status: DeskApprovalStatus };

export interface CalendarDay {
  readonly date: DateOnly;
  readonly day: number;
  readonly isToday: boolean;
  readonly isPast: boolean;
  /** Saturday, Sunday or a Czech public holiday: drawn muted. */
  readonly isOff: boolean;
  readonly events: readonly CalendarEvent[];
  /** A business day, today or later, with parking and no desk: the warning marker. */
  readonly parkingWithoutDesk: boolean;
}

export interface CalendarSources {
  /** `reservation.myMonth`'s `reservations`: confirmed parking, with the spot label. */
  readonly parking: readonly {
    date: DateOnly;
    reservationId: string;
    parkingSpotLabel: string;
  }[];
  /** `reservation.myMonth`'s `waitlist`; a queue place is not parking. */
  readonly waitlist: readonly { date: DateOnly; parkingSpotLabel: string; position: number }[];
  readonly reservations: readonly MyDeskReservation[];
  readonly requests: readonly MyDeskRequest[];
  readonly permanent: MyDeskReleasesOutput;
  /** `false` when the permanent desk could not be loaded: no "parking without a desk" warning. */
  readonly warnNoDesk?: boolean;
}

/** First day of the month `delta` months from `anchor`; the calendar's whole navigation. */
export function shiftMonth(anchor: DateOnly, delta: number): DateOnly {
  return startOfMonth(addMonths(startOfMonth(anchor), delta));
}

/**
 * The month containing `anchor` as Monday-first weeks of seven, each day with
 * its events. A permanent holder has a desk on every business day (not a weekend or public
 * holiday) from today on
 * unless they released it, so that day is never flagged as "parking without a
 * desk"; a pending or approved *request* does not count, only a reservation.
 */
export function buildReservationsCalendar(
  anchor: DateOnly,
  sources: CalendarSources,
  today: DateOnly
) {
  const parking = new Set(sources.parking.map((entry) => entry.date));
  const released = new Set(sources.permanent?.releases.map((release) => release.date));
  const grid = buildCalendarGrid<CalendarDay>(anchor, (date) => {
    const isFuture = compareDateOnly(date, today) >= 0;
    const events: CalendarEvent[] = [];
    for (const entry of sources.parking) {
      if (entry.date === date) {
        events.push({
          kind: 'parking',
          label: entry.parkingSpotLabel,
          reservationId: entry.reservationId,
        });
      }
    }
    for (const entry of sources.waitlist) {
      if (entry.date === date) {
        events.push({
          kind: 'waitlist',
          label: entry.parkingSpotLabel,
          position: entry.position,
        });
      }
    }
    const desks = sources.reservations.filter((reservation) => reservation.date === date);
    for (const reservation of desks) {
      events.push({ kind: 'desk', code: reservation.deskCode, reservation });
    }
    let hasDesk = desks.length > 0;
    if (sources.permanent !== null && isFuture && isBusinessDay(date)) {
      if (released.has(date)) {
        events.push({ kind: 'released', code: sources.permanent.code });
      } else {
        events.push({ kind: 'permanent', code: sources.permanent.code });
        hasDesk = true;
      }
    }
    for (const request of sources.requests) {
      if (request.date === date) {
        events.push({ kind: 'request', code: request.deskCode, status: request.status });
      }
    }
    return {
      date,
      day: Number(date.slice(8)),
      isToday: date === today,
      isPast: !isFuture,
      isOff: !isBusinessDay(date),
      events,
      parkingWithoutDesk:
        (sources.warnNoDesk ?? true) &&
        isFuture &&
        isBusinessDay(date) &&
        parking.has(date) &&
        !hasDesk,
    };
  });
  const agenda = grid.weeks
    .flatMap((week) => week.slots)
    .flatMap((slot) => (slot.day !== null && slot.day.events.length > 0 ? [slot.day] : []));
  return { month: grid.month, weeks: grid.weeks, agenda };
}

// --- release range ----------------------------------------------------------

export interface ReleaseRange {
  /** Business days (no weekend or public holiday) between the bounds, ascending, at most `MAX_DESK_RELEASE_DATES`. */
  readonly dates: readonly DateOnly[];
  /** The range held more business days than the contract takes. */
  readonly truncated: boolean;
}

/**
 * The business days of `from..to` (inclusive; no weekends or public holidays), never before
 * `today`. Stops one
 * day past the cap instead of walking an arbitrarily long range, so `truncated`
 * is known without ever holding (or sending) more than the contract's maximum.
 */
export function releaseRange(from: DateOnly, to: DateOnly, today: DateOnly): ReleaseRange {
  const dates: DateOnly[] = [];
  let day = compareDateOnly(from, today) < 0 ? today : from;
  while (compareDateOnly(day, to) <= 0 && dates.length <= MAX_DESK_RELEASE_DATES) {
    if (isBusinessDay(day)) {
      dates.push(day);
    }
    day = addDays(day, 1);
  }
  return {
    dates: dates.slice(0, MAX_DESK_RELEASE_DATES),
    truncated: dates.length > MAX_DESK_RELEASE_DATES,
  };
}
