/**
 * Desk bulk booking, pure: the per-row verdict both `desk.previewBulk` and
 * `desk.confirmBulk` apply, and the allocator that proposes a desk for every
 * (person, day). Same split as `desk-rules.ts`: no database here, the service
 * loads the facts and hands them in.
 */

import type {
  DeskBulkPersonSkipReason,
  DeskBulkPlanRow,
  DeskBulkSkipReason,
} from '@sit-and-park/contract';
import type { DateOnly } from '@sit-and-park/shared-types';
import { compareDateOnly } from '@sit-and-park/shared-types';
import type { DeskCaller, DeskFacts } from './desk-rules';
import { deskAccess, isAssignedOn } from './desk-rules';

/** A person a bulk batch books for: the rule facts plus what bulk adds. */
export interface BulkPerson extends DeskCaller {
  name: string;
  active: boolean;
  preferredDeskId: string | null;
}

/** A desk with what the allocator measures and reports. */
export interface BulkDesk extends DeskFacts {
  code: string;
  zoneId: string;
  zoneName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The day state of every relevant desk and person, keyed by {@link dayKey}. */
export interface BulkFacts {
  /** `dayKey(deskId, date)` → who holds that desk's reservation. */
  holderByDeskDay: ReadonlyMap<string, string>;
  /** `dayKey(userId, date)` → the desk the person already holds that day. */
  deskByPersonDay: ReadonlyMap<string, string>;
  /** `dayKey(deskId, date)` of days a permanent holder released. */
  releasedDeskDays: ReadonlySet<string>;
}

export function dayKey(id: string, date: DateOnly): string {
  return `${id}|${date}`;
}

/**
 * Why `person` cannot get `desk` on `date`; `null` = bookable. With
 * `desk === null` only the person-level reasons are checked (and any desk the
 * person already holds that day counts), so the answer is a
 * {@link DeskBulkPersonSkipReason}. Order: `PAST_DATE`, `USER_INACTIVE`,
 * `NO_OFFICE_ASSIGNED`, `PERMANENT_DESK_HOLDER`, `DESK_NOT_AVAILABLE`,
 * `DESK_ACCESS_DENIED`, `DESK_ASSIGNED`, `ALREADY_RESERVED_THIS_DESK` /
 * `ALREADY_RESERVED_OTHER_DESK`, `DESK_TAKEN`.
 *
 * `overrideHive`: an admin picking by hand may book a hive desk of the
 * person's office the person has no direct access to (`APPROVAL`).
 */
export function bulkRowVerdict(
  person: BulkPerson,
  desk: null,
  date: DateOnly,
  facts: BulkFacts,
  today: DateOnly
): DeskBulkPersonSkipReason | null;
export function bulkRowVerdict(
  person: BulkPerson,
  desk: BulkDesk,
  date: DateOnly,
  facts: BulkFacts,
  today: DateOnly,
  overrideHive?: boolean
): DeskBulkSkipReason | null;
export function bulkRowVerdict(
  person: BulkPerson,
  desk: BulkDesk | null,
  date: DateOnly,
  facts: BulkFacts,
  today: DateOnly,
  overrideHive = false
): DeskBulkSkipReason | null {
  if (compareDateOnly(date, today) < 0) {
    return 'PAST_DATE';
  }
  if (!person.active) {
    return 'USER_INACTIVE';
  }
  if (person.officeId === null) {
    return 'NO_OFFICE_ASSIGNED';
  }
  if (person.permanentDeskId !== null) {
    return 'PERMANENT_DESK_HOLDER';
  }
  const held = facts.deskByPersonDay.get(dayKey(person.id, date)) ?? null;
  if (desk === null) {
    return held === null ? null : 'ALREADY_RESERVED_OTHER_DESK';
  }
  if (!desk.active || desk.officeId !== person.officeId) {
    return 'DESK_NOT_AVAILABLE';
  }
  const access = deskAccess(desk, person);
  if (access !== 'DIRECT' && !(overrideHive && access === 'APPROVAL')) {
    return 'DESK_ACCESS_DENIED';
  }
  if (isAssignedOn(desk, { released: facts.releasedDeskDays.has(dayKey(desk.id, date)) })) {
    return 'DESK_ASSIGNED';
  }
  if (held !== null) {
    return held === desk.id ? 'ALREADY_RESERVED_THIS_DESK' : 'ALREADY_RESERVED_OTHER_DESK';
  }
  if (facts.holderByDeskDay.has(dayKey(desk.id, date))) {
    return 'DESK_TAKEN';
  }
  return null;
}

function distanceSquared(a: BulkDesk, b: BulkDesk): number {
  const dx = a.x + a.width / 2 - (b.x + b.width / 2);
  const dy = a.y + a.height / 2 - (b.y + b.height / 2);
  return dx * dx + dy * dy;
}

function byCode(a: BulkDesk, b: BulkDesk): number {
  return a.code.localeCompare(b.code);
}

/** People with a preferred desk first, then the rest; stable within each group. */
export function allocationOrder<T extends Pick<BulkPerson, 'preferredDeskId'>>(
  people: readonly T[]
): T[] {
  return [
    ...people.filter((person) => person.preferredDeskId !== null),
    ...people.filter((person) => person.preferredDeskId === null),
  ];
}

export interface AllocateInput {
  people: readonly BulkPerson[];
  dates: readonly DateOnly[];
  /** Every desk of the people's offices. */
  desks: readonly BulkDesk[];
  /** Candidate pool; `null` = every desk. */
  pool: ReadonlySet<string> | null;
  facts: BulkFacts;
  today: DateOnly;
}

/**
 * Proposes one row per (person, date), people in {@link allocationOrder},
 * dates ascending. Per person and date: the preferred desk if bookable and in
 * the pool (`isPreferred`); else the nearest bookable pool desk in the
 * anchor's zone; else `UNASSIGNED`. The anchor is the preferred desk when it
 * is in the person's office, active, in the pool and directly accessible; else
 * the bookable pool desk free on most of the person's days (ties: code), so a
 * person keeps one desk across days. Auto-allocation uses direct access only;
 * a desk is given at most once per day across the whole plan.
 */
export function allocateBulk(input: AllocateInput): DeskBulkPlanRow[] {
  const { facts, today } = input;
  const dates = [...input.dates].sort(compareDateOnly);
  const deskById = new Map(input.desks.map((desk) => [desk.id, desk]));
  const planned = new Set<string>();
  const rows: DeskBulkPlanRow[] = [];

  const candidate = (person: BulkPerson, desk: BulkDesk, date: DateOnly): boolean =>
    (input.pool === null || input.pool.has(desk.id)) &&
    !planned.has(dayKey(desk.id, date)) &&
    bulkRowVerdict(person, desk, date, facts, today) === null;

  for (const person of allocationOrder(input.people)) {
    const open: DateOnly[] = [];
    for (const date of dates) {
      const reason = bulkRowVerdict(person, null, date, facts, today);
      if (reason === null) {
        open.push(date);
      } else {
        rows.push({ outcome: 'UNAVAILABLE', userId: person.id, date, reason });
      }
    }
    if (open.length === 0) {
      continue;
    }

    const preferred =
      person.preferredDeskId === null ? undefined : deskById.get(person.preferredDeskId);
    // Only a preferred desk the person could be given ever anchors; one outside
    // the pool (or the office, inactive, hive without direct access) would pull
    // the zone away from every desk actually on offer.
    const usable =
      preferred !== undefined &&
      preferred.officeId === person.officeId &&
      preferred.active &&
      (input.pool === null || input.pool.has(preferred.id)) &&
      deskAccess(preferred, person) === 'DIRECT'
        ? preferred
        : undefined;
    const anchor =
      usable ?? mostFreeDesk(input.desks, open, (desk, date) => candidate(person, desk, date));

    for (const date of open) {
      let chosen: BulkDesk | undefined;
      if (usable !== undefined && candidate(person, usable, date)) {
        chosen = usable;
      } else if (anchor !== undefined) {
        chosen = input.desks
          .filter((desk) => desk.zoneId === anchor.zoneId && candidate(person, desk, date))
          .sort(
            (a, b) => distanceSquared(a, anchor) - distanceSquared(b, anchor) || byCode(a, b)
          )[0];
      }
      if (chosen === undefined) {
        rows.push({ outcome: 'UNASSIGNED', userId: person.id, date });
        continue;
      }
      planned.add(dayKey(chosen.id, date));
      rows.push({
        outcome: 'ASSIGNED',
        userId: person.id,
        date,
        deskId: chosen.id,
        deskCode: chosen.code,
        zoneName: chosen.zoneName,
        isPreferred: chosen.id === person.preferredDeskId,
      });
    }
  }
  // Person order, then date: UNAVAILABLE and the rest were pushed in two passes.
  const order = new Map(allocationOrder(input.people).map((person, index) => [person.id, index]));
  return rows.sort(
    (a, b) =>
      (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0) || compareDateOnly(a.date, b.date)
  );
}

/** The desk `free` holds for on most of `dates`; ties by code; none if never free. */
function mostFreeDesk(
  desks: readonly BulkDesk[],
  dates: readonly DateOnly[],
  free: (desk: BulkDesk, date: DateOnly) => boolean
): BulkDesk | undefined {
  let best: { desk: BulkDesk; count: number } | undefined;
  for (const desk of [...desks].sort(byCode)) {
    const count = dates.filter((date) => free(desk, date)).length;
    if (count > 0 && (best === undefined || count > best.count)) {
      best = { desk, count };
    }
  }
  return best?.desk;
}
