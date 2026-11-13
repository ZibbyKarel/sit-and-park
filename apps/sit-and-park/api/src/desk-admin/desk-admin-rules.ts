/**
 * The pure halves of desk administration: what an admin edit of a desk does to
 * the bookings hanging off it, and the day's statistics. The services load the
 * rows and apply the verdicts; nothing here reads the database.
 */

import type { AdminDeskStatsOutput } from '@sit-and-park/contract';
import type {
  DeskCleanupCancelReason,
  DeskCleanupRejectReason,
} from '../desks/desk-cleanup.service';
import { isAssignedOn } from '../desks/desk-rules';

/** The admin-editable facts of a desk, before or after an edit. */
export interface DeskEditableFields {
  active: boolean;
  hiveId: string | null;
  officeId: string;
}

export interface DeskChangeEffects {
  /** Cancel the desk's reservations from today on, with this audit reason. */
  cancelReservations: DeskCleanupCancelReason | null;
  /** Reject the desk's pending requests, with this audit reason. */
  rejectRequests: DeskCleanupRejectReason | null;
}

/**
 * The orphan handling the source app lacked (`doc/desk-merge-plan.md`, defect
 * table). Deactivating or moving a desk to another office takes away what was
 * booked on it from today on and what was requested for it; changing (or
 * clearing) its hive only invalidates requests, which were addressed to the
 * old hive's owner — reservations stay valid, they were made with access.
 * The most drastic change names the reason: deactivation, then office, then
 * hive. Reactivating a desk or keeping everything changes nothing.
 */
export function deskChangeEffects(
  before: DeskEditableFields,
  after: DeskEditableFields
): DeskChangeEffects {
  if (before.active && !after.active) {
    return { cancelReservations: 'DESK_DEACTIVATED', rejectRequests: 'DESK_DEACTIVATED' };
  }
  if (before.officeId !== after.officeId) {
    return { cancelReservations: 'DESK_OFFICE_CHANGED', rejectRequests: 'DESK_OFFICE_CHANGED' };
  }
  if (before.hiveId !== after.hiveId) {
    return { cancelReservations: null, rejectRequests: 'DESK_HIVE_CHANGED' };
  }
  return { cancelReservations: null, rejectRequests: null };
}

/** One desk, as the statistics need it. */
export interface StatsDesk {
  id: string;
  officeId: string;
  zoneId: string;
  active: boolean;
  permanentAssigneeId: string | null;
}

export interface StatsInput {
  date: AdminDeskStatsOutput['date'];
  desks: readonly StatsDesk[];
  /** Desks with a reservation that day. */
  reservedDeskIds: ReadonlySet<string>;
  /** Desks whose permanent holder released them that day. */
  releasedDeskIds: ReadonlySet<string>;
  zones: ReadonlyMap<string, { name: string; officeId: string }>;
  offices: ReadonlyMap<string, string>;
  hiveCount: number;
  pendingApprovals: number;
}

/** `round(part / whole * 100)`, `0` for an empty whole, clamped to 0–100. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

/**
 * One pass over the day's desks. "Bookable" = active and not held by a
 * permanent holder who kept it that day. "Reserved" counts reservations on
 * bookable desks only — a reservation on a desk that has since been
 * deactivated, or that a holder took back, is not occupancy of a bookable
 * desk — so `reserved ≤ bookable` and the percentage cannot pass 100 (the
 * source divided all reserved desks by bookable ones).
 */
export function computeDeskStats(input: StatsInput): AdminDeskStatsOutput {
  type ZoneCount = AdminDeskStatsOutput['byZone'][number];
  type OfficeCount = AdminDeskStatsOutput['byOffice'][number];
  const byZone = new Map<string, ZoneCount>();
  const byOffice = new Map<string, OfficeCount>();
  let active = 0;
  let permanent = 0;
  let bookable = 0;
  let reserved = 0;

  for (const desk of input.desks) {
    const isBookable =
      desk.active && !isAssignedOn(desk, { released: input.releasedDeskIds.has(desk.id) });
    const isReserved = isBookable && input.reservedDeskIds.has(desk.id);
    active += desk.active ? 1 : 0;
    permanent += desk.permanentAssigneeId === null ? 0 : 1;
    bookable += isBookable ? 1 : 0;
    reserved += isReserved ? 1 : 0;

    const zone = byZone.get(desk.zoneId) ?? {
      zoneId: desk.zoneId,
      zoneName: input.zones.get(desk.zoneId)?.name ?? '',
      officeId: desk.officeId,
      desks: 0,
      free: 0,
      reserved: 0,
      unavailable: 0,
    };
    zone.desks += 1;
    if (!isBookable) {
      zone.unavailable += 1;
    } else if (isReserved) {
      zone.reserved += 1;
    } else {
      zone.free += 1;
    }
    byZone.set(desk.zoneId, zone);

    const office = byOffice.get(desk.officeId) ?? {
      officeId: desk.officeId,
      officeName: input.offices.get(desk.officeId) ?? '',
      desks: 0,
      reservedOnDate: 0,
    };
    office.desks += 1;
    office.reservedOnDate += isReserved ? 1 : 0;
    byOffice.set(desk.officeId, office);
  }

  const bySizeThenName = <T extends { desks: number }>(name: (row: T) => string) => {
    return (a: T, b: T) => b.desks - a.desks || name(a).localeCompare(name(b));
  };

  return {
    date: input.date,
    totalDesks: input.desks.length,
    activeDesks: active,
    inactiveDesks: input.desks.length - active,
    permanentAssignments: permanent,
    bookableOnDate: bookable,
    reservedOnDate: reserved,
    freeOnDate: bookable - reserved,
    occupancyPercent: percent(reserved, bookable),
    hiveCount: input.hiveCount,
    pendingApprovals: input.pendingApprovals,
    byZone: [...byZone.values()].sort(bySizeThenName((row) => row.zoneName)),
    byOffice: [...byOffice.values()].sort(bySizeThenName((row) => row.officeName)),
  };
}
