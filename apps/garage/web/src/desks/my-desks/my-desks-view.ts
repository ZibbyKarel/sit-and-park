/**
 * The decisions behind "Moje stoly", as pure functions: which reservations are
 * upcoming, how a month lays out as a Monday-to-Friday grid, and which days a
 * "release my desk" date range turns into. No React, no network.
 *
 * "Today" is always an argument (`todayInPrague()` at the call site), never read
 * here, so every rule below is testable around the day boundary.
 */

import {
  MAX_DESK_RELEASE_DATES,
  addDays,
  compareDateOnly,
  isWeekend,
  startOfMonth,
  type DateOnly,
} from '@garage/i18n';
import type { MyDeskReleasesOutput, MyDeskReservation } from '@garage/contract';
import { buildCalendarGrid } from '../../lot/calendar-grid';

export interface SplitReservations {
  /** Today and later, ascending. */
  readonly upcoming: readonly MyDeskReservation[];
  /** Before today, newest first. */
  readonly history: readonly MyDeskReservation[];
}

/** Today counts as upcoming: the holder can still cancel it. */
export function splitReservations(
  reservations: readonly MyDeskReservation[],
  today: DateOnly
): SplitReservations {
  const upcoming = reservations
    .filter((reservation) => compareDateOnly(reservation.date, today) >= 0)
    .sort((a, b) => compareDateOnly(a.date, b.date));
  const history = reservations
    .filter((reservation) => compareDateOnly(reservation.date, today) < 0)
    .sort((a, b) => compareDateOnly(b.date, a.date));
  return { upcoming, history };
}

/** `Zóna · Hive`, the hive omitted when the desk has none. */
export function reservationDetail(reservation: MyDeskReservation): string {
  return [reservation.zoneName, reservation.hiveName].filter((part) => part !== null).join(' · ');
}

// --- calendar ---------------------------------------------------------------

export type CalendarChip =
  | { readonly kind: 'reservation'; readonly id: string; readonly code: string }
  | { readonly kind: 'permanent'; readonly code: string }
  | { readonly kind: 'released'; readonly code: string };

export interface CalendarCell {
  readonly date: DateOnly;
  readonly day: number;
  readonly isToday: boolean;
  readonly isPast: boolean;
  readonly chips: readonly CalendarChip[];
}

/**
 * The month containing `anchor`, Monday to Friday only (weekends carry no
 * bookings), as weeks of five slots with `null` for days of a neighbouring
 * month. A week that would be empty is dropped.
 *
 * A permanent holder also gets a chip on every working day from today on,
 * `released` where they freed the desk and no reservation chip of their own.
 */
export function buildBookingsCalendar(
  anchor: DateOnly,
  reservations: readonly MyDeskReservation[],
  permanent: MyDeskReleasesOutput,
  today: DateOnly
) {
  const released = new Set(permanent?.releases.map((release) => release.date));
  const grid = buildCalendarGrid<CalendarCell>(anchor, (date) => {
    const chips: CalendarChip[] = reservations
      .filter((reservation) => reservation.date === date)
      .map((reservation) => ({
        kind: 'reservation' as const,
        id: reservation.id,
        code: reservation.deskCode,
      }));
    if (permanent !== null && compareDateOnly(date, today) >= 0) {
      chips.push(
        released.has(date)
          ? { kind: 'released', code: permanent.code }
          : { kind: 'permanent', code: permanent.code }
      );
    }
    return {
      date,
      day: Number(date.slice(8)),
      isToday: date === today,
      isPast: compareDateOnly(date, today) < 0,
      chips,
    };
  });

  const weeks = grid.weeks
    .map((week) => ({
      key: week.key,
      slots: week.slots.slice(0, 5).map((slot) => ({
        key: slot.key,
        // A weekend can never be a booking day, so a cell is a weekday by
        // construction; the check only keeps the invariant visible.
        day: slot.day !== null && !isWeekend(slot.day.date) ? slot.day : null,
      })),
    }))
    .filter((week) => week.slots.some((slot) => slot.day !== null));

  const monthCount = reservations.filter(
    (reservation) => startOfMonth(reservation.date) === startOfMonth(anchor)
  ).length;

  return { month: grid.month, weeks, monthCount };
}

// --- release range ----------------------------------------------------------

export interface ReleaseRange {
  /** Monday to Friday between the bounds, ascending, at most `MAX_DESK_RELEASE_DATES`. */
  readonly dates: readonly DateOnly[];
  /** The range held more working days than the contract takes. */
  readonly truncated: boolean;
}

/**
 * The working days of `from..to` (inclusive), never before `today`. Stops one
 * day past the cap instead of walking an arbitrarily long range, so `truncated`
 * is known without ever holding (or sending) more than the contract's maximum.
 */
export function releaseRange(from: DateOnly, to: DateOnly, today: DateOnly): ReleaseRange {
  const dates: DateOnly[] = [];
  let day = compareDateOnly(from, today) < 0 ? today : from;
  while (compareDateOnly(day, to) <= 0 && dates.length <= MAX_DESK_RELEASE_DATES) {
    if (!isWeekend(day)) {
      dates.push(day);
    }
    day = addDays(day, 1);
  }
  return {
    dates: dates.slice(0, MAX_DESK_RELEASE_DATES),
    truncated: dates.length > MAX_DESK_RELEASE_DATES,
  };
}
