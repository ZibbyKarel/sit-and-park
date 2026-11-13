/**
 * Closed enumerations of the domain, as plain readonly tuples.
 *
 * `libs/sit-and-park/shared-types` must not depend on Zod (it is imported by `apps/sit-and-park/api`,
 * `libs/sit-and-park/contract` and `libs/shared/i18n` alike), so the values live here and
 * `libs/sit-and-park/contract` builds its Zod enums on top of them — `z.enum(PARKING_GROUPS)`.
 * That keeps one single list of allowed values while the contract types stay
 * derived through `z.infer`.
 */

/** Parking spot group. IT spots are reserved for the IT department. */
export const PARKING_GROUPS = ['IT', 'SHARED'] as const;
export type ParkingGroup = (typeof PARKING_GROUPS)[number];

/** Application role. There are exactly two; there is no per-resource ACL. */
export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Admin override of the reservation window
 * (see `doc/decision/0004-mvp-scope-includes-design-features.md`).
 *
 * - `AUTO`         — the window is derived from `openDaysBefore`.
 * - `FORCE_OPEN`   — reservations are open regardless of the date.
 * - `FORCE_LOCKED` — reservations are closed regardless of the date.
 */
export const RESERVATION_LOCK_MODES = ['AUTO', 'FORCE_OPEN', 'FORCE_LOCKED'] as const;
export type ReservationLockMode = (typeof RESERVATION_LOCK_MODES)[number];

/**
 * State of a target month with respect to the reservation window.
 *
 * - `NOT_YET_OPEN` — the window has not opened yet ("Zatím neotevřeno").
 * - `OPEN`         — the window is open ("Otevřeno").
 * - `LOCKED`       — the window has closed ("Uzamčeno"). Under `AUTO` a month is
 *   never `LOCKED` — it only results from the admin's `FORCE_LOCKED`.
 */
export const MONTH_LOCK_STATES = ['NOT_YET_OPEN', 'OPEN', 'LOCKED'] as const;
export type MonthLockState = (typeof MONTH_LOCK_STATES)[number];

/** Default number of days before the first of the month that the window opens. */
export const DEFAULT_OPEN_DAYS_BEFORE = 7;

/** Inclusive bounds accepted for `openDaysBefore`. */
export const MIN_OPEN_DAYS_BEFORE = 1;
export const MAX_OPEN_DAYS_BEFORE = 31;

/** Default admin override of the reservation window. */
export const DEFAULT_RESERVATION_LOCK_MODE: ReservationLockMode = 'AUTO';

/**
 * What the bulk-booking allocator managed to do with one selected day
 * (`doc/decision/0004-*`, §Bulk reservation). The same three outcomes describe
 * the read-only proposal (`previewBulk`) and the real result (`confirmBulk`), so
 * the UI can lay the two side by side and show where reality differed.
 *
 * - `SPOT_ASSIGNED` — a free spot was found (possibly the preferred one).
 * - `QUEUED`        — every spot was taken, the user went into a waitlist.
 * - `UNAVAILABLE`   — nothing could be done for that day; see
 *   {@link BULK_UNAVAILABLE_REASONS}.
 */
export const BULK_DAY_OUTCOMES = ['SPOT_ASSIGNED', 'QUEUED', 'UNAVAILABLE'] as const;
export type BulkDayOutcome = (typeof BULK_DAY_OUTCOMES)[number];

/**
 * Why a selected day produced no reservation and no queue position.
 *
 * These are *per-day* facts reported inside a successful response, not errors:
 * one impossible day must not throw away the rest of the batch. Conditions that
 * invalidate the whole request (locked month, day in the past) are contract
 * errors on the procedure instead.
 *
 * - `ALREADY_HAS_RESERVATION` — the user already holds a reservation that day
 *   (one reservation per user and day).
 * - `NOT_A_BUSINESS_DAY`      — weekend or Czech public holiday.
 * - `NO_SPOTS_AVAILABLE`      — no active spot exists to reserve or queue for.
 */
export const BULK_UNAVAILABLE_REASONS = [
  'ALREADY_HAS_RESERVATION',
  'NOT_A_BUSINESS_DAY',
  'NO_SPOTS_AVAILABLE',
] as const;
export type BulkUnavailableReason = (typeof BULK_UNAVAILABLE_REASONS)[number];

