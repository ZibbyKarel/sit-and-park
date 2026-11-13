/**
 * Everything the desks day screen decides, as pure functions of the
 * directory — the desk counterpart of `../lot/lot-view.ts`. No React, no
 * copy: translation keys and values only, so a spec can pin every rule.
 */

import {
  addDays,
  compareDateOnly,
  dayOfWeek,
  MAX_DESK_SERIES_DATES,
  MAX_DESK_SERIES_SPAN_DAYS,
  type DateOnly,
} from '@garage/i18n';
import type {
  DeskDirectoryOutput,
  DeskSkipReason,
  DeskStatus,
  DirectoryDesk,
  FloorPlan as FloorPlanKey,
} from '@garage/contract';
import type { FloorPlanShape } from '../ui/floor-plan/floor-plan';

/**
 * The bundled plan for each `Office.floorPlan` key. The only place a plan URL
 * is made: never from user input, and a key without an entry draws no plan.
 */
const FLOOR_PLAN_SRC: Readonly<Record<FloorPlanKey, string>> = {
  praha: '/floorplans/praha.svg',
};

export interface FloorPlanView {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** `null` when the office has no plan (or no plan size): the list is the only view then. */
export function toFloorPlanView(office: DeskDirectoryOutput['office']): FloorPlanView | null {
  const { floorPlan, floorPlanWidth, floorPlanHeight } = office;
  if (floorPlan === null || floorPlanWidth === null || floorPlanHeight === null) return null;
  return { src: FLOOR_PLAN_SRC[floorPlan], width: floorPlanWidth, height: floorPlanHeight };
}

/** Fill colour per status; the keys are `FloorPlanShape.tone`s. Also the legend's swatches. */
export const DESK_TONES: Readonly<Record<DeskStatus, string>> = {
  FREE: 'rgb(var(--background--success-high-default--light))',
  RESERVED_BY_ME: 'rgb(var(--background--informative-strong-default--light))',
  RESERVED: 'rgb(var(--background--neutral-strong-default--light))',
  ASSIGNED: 'rgb(var(--background--warning-medium-default--light))',
  INACTIVE: 'rgb(var(--background--neutral-high-default--light))',
};

/** Legend order: the statuses a viewer looks for first. */
export const DESK_STATUS_ORDER: readonly DeskStatus[] = [
  'FREE',
  'RESERVED_BY_ME',
  'RESERVED',
  'ASSIGNED',
  'INACTIVE',
];

/** `desks.*` key of each status' short label. */
export const DESK_STATUS_KEYS = {
  FREE: 'statusFree',
  RESERVED_BY_ME: 'statusReservedByMe',
  RESERVED: 'statusReserved',
  ASSIGNED: 'statusAssigned',
  INACTIVE: 'statusInactive',
} as const satisfies Record<DeskStatus, string>;

/** `desks.*` key of each skip reason's sentence. */
export const DESK_SKIP_REASON_KEYS = {
  PAST_DATE: 'skipPastDate',
  DESK_ASSIGNED: 'skipDeskAssigned',
  ALREADY_RESERVED_THIS_DESK: 'skipAlreadyThisDesk',
  ALREADY_RESERVED_OTHER_DESK: 'skipAlreadyOtherDesk',
  DESK_TAKEN: 'skipDeskTaken',
} as const satisfies Record<DeskSkipReason, string>;

// --- filters ----------------------------------------------------------------

/** `''` for zone/hive means "any". */
export interface DeskFilter {
  readonly zoneId: string;
  readonly hiveId: string;
  readonly onlyFree: boolean;
  readonly onlyDirect: boolean;
}

export const EMPTY_DESK_FILTER: DeskFilter = {
  zoneId: '',
  hiveId: '',
  onlyFree: false,
  onlyDirect: false,
};

export function matchesDeskFilter(desk: DirectoryDesk, filter: DeskFilter): boolean {
  return (
    (filter.zoneId === '' || desk.zoneId === filter.zoneId) &&
    (filter.hiveId === '' || desk.hiveId === filter.hiveId) &&
    (!filter.onlyFree || desk.status === 'FREE') &&
    (!filter.onlyDirect || desk.access === 'DIRECT')
  );
}

// --- shapes -----------------------------------------------------------------

/** Builds a desk's accessible name; the caller supplies the translated pieces. */
export type DeskAriaLabel = (desk: DirectoryDesk) => string;

/**
 * The text drawn on a desk: the plan's own numbering (`D-037` -> `37`). The full
 * code stays in the accessible name; five characters do not fit a desk drawn
 * 139 units wide at any legible size.
 */
export function deskPlanLabel(code: string): string {
  return code.replace(/^D-0*(?=\d)/, '');
}

/** One plan shape per desk; a desk the filter rejects stays on the plan, faint. */
export function toDeskShapes(
  desks: readonly DirectoryDesk[],
  filter: DeskFilter,
  ariaLabel: DeskAriaLabel
): FloorPlanShape[] {
  return desks.map((desk) => ({
    id: desk.id,
    x: desk.x,
    y: desk.y,
    width: desk.width,
    height: desk.height,
    label: deskPlanLabel(desk.code),
    ariaLabel: ariaLabel(desk),
    tone: desk.status,
    outlineColor: desk.hiveColor ?? undefined,
    dimmed: !matchesDeskFilter(desk, filter),
  }));
}

// --- banner -----------------------------------------------------------------

/**
 * The one special state worth a banner, most binding first: a permanent
 * holder cannot book anything else, so "you have a desk today" is moot for them.
 */
export type DeskBannerView =
  | { readonly kind: 'none' }
  | { readonly kind: 'permanent'; readonly code: string }
  | {
      readonly kind: 'today';
      readonly code: string;
      readonly reservationId: string;
    };

export function toDeskBannerView(desks: readonly DirectoryDesk[]): DeskBannerView {
  const permanent = desks.find((desk) => desk.assignedToMe);
  if (permanent !== undefined) return { kind: 'permanent', code: permanent.code };
  const mine = desks.find((desk) => desk.myReservationId !== null);
  if (mine?.myReservationId) {
    return { kind: 'today', code: mine.code, reservationId: mine.myReservationId };
  }
  return { kind: 'none' };
}

// --- dialog -----------------------------------------------------------------

export type DeskNoteKey =
  | 'notePermanentHolder'
  | 'noteInactive'
  | 'noteAssigned'
  | 'noteReserved'
  | 'noteNoAccess'
  | 'noteApproval'
  | 'noteApprovalNotFree'
  | 'noteHasDeskToday'
  | 'notePendingRequest'
  | 'notePast';

export interface DeskDialogView {
  /** Book this one day (`desk.reserve` with one date). */
  readonly canBookDay: boolean;
  /** Book several days; per-day blockers are the preview's to report. */
  readonly canSeries: boolean;
  readonly canCancel: boolean;
  readonly canRequest: boolean;
  /** Withdraw the viewer's pending request for this desk and day (`desk.cancelRequest`). */
  readonly canCancelRequest: boolean;
  /** Why something is not offered; `null` when nothing needs explaining. */
  readonly note: DeskNoteKey | null;
  /** Who holds the desk that day, if anybody but the viewer. */
  readonly holderName: string | null;
}

export interface DeskDialogContext {
  /** The viewer holds a permanent desk (not necessarily this one). */
  readonly holdsPermanentDesk: boolean;
  /** Code of the desk the viewer already has that day, or `null`. */
  readonly myDeskToday: string | null;
  /** The shown day is before today (Prague). */
  readonly isPast: boolean;
  /** Admins may cancel past reservations; nobody else may. */
  readonly isAdmin: boolean;
}

/**
 * What the dialog offers, mirroring the API's rules so a button is never
 * offered that can only be refused: a permanent holder books nothing; series
 * need direct access to an active desk (the other blockers are per day);
 * one day needs the desk free and the viewer deskless that day; approval is
 * for a free hive desk without direct access, and is not offered again while
 * the viewer's request for that desk and day is pending (withdrawing it is).
 */
export function toDeskDialogView(desk: DirectoryDesk, ctx: DeskDialogContext): DeskDialogView {
  const holderName =
    desk.status === 'RESERVED'
      ? desk.reservedByName
      : desk.status === 'ASSIGNED'
        ? desk.permanentAssigneeName
        : null;
  const canCancel =
    desk.status === 'RESERVED_BY_ME' &&
    desk.myReservationId !== null &&
    (!ctx.isPast || ctx.isAdmin);
  const blocked = ctx.holdsPermanentDesk || desk.status === 'INACTIVE' || ctx.isPast;
  const canSeries = !blocked && desk.access === 'DIRECT';
  const canBookDay = canSeries && desk.status === 'FREE' && ctx.myDeskToday === null;
  const canCancelRequest = desk.myPendingRequestId !== null;
  const canRequest =
    !blocked &&
    !canCancelRequest &&
    desk.access === 'APPROVAL' &&
    desk.status === 'FREE' &&
    ctx.myDeskToday === null;

  const note: DeskNoteKey | null = canCancel
    ? null
    : canCancelRequest
      ? 'notePendingRequest'
      : desk.assignedToMe
        ? null
        : ctx.isPast
          ? 'notePast'
          : ctx.holdsPermanentDesk
            ? 'notePermanentHolder'
            : desk.status === 'INACTIVE'
              ? 'noteInactive'
              : desk.access === 'NONE'
                ? 'noteNoAccess'
                : desk.status === 'ASSIGNED'
                  ? 'noteAssigned'
                  : desk.status === 'RESERVED'
                    ? 'noteReserved'
                    : ctx.myDeskToday !== null
                      ? 'noteHasDeskToday'
                      : desk.access === 'APPROVAL'
                        ? canRequest
                          ? 'noteApproval'
                          : 'noteApprovalNotFree'
                        : null;

  return { canBookDay, canSeries, canCancel, canRequest, canCancelRequest, note, holderName };
}

// --- series -----------------------------------------------------------------

/** ISO weekdays a series can repeat on (Monday–Friday). */
export const SERIES_WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** Weeks whose days all fit the contract's span from the start day (offsets 0..34). */
export const MAX_SERIES_WEEKS = Math.floor(MAX_DESK_SERIES_SPAN_DAYS / 7) + 1;

export interface SeriesInput {
  /** The day the dialog was opened on; week 1 starts here. */
  readonly start: DateOnly;
  /** ISO weekdays to repeat on. */
  readonly weekdays: readonly number[];
  /** 1..{@link MAX_SERIES_WEEKS}. */
  readonly weeks: number;
  /** Individual extra days. */
  readonly extraDates: readonly DateOnly[];
}

export type SeriesProblem = 'empty' | 'tooMany' | 'tooLong';

export interface SeriesView {
  /** Distinct, ascending. */
  readonly dates: DateOnly[];
  /** Why the contract would refuse `dates`; `null` when it would not. */
  readonly problem: SeriesProblem | null;
}

/**
 * The dates a series picks: every chosen weekday in the `weeks * 7` days from
 * `start`, plus the extra days — checked against the contract's limits
 * (`deskSeriesDatesSchema`) so the preview is only asked for a valid list.
 */
export function toSeriesView(input: SeriesInput): SeriesView {
  const picked = new Set<DateOnly>(input.extraDates);
  for (let offset = 0; offset < input.weeks * 7; offset += 1) {
    const day = addDays(input.start, offset);
    if (input.weekdays.includes(dayOfWeek(day))) picked.add(day);
  }
  const dates = [...picked].sort(compareDateOnly);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const problem: SeriesProblem | null =
    first === undefined || last === undefined
      ? 'empty'
      : dates.length > MAX_DESK_SERIES_DATES
        ? 'tooMany'
        : compareDateOnly(last, addDays(first, MAX_DESK_SERIES_SPAN_DAYS)) > 0
          ? 'tooLong'
          : null;
  return { dates, problem };
}
