/**
 * Everything the desk bulk modal decides, as pure functions (the same split as
 * `../../lot/bulk-modal/bulk-view.ts`): the editable plan on top of the
 * server's preview, the assignments that get confirmed, and the comparison of
 * the confirm result with what was sent. The month grid itself is parking's
 * (`buildMonthGrid`).
 */

import { toContractError } from '@sit-and-park/api-client';
import type { DeskBulkConfirmOutput, DeskBulkPreviewOutput } from '@sit-and-park/contract';
import type { DateOnly } from '@sit-and-park/i18n';
import type { DeskBulkSkipReason } from '@sit-and-park/shared-types';

/** The select's "no desk for this day" value. */
export const NO_DESK = '';

/** `userId|date`, the identity of one plan row. */
export function rowKey(userId: string, date: DateOnly): string {
  return `${userId}|${date}`;
}

/**
 * The user's hand edits on top of the proposal: row key -> desk id, or `null`
 * for "book nothing that day". A row without an entry keeps what the server
 * proposed.
 */
export type DeskPicks = Readonly<Record<string, string | null>>;

export interface DeskChoice {
  readonly id: string;
  readonly code: string;
  readonly zoneName: string;
}

interface PlanRowBase {
  readonly key: string;
  readonly userId: string;
  readonly personName: string;
  readonly date: DateOnly;
}

export type PlanRowView =
  | (PlanRowBase & {
      readonly kind: 'BOOKABLE';
      /** The desk that will be booked, `null` while none is chosen. */
      readonly deskId: string | null;
      /** The proposed preferred desk, untouched by hand. */
      readonly isPreferred: boolean;
      /** Free desks that day not used by another row of the plan, the current one included. */
      readonly choices: readonly DeskChoice[];
    })
  | (PlanRowBase & { readonly kind: 'UNAVAILABLE'; readonly reason: DeskBulkSkipReason });

function personName(preview: DeskBulkPreviewOutput, userId: string): string {
  return preview.people.find((person) => person.id === userId)?.name ?? userId;
}

/** The desk each bookable row ends with, by row key. */
function effectiveDesks(
  preview: DeskBulkPreviewOutput,
  picks: DeskPicks
): ReadonlyMap<string, string | null> {
  const desks = new Map<string, string | null>();
  for (const row of preview.rows) {
    if (row.outcome === 'UNAVAILABLE') continue;
    const key = rowKey(row.userId, row.date);
    const proposed = row.outcome === 'ASSIGNED' ? row.deskId : null;
    desks.set(key, key in picks ? (picks[key] ?? null) : proposed);
  }
  return desks;
}

/** Every desk the preview names, for labels. */
export function deskCatalog(preview: DeskBulkPreviewOutput): ReadonlyMap<string, DeskChoice> {
  const catalog = new Map<string, DeskChoice>();
  for (const day of preview.freeDesks) {
    for (const desk of day.desks) catalog.set(desk.id, desk);
  }
  for (const row of preview.rows) {
    if (row.outcome === 'ASSIGNED') {
      catalog.set(row.deskId, { id: row.deskId, code: row.deskCode, zoneName: row.zoneName });
    }
  }
  return catalog;
}

/** The preview with the user's picks applied. */
export function buildPlan(preview: DeskBulkPreviewOutput, picks: DeskPicks): PlanRowView[] {
  const desks = effectiveDesks(preview, picks);
  const catalog = deskCatalog(preview);
  const officeOf = new Map(preview.people.map((person) => [person.id, person.officeId]));

  return preview.rows.map((row): PlanRowView => {
    const base = {
      key: rowKey(row.userId, row.date),
      userId: row.userId,
      personName: personName(preview, row.userId),
      date: row.date,
    };
    if (row.outcome === 'UNAVAILABLE') {
      return { ...base, kind: 'UNAVAILABLE', reason: row.reason };
    }
    const deskId = desks.get(base.key) ?? null;
    const usedElsewhere = new Set<string>();
    for (const other of preview.rows) {
      const otherKey = rowKey(other.userId, other.date);
      const otherDesk = desks.get(otherKey);
      if (other.date === row.date && otherKey !== base.key && otherDesk) {
        usedElsewhere.add(otherDesk);
      }
    }
    const free =
      preview.freeDesks.find(
        (day) => day.date === row.date && day.officeId === officeOf.get(row.userId)
      )?.desks ?? [];
    const choices = free.filter((desk) => !usedElsewhere.has(desk.id));
    const current = deskId === null ? undefined : catalog.get(deskId);
    return {
      ...base,
      kind: 'BOOKABLE',
      deskId,
      isPreferred: row.outcome === 'ASSIGNED' && row.isPreferred && deskId === row.deskId,
      choices:
        current !== undefined && !choices.some((desk) => desk.id === current.id)
          ? [...choices, current].sort((a, b) => a.code.localeCompare(b.code))
          : choices,
    };
  });
}

