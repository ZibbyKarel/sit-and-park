/**
 * Entity schemas — the single source of truth for every shape that crosses the
 * FE ↔ BE boundary, per `plan.md` §"Doménový model" plus the extensions from
 * `doc/decision/0004-mvp-scope-includes-design-features.md`.
 *
 * These describe entities as the API *returns* them. Request payloads (create,
 * update, filter) are derived from them in Task 4 with `.pick()`, `.omit()` and
 * `.partial()` rather than written out again.
 */

import * as z from 'zod';
import { EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT } from '@garage/shared-types';
import {
  deskApprovalStatusSchema,
  employeeSyncModeSchema,
  employeeSyncStatusSchema,
  floorPlanSchema,
  parkingGroupSchema,
  userRoleSchema,
} from './enums';
import { dateOnlySchema, halfHourTimeSchema, idSchema, timestampSchema } from './primitives';

/**
 * An employee. Offboarding deactivates a user (`active: false`) instead of
 * deleting the row, so foreign keys from reservations and the audit log stay
 * intact.
 */
export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  name: z.string().min(1),
  /** Czech licence plate ("SPZ"); optional, used to identify a parked car. */
  licensePlate: z.string().min(1).nullable(),
  role: userRoleSchema,
  /** Subject claim of the Okta token; the identity we provision against. */
  oktaId: z.string().min(1),
  active: z.boolean(),
  /** Secret in the personal ICS feed URL; regenerating it invalidates the old URL. */
  icsToken: z.string().min(1),
  /** First choice when bulk booking. Never applied to a single-day reservation. */
  preferredParkingSpotId: idSchema.nullable(),
  /** The office whose desks and spots the user sees and books; `null` = none yet. */
  officeId: idSchema.nullable(),
  /** HiBob employee id, set by the employee sync. Unique. */
  hibobId: z.string().min(1).nullable(),
  /** `true` = the employee sync never touches this account. */
  manualAccount: z.boolean(),
  /** When the user was deactivated; `active` stays the switch the guard reads. */
  deactivatedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;

/**
 * How one user appears to **another** user.
 *
 * Deliberately a `pick` of three fields: the parking screen shows who parks
 * where and which car it is, and nothing else. `email`, `oktaId` and above all
 * `icsToken` (the secret in a personal feed URL) must never reach another
 * user's browser, and picking from `userSchema` means adding a field to the
 * entity cannot silently widen this one.
 *
 * It lives among the entities rather than in `api/` because **both** entry
 * points need it: the day overview returns it, and the realtime events
 * broadcast it into a day room. `src/realtime` must not import from `src/api`,
 * so a projection shared by the two belongs here (Task 5).
 */
export const userSummarySchema = userSchema.pick({
  id: true,
  name: true,
  licensePlate: true,
});
export type UserSummary = z.infer<typeof userSummarySchema>;

/**
 * A physical parking spot. Retired spots are deactivated rather than deleted,
 * for the same foreign-key reason as users.
 */