/**
 * Upper bound on the number of days one bulk booking may carry.
 *
 * A bulk selection is made inside a single calendar month, so 31 is the natural
 * ceiling. The contract enforces it structurally; the service layer still has to
 * reject days outside the open window.
 */
export const MAX_BULK_BOOKING_DAYS = 31;

/**
 * Default number of confirmed reservations one user may hold in a single
 * calendar month.
 *
 * A **default**, not the effective limit: the cap is an admin setting stored on
 * the `ReservationLimitSettings` singleton, and this is the value that row is
 * created with and the value the API answers with when the row has never been
 * written. The effective cap is enforced by
 * `assertWithinMonthlyReservationCap`
 * (`apps/sit-and-park/api/src/reservations/monthly-reservation-cap.ts`), which
 * takes it as a parameter — nothing may read this constant as though it were
 * the limit in force.
 *
 * It was `MONTHLY_RESERVATION_CAP` while the limit was fixed at 5. The rename
 * is the point: a constant called `MONTHLY_RESERVATION_CAP` next to a
 * configurable cap is a name that tells a reader the wrong thing.
 */
export const DEFAULT_MONTHLY_RESERVATION_CAP = 5;

/**
 * Bounds on the configurable cap, mirrored by a `CHECK` in the migration that
 * introduces the column — the same two-sided arrangement as
 * {@link MIN_OPEN_DAYS_BEFORE}: the contract so a client knows the limit rather
 * than discovering it by being rejected, the constraint so the database cannot
 * hold a value the contract would refuse.
 *
 * `1` rather than `0`: a cap of zero would mean "nobody may book", which is what
 * the reservation window's `FORCE_LOCKED` is for, and expressing one rule two
 * ways is how the two start disagreeing. `31` because a calendar month has at
 * most 31 days and a reservation is unique per `(user, date)`, so a larger cap
 * could never bind.
 */
export const MIN_MONTHLY_RESERVATION_CAP = 1;
export const MAX_MONTHLY_RESERVATION_CAP = 31;

/**
 * Upper bound on the number of months `admin.window.months` may report on in
 * one call, counting both endpoints of the inclusive `from`–`to` range.
 *
 * Two years is comfortably more than the admin table ever renders at once, and
 * putting the cap in the contract means the client can *know* the limit instead
 * of discovering it by being rejected — the same reasoning as
 * {@link MAX_BULK_BOOKING_DAYS}.
 */
export const MAX_MONTH_WINDOW_SPAN = 24;

/**
 * Why a spot changed hands without the new holder asking for it, as announced
 * by the `reservation:reassigned` realtime event.
 *
 * The enum exists — rather than a boolean, or nothing at all — because ruling
 * `window-1` requires a client to be able to tell a **system** reassignment
 * from a user action: auto-promotion out of a waitlist is exempt from the
 * reservation-window lock precisely because no user performed it, and the UI
 * must word it differently ("místo ti připadlo z fronty", not "rezervováno").
 *
 * There is exactly one member today, and that is deliberate: the API contract
 * has no procedure that moves an existing reservation between users, so an
 * `ADMIN_REASSIGNMENT` member would be a cause nothing can emit — the
 * over-declaration `doc/decision/0021-*` forbids. Add the member in the same
 * change that adds the procedure.
 */
export const RESERVATION_REASSIGN_CAUSES = ['WAITLIST_PROMOTION'] as const;
export type ReservationReassignCause = (typeof RESERVATION_REASSIGN_CAUSES)[number];

/**
 * Outcome of a client's request for the short-lived editing hold on one cell of
 * the parking grid (the `cell:lock` command's acknowledgement).
 *
 * - `ACQUIRED`      — the caller now holds the cell until `expiresAt`.
 * - `HELD_BY_OTHER` — somebody else is editing it; the caller must not proceed.
 */
export const CELL_LOCK_RESULTS = ['ACQUIRED', 'HELD_BY_OTHER'] as const;
export type CellLockResult = (typeof CELL_LOCK_RESULTS)[number];

/**
 * Status of a desk approval request (`DeskApprovalRequest.status`), stored as
 * the Prisma enum `DeskApprovalStatus`.
 *
 * A request its author withdraws is **deleted**, not given a status, so there
 * is no `CANCELLED` member: the three below are the only states a stored row
 * can be in (`doc/desk-merge-plan.md` §"Data model").
 */
export const DESK_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type DeskApprovalStatus = (typeof DESK_APPROVAL_STATUSES)[number];