export interface PlanSummary {
  readonly booked: number;
  readonly unassigned: number;
  readonly unavailable: number;
}

export function summarizePlan(plan: readonly PlanRowView[]): PlanSummary {
  let booked = 0;
  let unassigned = 0;
  let unavailable = 0;
  for (const row of plan) {
    if (row.kind === 'UNAVAILABLE') unavailable += 1;
    else if (row.deskId === null) unassigned += 1;
    else booked += 1;
  }
  return { booked, unassigned, unavailable };
}

/** Only rows with a desk are sent. */
export function toAssignments(
  plan: readonly PlanRowView[]
): { userId: string; date: DateOnly; deskId: string }[] {
  return plan.flatMap((row) =>
    row.kind === 'BOOKABLE' && row.deskId !== null
      ? [{ userId: row.userId, date: row.date, deskId: row.deskId }]
      : []
  );
}

export interface ResultLine {
  readonly key: string;
  readonly personName: string;
  readonly date: DateOnly;
  readonly deskCode: string;
}

export interface SkippedLine extends ResultLine {
  readonly reason: DeskBulkSkipReason;
}

export interface ResultView {
  readonly reserved: readonly ResultLine[];
  readonly skipped: readonly SkippedLine[];
  /** Skipped rows the preview had promised a desk for: the plan changed under the user. */
  readonly brokenPromises: number;
}

/** What `confirmBulk` did, set against the assignments that were sent. */
export function toResultView(
  preview: DeskBulkPreviewOutput,
  output: DeskBulkConfirmOutput
): ResultView {
  const catalog = deskCatalog(preview);
  const codeOf = (deskId: string) => catalog.get(deskId)?.code ?? deskId;
  const proposed = new Set(
    preview.rows.flatMap((row) =>
      row.outcome === 'ASSIGNED' ? [rowKey(row.userId, row.date)] : []
    )
  );
  const skipped = output.skipped.map((row) => ({
    key: rowKey(row.userId, row.date),
    personName: personName(preview, row.userId),
    date: row.date,
    deskCode: codeOf(row.deskId),
    reason: row.reason,
  }));
  return {
    reserved: output.reserved.map((row) => ({
      key: rowKey(row.userId, row.date),
      personName: personName(preview, row.userId),
      date: row.date,
      deskCode: codeOf(row.deskId),
    })),
    skipped,
    brokenPromises: skipped.filter((row) => proposed.has(row.key)).length,
  };
}

export const SKIP_REASON_KEYS = {
  PAST_DATE: 'skipPastDate',
  DESK_ASSIGNED: 'skipDeskAssigned',
  ALREADY_RESERVED_THIS_DESK: 'skipAlreadyThisDesk',
  ALREADY_RESERVED_OTHER_DESK: 'skipAlreadyOtherDesk',
  DESK_TAKEN: 'skipDeskTaken',
  DESK_NOT_AVAILABLE: 'skipDeskNotAvailable',
  DESK_ACCESS_DENIED: 'skipDeskAccessDenied',
  PERMANENT_DESK_HOLDER: 'skipPermanentHolder',
  NO_OFFICE_ASSIGNED: 'skipNoOffice',
  USER_INACTIVE: 'skipUserInactive',
} as const satisfies Record<DeskBulkSkipReason, string>;

export type DeskBulkErrorKey =
  | 'errorForbidden'
  | 'errorNotFound'
  | 'errorConflict'
  | 'errorUnknown';

/** The three whole-call errors the procedures declare; everything else is unknown. */
export function toDeskBulkErrorKey(error: unknown): DeskBulkErrorKey {
  switch (toContractError(error)?.code) {
    case 'FORBIDDEN':
      return 'errorForbidden';
    case 'NOT_FOUND':
      return 'errorNotFound';
    case 'CONFLICT':
      return 'errorConflict';
    default:
      return 'errorUnknown';
  }
}