export const parkingSpotSchema = z.object({
  id: idSchema,
  /** Label painted on the spot, e.g. `E2.92`. Unique across the lot. */
  label: z.string().min(1),
  group: parkingGroupSchema,
  active: z.boolean(),
  /**
   * Seen by admins only. Every read path a normal user reaches leaves it out —
   * the lot, the preferred-spot picker, bulk booking, the Slack digest, the
   * realtime broadcasts — except the viewer's own reservation or queue entry on
   * it. An admin can still book it for anybody. Not a retirement: `active` is
   * independent. `doc/decision/0316-hidden-spots-are-seen-and-booked-by-admins-only`.
   */
  hidden: z.boolean(),
  /**
   * The spot has a charger for electric cars. Informational only: every
   * viewer sees it (the lot tile's green bolt), and nothing about reserving,
   * bulk booking, the waitlist or the cap reads it.
   * `doc/decision/0317-the-ev-charger-flag-is-informational-and-shown-to-everyone`.
   */
  evCharger: z.boolean(),
  /** The office the spot belongs to; users see and book spots of their own office. */
  officeId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type ParkingSpot = z.infer<typeof parkingSpotSchema>;

/**
 * One spot booked for one day, by exactly one holder: a user, or a guest an
 * admin booked it for.
 *
 * **`userId` is nullable and `guestName` is nullable, but never both, and never
 * neither** — a `CHECK` constraint enforces that in the database
 * (`doc/decision/0305-a-reservation-holder-is-a-user-or-a-guest-never-neither`). Two unique constraints back the rest up:
 * `(parkingSpotId, date)` — one reservation per spot per day, the double-booking
 * guarantee — and `(userId, date)`, one reservation per user per day. `NULL`s do
 * not collide in a Postgres unique index, so the second one deliberately does
 * not limit guests: several guests may visit on the same day.
 */
export const reservationSchema = z.object({
  id: idSchema,
  parkingSpotId: idSchema,
  /** `null` for a guest reservation; then `guestName` is set. */
  userId: idSchema.nullable(),
  /** Set only for a guest. A guest has no `User` row to read a name off. */
  guestName: z.string().min(1).nullable(),
  /**
   * Overrides the holder's stored `User.licensePlate` for this day only, and is
   * the *only* plate a guest can have. `null` means "use the holder's stored
   * one" — this flow never writes `User.licensePlate`.
   */
  licensePlate: z.string().min(1).nullable(),
  date: dateOnlySchema,
  createdAt: timestampSchema,
});
export type Reservation = z.infer<typeof reservationSchema>;

/**
 * Who holds a reservation, as everybody who can see the day sees them.
 *
 * A discriminated union rather than a widened user summary, because a guest has
 * no `User` row and the type has to say so: `kind: 'GUEST'` has **no `userId`
 * member at all**, so `holder.userId` on a guest is a compile error rather than
 * a `null` every reader has to remember to check. That is the property
 * `doc/decision/0304-the-reservation-holder-projection-is-a-discriminated-union` was written to keep.
 *
 * `name` and `licensePlate` are the **effective** values — the server has
 * already applied `Reservation.licensePlate` over the holder's stored one — so a
 * consumer renders them without knowing the override exists.
 *
 * Only `userId` may be compared against the viewer's own id; `name` is not an
 * identity. `email`, `oktaId` and above all `icsToken` (the secret in a personal
 * feed URL) are absent by construction, the same reason `userSummarySchema` is a
 * `pick`.
 */
export const reservationHolderSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('USER'),
    userId: idSchema,
    name: z.string().min(1),
    licensePlate: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal('GUEST'),
    name: z.string().min(1),
    licensePlate: z.string().min(1).nullable(),
  }),
]);
export type ReservationHolder = z.infer<typeof reservationHolderSchema>;

/**
 * A reservation as it is shown to everybody who can see the day: which
 * reservation it is, when it was made, and who holds it.
 *
 * `parkingSpotId`, the holder's row and `date` are deliberately absent — every
 * consumer already knows all three from its surrounding context (the spot row of
 * the day overview, the event payload of a realtime broadcast).
 *
 * The field is `holder`, not `user`: a field called `user` cannot carry a guest,
 * and renaming it is what forced every reader to be revisited rather than
 * silently reading `undefined` (`doc/decision/0304-the-reservation-holder-projection-is-a-discriminated-union`).
 *
 * Shared by `src/api` and `src/realtime`, for the reason given on
 * {@link userSummarySchema}.
 */
export const publicReservationSchema = reservationSchema
  .pick({ id: true, createdAt: true })
  .extend({ holder: reservationHolderSchema });
export type PublicReservation = z.infer<typeof publicReservationSchema>;

/**
 * A guest booked into a half-hour-granular block of one day, on one spot.
 *
 * A separate entity from `Reservation`, not a variant of it: a timed block is
 * always for a guest (no `userId` at all — an employee books the whole day,
 * unchanged), and a spot may hold **many** of them on one day, whereas
 * `Reservation` is one-per-spot-per-day and every existing flow — the unique
 * constraint, the waitlist, the ICS feed — depends on that being true. Mixing
 * the two into one table would have made every one of those readers handle a
 * case that does not apply to it.
 *
 * A spot cannot have both a full-day `Reservation` and any `TimedReservation`
 * rows for the same day; a database trigger enforces the exclusivity rather
 * than application code, because every writer of either table must obey it
 * (`doc/decision/0314-*`).
 *
 * **Deliberately not `.refine()`d**: Zod v4 refuses `.pick()`/`.extend()` on a
 * refined object, and `publicTimedReservationSchema` below needs to `.pick()`
 * from this one. The `startTime < endTime` ordering lives on
 * `createTimedReservationInputSchema` instead.
 */
