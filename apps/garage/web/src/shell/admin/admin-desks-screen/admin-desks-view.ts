/**
 * What the admin desk screen decides, as pure functions: selection, filter,
 * plan shapes and what a change would set off. No React, no copy.
 */

import type { AdminDesk, AdminDeskStatus } from '@garage/contract';
import type { FloorPlanShape } from '../../../ui/floor-plan/floor-plan';
import { DESK_TONES, deskPlanLabel } from '../../../desks/desk-view';

/** Fill colour per admin status (the keys are `FloorPlanShape.tone`s). */
export const ADMIN_DESK_TONES: Readonly<Record<AdminDeskStatus, string>> = DESK_TONES;

/** Legend and sort order. */
export const ADMIN_STATUS_ORDER: readonly AdminDeskStatus[] = [
  'FREE',
  'RESERVED',
  'ASSIGNED',
  'INACTIVE',
];

/** `adminDesks.*` key of each status' label. */
export const ADMIN_STATUS_KEYS = {
  FREE: 'statusFree',
  RESERVED: 'statusReserved',
  ASSIGNED: 'statusAssigned',
  INACTIVE: 'statusInactive',
} as const satisfies Record<AdminDeskStatus, string>;

// --- selection --------------------------------------------------------------

/** Adds `id`, or removes it when it is already selected. */
export function toggleDesk(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A plan click: Ctrl/Cmd toggles, a plain click selects only that desk (or clears it if it was the only one). */
export function selectDesk(selected: ReadonlySet<string>, id: string, multi: boolean): Set<string> {
  if (multi) return toggleDesk(selected, id);
  return selected.size === 1 && selected.has(id) ? new Set() : new Set([id]);
}

/** Adds every desk of `zoneId` to the selection. */
export function selectZone(
  selected: ReadonlySet<string>,
  desks: readonly AdminDesk[],
  zoneId: string
): Set<string> {
  const next = new Set(selected);
  for (const desk of desks) if (desk.zoneId === zoneId) next.add(desk.id);
  return next;
}

/** Drops ids that are no longer listed (a reload, another office or date). Same set when nothing drops. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  desks: readonly AdminDesk[]
): ReadonlySet<string> {
  const listed = new Set(desks.map((desk) => desk.id));
  const kept = [...selected].filter((id) => listed.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

// --- filter and shapes ------------------------------------------------------

/** `''` = any. */
export interface AdminDeskFilter {
  readonly zoneId: string;
  readonly hiveId: string;
}

export const EMPTY_ADMIN_FILTER: AdminDeskFilter = { zoneId: '', hiveId: '' };

export function matchesAdminFilter(desk: AdminDesk, filter: AdminDeskFilter): boolean {
  return (
    (filter.zoneId === '' || desk.zoneId === filter.zoneId) &&
    (filter.hiveId === '' || desk.hiveId === filter.hiveId)
  );
}

export function toAdminShapes(
  desks: readonly AdminDesk[],
  filter: AdminDeskFilter,
  ariaLabel: (desk: AdminDesk) => string
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
    dimmed: !matchesAdminFilter(desk, filter),
  }));
}

/** Who holds the desk that day: the permanent holder, else whoever reserved it. */
export function holderName(desk: AdminDesk): string {
  return (desk.status === 'ASSIGNED' ? desk.permanentAssigneeName : desk.reservedByName) ?? '';
}

// --- what a change sets off -------------------------------------------------

/** What the API does to bookings when a desk changes. */
export interface DeskImpact {
  /** Future reservations of the desk are cancelled. */
  readonly cancelsReservations: boolean;
  /** Pending approval requests for the desk are rejected. */
  readonly rejectsRequests: boolean;
}

/** The fields of one desk the editor changes. */
export interface DeskDraft {
  readonly active: boolean;
  readonly hiveId: string | null;
  readonly officeId: string;
  readonly zoneId: string;
}

export interface DeskPatch {
  active?: boolean;
  hiveId?: string | null;
  officeId?: string;
  zoneId?: string;
}

/** Only the fields that differ from the desk; `{}` when nothing changed. */
export function toDeskPatch(desk: AdminDesk, draft: DeskDraft): DeskPatch {
  const patch: DeskPatch = {};
  if (draft.active !== desk.active) patch.active = draft.active;
  if (draft.hiveId !== desk.hiveId) patch.hiveId = draft.hiveId;
  if (draft.officeId !== desk.officeId) patch.officeId = draft.officeId;
  if (draft.zoneId !== desk.zoneId) patch.zoneId = draft.zoneId;
  return patch;
}

/** `null` when the patch (a zone move inside the office, say) touches no booking. */
export function patchImpact(patch: DeskPatch): DeskImpact | null {
  const office = patch.officeId !== undefined;
  const cancelsReservations = patch.active === false || office;
  const rejectsRequests = patch.active !== undefined || patch.hiveId !== undefined || office;
  return cancelsReservations || rejectsRequests ? { cancelsReservations, rejectsRequests } : null;
}

/** The same for a bulk change, looking only at the desks it would actually change. */
export function bulkImpact(
  desks: readonly AdminDesk[],
  change: { active?: boolean | undefined; hiveId?: string | null | undefined }
): DeskImpact | null {
  const { active, hiveId } = change;
  const cancelsReservations = active === false && desks.some((desk) => desk.active);
  const rejectsRequests =
    (active !== undefined && desks.some((desk) => desk.active !== active)) ||
    (hiveId !== undefined && desks.some((desk) => desk.hiveId !== hiveId));
  return cancelsReservations || rejectsRequests ? { cancelsReservations, rejectsRequests } : null;
}