/**
 * Whether an employee-sync run wrote anything (`EmployeeSyncRun.mode`).
 *
 * - `DRY`  — the whole algorithm ran and was logged, nothing was written.
 * - `LIVE` — the changes were applied.
 */
export const EMPLOYEE_SYNC_MODES = ['DRY', 'LIVE'] as const;
export type EmployeeSyncMode = (typeof EMPLOYEE_SYNC_MODES)[number];

/**
 * Outcome of an employee-sync run (`EmployeeSyncRun.status`). `REJECTED`
 * means the list as a whole was refused (bad rows, empty, shrank too much)
 * and nothing changed, in either mode.
 */
export const EMPLOYEE_SYNC_STATUSES = ['OK', 'REJECTED'] as const;
export type EmployeeSyncStatus = (typeof EMPLOYEE_SYNC_STATUSES)[number];

/**
 * Status of one desk on one day, as the desk directory reports it. Not
 * stored: it is computed per (desk, viewer, day), first match wins, in this
 * order:
 *
 * - `INACTIVE`       — the desk is switched off.
 * - `ASSIGNED`       — it has a permanent holder who did not release that day.
 *   Masks any reservation on the desk.
 * - `RESERVED_BY_ME` — the viewer holds that day's reservation.
 * - `RESERVED`       — somebody else does.
 * - `FREE`           — nobody does.
 *
 * The admin list never reports `RESERVED_BY_ME`: it is viewer-relative.
 */
export const DESK_STATUSES = [
  'INACTIVE',
  'ASSIGNED',
  'RESERVED_BY_ME',
  'RESERVED',
  'FREE',
] as const;
export type DeskStatus = (typeof DESK_STATUSES)[number];

/**
 * How the viewer may book a desk. Not stored.
 *
 * - `DIRECT`   — desk in the viewer's office AND (no hive, OR the viewer is an
 *   admin, a member of its hive, or holds a direct grant).
 * - `APPROVAL` — a hive desk of the viewer's office without direct access; it
 *   can be requested for one date.
 * - `NONE`     — neither.
 */
export const DESK_ACCESS_LEVELS = ['DIRECT', 'APPROVAL', 'NONE'] as const;
export type DeskAccess = (typeof DESK_ACCESS_LEVELS)[number];

/**
 * Why one day of a desk series was not (or would not be) booked. Per-day
 * facts inside a successful answer, never errors, checked in this order:
 *
 * - `PAST_DATE`                   — the day is before today (Europe/Prague).
 * - `DESK_ASSIGNED`               — the permanent holder did not release it.
 * - `ALREADY_RESERVED_THIS_DESK`  — the viewer already holds this desk that day.
 * - `ALREADY_RESERVED_OTHER_DESK` — the viewer holds another desk that day.
 * - `DESK_TAKEN`                  — somebody else holds it.
 */
export const DESK_SKIP_REASONS = [
  'PAST_DATE',
  'DESK_ASSIGNED',
  'ALREADY_RESERVED_THIS_DESK',
  'ALREADY_RESERVED_OTHER_DESK',
  'DESK_TAKEN',
] as const;
export type DeskSkipReason = (typeof DESK_SKIP_REASONS)[number];

/**
 * Keys of the floor plans bundled with the web app
 * (`apps/sit-and-park/web/public/floorplans/<key>.svg`). `Office.floorPlan` stores
 * one of them, or `null`. A second office needs a new asset, a member here
 * and a migration; there is no upload.
 */
export const FLOOR_PLANS = ['praha'] as const;
export type FloorPlan = (typeof FLOOR_PLANS)[number];

/** A desk series carries 1 to this many distinct dates. */
export const MAX_DESK_SERIES_DATES = 20;

/** The last date of a desk series lies at most this many days after the first. */
export const MAX_DESK_SERIES_SPAN_DAYS = 34;

/**
 * `desk.myReservations` and `desk.myRequests` list the caller's rows dated at
 * most this many months before today (Prague), and everything later.
 */
export const DESK_HISTORY_MONTHS = 12;

/** A permanent holder releases 1 to this many dates in one call. */
export const MAX_DESK_RELEASE_DATES = 60;

/** Upper bound on the desks one admin bulk edit or grant call may touch. */
export const MAX_DESK_BULK_IDS = 500;

/** How many of the latest employee-sync runs the admin log shows. */
export const EMPLOYEE_SYNC_RUN_HISTORY = 12;

/** Each list inside an employee-sync run summary is capped at this length. */
export const EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT = 500;