export const timedReservationSchema = z.object({
  id: idSchema,
  parkingSpotId: idSchema,
  date: dateOnlySchema,
  /** Inclusive start, `HH:MM` on a half hour. */
  startTime: halfHourTimeSchema,
  /** Exclusive end, `HH:MM` on a half hour; `24:00` means "until midnight". */
  endTime: halfHourTimeSchema,
  guestName: z.string().min(1),
  licensePlate: z.string().min(1).nullable(),
  createdAt: timestampSchema,
});
export type TimedReservation = z.infer<typeof timedReservationSchema>;

/**
 * A timed block as everybody who can see the day sees it.
 *
 * `parkingSpotId` and `date` are absent for the same reason as on
 * `publicReservationSchema`: every consumer already knows both from its
 * surrounding context (the spot row of the day overview, the realtime event's
 * `cellRef`).
 */
export const publicTimedReservationSchema = timedReservationSchema.pick({
  id: true,
  startTime: true,
  endTime: true,
  guestName: true,
  licensePlate: true,
  createdAt: true,
});
export type PublicTimedReservation = z.infer<typeof publicTimedReservationSchema>;

/**
 * A user waiting for an already-booked spot on a given day. Queue order is
 * `createdAt`, with `id` as the tiebreaker.
 */
export const waitlistEntrySchema = z.object({
  id: idSchema,
  parkingSpotId: idSchema,
  userId: idSchema,
  date: dateOnlySchema,
  createdAt: timestampSchema,
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/**
 * Audit log actions.
 *
 * Deliberately a closed enum: contract-first means a new action must be added
 * here before any service can write it. The list starts with the actions named
 * in `plan.md` §"Doménový model"; later tasks extend it as they introduce
 * further mutations.
 */
export const AUDIT_LOG_ACTIONS = [
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'RESERVATION_CANCELLED_BY_ADMIN',
  'WAITLIST_PROMOTED',
  'USER_UPDATED',
  'SPOT_UPDATED',
  /**
   * An admin changed `openDaysBefore` or `lockMode`. Added by Task 12, which is
   * the task that made the change possible: the reservation-window settings are
   * a singleton whose two fields decide, for every user, whether a month can be
   * booked at all, and `plan.md` requires that change to be audited. The
   * existing members all name a row that was created or deleted, so none of them
   * could describe it (`doc/decision/0059-*`).
   */
  'RESERVATION_WINDOW_UPDATED',
  /**
   * Somebody was put into a spot's queue for a day. Added by Task 30, which
   * needed it: bulk booking creates queue entries on the user's behalf, and
   * `plan.md` requires every row a mutation creates to be accounted for.
   *
   * The existing members could not describe it — `WAITLIST_PROMOTED` is the
   * *opposite* event (an entry being consumed), and the reservation members name
   * a different table. Both procedures that create a queue entry write it
   * (`waitlist.join` and `reservation.confirmBulk`): an audit action whose
   * presence depends on which endpoint the row arrived through is not an audit
   * trail. See `doc/decision/0091-*`.
   */
  'WAITLIST_JOINED',
  /**
   * An admin created a reservation whose holder is not themselves — another
   * user, or a guest. `RESERVATION_CREATED` stays what it has always been: the
   * holder took the spot for themselves, admin or not.
   *
   * One member rather than two, because "for a guest" is not a different action,
   * it is a different holder: the payload carries `holderUserId` **or**
   * `guestName`, and the audit trail reads the same either way
   * (`doc/decision/0306-an-admin-names-the-holder-and-defaults-to-themselves`).
   */
  'RESERVATION_CREATED_BY_ADMIN',
  /**
   * An admin queued somebody else for a spot's waitlist. `WAITLIST_JOINED`
   * stays what it has always meant: the queued person joined for themselves,
   * admin or not — mirrors `RESERVATION_CREATED_BY_ADMIN` beside it, and for
   * the same reason: the audit trail has to say who acted and on whose
   * behalf.
   */
  'WAITLIST_JOINED_BY_ADMIN',
  /**
   * An admin changed a reservation limit — today, the monthly cap. Added by
   * TODO item 2, the change that made it possible: the cap became an admin
   * setting, and a single row that decides how much *every* user may book is
   * exactly the kind of change `plan.md` requires audited.
   *
   * `RESERVATION_WINDOW_UPDATED` could not describe it: that member names the
   * window singleton, whose fields decide whether a month is open at all, and
   * an audit action shared between two unrelated settings tables is not an
   * audit trail. See `doc/decision/0312-*`.
   */
  'RESERVATION_LIMITS_UPDATED',
  /**
   * An admin booked a guest into a half-hour block. Not `RESERVATION_CREATED_BY_ADMIN`:
   * that member names a row in the `Reservation` table, and a timed block is a
   * different table with a different exclusivity rule (`doc/decision/0314-*`).
   */
  'TIMED_RESERVATION_CREATED',
  /**
   * An admin removed a timed block. Mirrors `TIMED_RESERVATION_CREATED` for the
   * same reason `RESERVATION_CANCELLED_BY_ADMIN` mirrors `RESERVATION_CREATED_BY_ADMIN`:
   * the row it names lives in a different table from `Reservation`.
   */
  'TIMED_RESERVATION_CANCELLED',
  /*
   * Desk booking (`doc/desk-merge-plan.md`). The desk members mirror the
   * parking ones above for the same reason the parking ones are split: each
   * names its own table, and "who acted on whose behalf" must be legible.
   */
  'DESK_RESERVATION_CREATED',
  'DESK_RESERVATION_CANCELLED',
  'DESK_RESERVATION_CANCELLED_BY_ADMIN',
  'DESK_RELEASED',
  'DESK_RELEASE_CANCELLED',
  'DESK_APPROVAL_REQUESTED',
  'DESK_APPROVAL_DECIDED',
  'DESK_UPDATED',
  'HIVE_UPDATED',
  'OFFICE_UPDATED',
  'ZONE_UPDATED',
  'EMPLOYEE_SYNC_APPLIED',
  'EMPLOYEE_SYNC_SETTINGS_UPDATED',
  'USER_DEACTIVATED',
] as const;

export const auditLogActionSchema = z.enum(AUDIT_LOG_ACTIONS);
export type AuditLogAction = z.infer<typeof auditLogActionSchema>;

/**
 * Append-only audit trail. Cancelling a reservation is a hard delete plus an
 * audit entry, so this table is what preserves the history.
 */
export const auditLogSchema = z.object({
  id: idSchema,
  /** Who performed the action. System actions are attributed to their trigger. */
  actorUserId: idSchema,
  action: auditLogActionSchema,
  /** Entity kind the action applied to, e.g. `Reservation`. */
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  /** Free-form JSONB detail; its shape depends on `action`. */
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

// ---------------------------------------------------------------------------
// Desk booking (`doc/desk-merge-plan.md` §"Data model"). Keys match the Prisma
// models field for field (`schema-contract-parity.spec.ts`).
// ---------------------------------------------------------------------------

/** Bounded display name: offices, zones, hives. */
const nameSchema = z.string().trim().min(1).max(100);

/** `#RRGGBB`. */
export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, {
  error: 'Expected a #RRGGBB colour',
});

/** Stable zone identifier inside one office, e.g. `engineering1`. */
export const zoneKeySchema = z.string().regex(/^[a-z0-9_]{1,40}$/, {
  error: 'Expected 1–40 characters of a–z, 0–9 and _',
});

/** A branch office. `floorPlan` names a bundled plan; its size is in plan units. */
export const officeSchema = z.object({
  id: idSchema,
  name: nameSchema,
  active: z.boolean(),
  floorPlan: floorPlanSchema.nullable(),
  floorPlanWidth: z.int().positive().nullable(),
  floorPlanHeight: z.int().positive().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Office = z.infer<typeof officeSchema>;

/** A named area of one office's plan. Independent of hives. */
export const zoneSchema = z.object({
  id: idSchema,
  officeId: idSchema,
  key: zoneKeySchema,
  name: nameSchema,
});
export type Zone = z.infer<typeof zoneSchema>;

/**
 * A team owning a set of desks. Global, not office-scoped. The owner is not a
 * role: their only power is deciding approval requests for the hive's desks.
 */
export const hiveSchema = z.object({
  id: idSchema,
  name: nameSchema,
  color: hexColorSchema,
  ownerId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Hive = z.infer<typeof hiveSchema>;

/** A user's membership of a hive. `userId` is unique: one hive per user. */
export const hiveMembershipSchema = z.object({
  id: idSchema,
  hiveId: idSchema,
  userId: idSchema,
  createdAt: timestampSchema,
});
export type HiveMembership = z.infer<typeof hiveMembershipSchema>;

/**
 * A desk. Geometry is the axis-aligned box in plan units, rotation already
 * applied; the web app draws it over the bundled plan. `permanentAssigneeId`
 * is unique: at most one permanent desk per user.
 */
export const deskSchema = z.object({
  id: idSchema,
  officeId: idSchema,
  zoneId: idSchema,
  /** e.g. `D-001`; unique per office. */
  code: z.string().min(1).max(40),
  active: z.boolean(),
  hiveId: idSchema.nullable(),
  permanentAssigneeId: idSchema.nullable(),
  x: z.int(),
  y: z.int(),
  width: z.int().positive(),
  height: z.int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Desk = z.infer<typeof deskSchema>;

/** Direct permission for one user to book one hive desk without approval. */
export const deskGrantSchema = z.object({
  id: idSchema,
  deskId: idSchema,
  userId: idSchema,
  createdAt: timestampSchema,
});
export type DeskGrant = z.infer<typeof deskGrantSchema>;

/** One desk for one whole day. Unique per (desk, date) and per (user, date). */
export const deskReservationSchema = z.object({
  id: idSchema,
  deskId: idSchema,
  userId: idSchema,
  date: dateOnlySchema,
  createdAt: timestampSchema,
});
export type DeskReservation = z.infer<typeof deskReservationSchema>;

/** A day a permanent holder freed their desk. Unique per (desk, date). */
export const deskReleaseSchema = z.object({
  id: idSchema,
  deskId: idSchema,
  date: dateOnlySchema,
  releasedById: idSchema,
  createdAt: timestampSchema,
});
export type DeskRelease = z.infer<typeof deskReleaseSchema>;

/**
 * A request to book a hive desk for one date without direct access. Decided by
 * the hive owner or any admin; a request its author withdraws is deleted.
 */
export const deskApprovalRequestSchema = z.object({
  id: idSchema,
  deskId: idSchema,
  userId: idSchema,
  date: dateOnlySchema,
  status: deskApprovalStatusSchema,
  decidedById: idSchema.nullable(),
  decidedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type DeskApprovalRequest = z.infer<typeof deskApprovalRequestSchema>;

const syncCountSchema = z.int().nonnegative();
const syncEmailSchema = z.string().min(1).max(320);
const syncNameSchema = z.string().min(1).max(200);
function syncList<T extends z.ZodType>(item: T) {
  return z.array(item).max(EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT);
}

/**
 * What one employee-sync run did (or, in `DRY` mode, would have done). Stored
 * as JSONB on `EmployeeSyncRun.summary`; strict, so a writer cannot drift.
 * A rejected run still carries a summary, with zero counts and empty lists.
 * Each list is capped; the counts are not.
 */
export const employeeSyncSummarySchema = z.strictObject({
  received: syncCountSchema,
  activeBefore: syncCountSchema,
  created: syncList(z.strictObject({ email: syncEmailSchema, name: syncNameSchema })),
  renamed: syncList(
    z.strictObject({ email: syncEmailSchema, from: syncNameSchema, to: syncNameSchema })
  ),
  deactivated: syncList(
    z.strictObject({
      email: syncEmailSchema,
      name: syncNameSchema,
      freedDeskReservations: syncCountSchema,
      freedParkingReservations: syncCountSchema,
      removedWaitlistEntries: syncCountSchema,
      rejectedRequests: syncCountSchema,
      /** Codes of desks the user still holds permanently (kept, warned about). */
      permanentDesks: z.array(z.string().min(1).max(40)).max(10),
      /** Names of hives the user still owns (kept, warned about). */
      ownedHives: z.array(nameSchema).max(100),
    })
  ),
  reactivated: syncList(z.strictObject({ email: syncEmailSchema, name: syncNameSchema })),
  linked: syncCountSchema,
  unchanged: syncCountSchema,
  warnings: syncList(z.string().min(1).max(1000)),
});
export type EmployeeSyncSummary = z.infer<typeof employeeSyncSummarySchema>;

/** One call of `POST /api/employee-sync`, logged whether it was applied or not. */
export const employeeSyncRunSchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  /** Who pushed the list, e.g. `keboola`. */
  source: z.string().min(1).max(200),
  mode: employeeSyncModeSchema,
  status: employeeSyncStatusSchema,
  /** Why the list was rejected; `null` for `OK`. */
  reason: z.string().min(1).max(2000).nullable(),
  summary: employeeSyncSummarySchema,
});
export type EmployeeSyncRun = z.infer<typeof employeeSyncRunSchema>;

/**
 * Singleton settings of the employee sync. No `id` (never addressed by id over
 * the wire) and no `updatedAt`, like the other settings singletons. The key is
 * not here: only its SHA-256 exists, in the API's environment.
 */
export const employeeSyncSettingsSchema = z.object({
  /** `false` (the default) = every run is a dry run. */
  liveMode: z.boolean(),
});
export type EmployeeSyncSettings = z.infer<typeof employeeSyncSettingsSchema>;
