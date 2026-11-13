/**
 * What each audit action's `payload` contains.
 *
 * The `AuditLog` row carries a discriminant (`action`, the contract's closed
 * `AUDIT_LOG_ACTIONS` enum) and a JSONB bag beside it. Until this map existed
 * the two were unrelated: any writer of any action could put any keys in, and
 * two writers of the *same* action could disagree on the key names with nothing
 * failing. The table is append-only (`doc/decision/0027-*`), so a divergence is
 * permanent and unqueryable after the fact — and `doc/decision/0091-*` already
 * rules that an audit fact whose presence depends on which endpoint the row
 * arrived through is not an audit trail. The same argument applies one level
 * down, to the keys.
 *
 * Keyed as a `Record` over `AuditLogAction`, so adding an action to the
 * contract does not compile until somebody says what its payload holds.
 *
 * ## Why this is a TypeScript map and not a Zod schema in `libs/sit-and-park/contract`
 *
 * Contract-first governs FE↔BE shapes, and this is not one: no procedure
 * returns an `AuditLog`, so no payload written here ever crosses the wire or is
 * parsed. What the map *does* have to satisfy is Prisma's `InputJsonObject`
 * bound — a `Date`, a class instance or an `undefined` has no representation in
 * a JSONB column — and `libs/sit-and-park/contract` may not depend on `@sit-and-park/database`.
 * The discriminant itself still comes from the contract (`AuditLogAction`), as
 * do the field types that are contract shapes.
 *
 * Written as `type` aliases rather than `interface`s deliberately: only a type
 * alias of an object literal gets TypeScript's implicit index signature, which
 * is what makes it assignable to `Prisma.InputJsonObject` at the one place that
 * matters, `AuditLogService.record`.
 */

import type {
  AuditLogAction,
  ParkingGroup,
  ReservationLimitSettings,
  ReservationWindowSettings,
  UserRole,
} from '@sit-and-park/contract';
import type { DateOnly, TimeOfDay } from '@sit-and-park/shared-types';

/**
 * The cell an entry is about.
 *
 * Every reservation and waitlist action names one, in these two keys and no
 * others — which is the divergence this file exists to prevent: `waitlist.join`
 * and `reservation.confirmBulk` both write `WAITLIST_JOINED`, from different
 * services, and their payloads now have one definition instead of two habits.
 */
type AuditCell = {
  readonly parkingSpotId: string;
  readonly date: DateOnly;
};

/** The two fields an admin can change on the reservation window. */
type WindowFields = Pick<ReservationWindowSettings, 'openDaysBefore' | 'lockMode'>;

/** The one field `RESERVATION_LIMITS_UPDATED` records a before/after for. */
type LimitFields = Pick<ReservationLimitSettings, 'monthlyReservationCap'>;

/** A before/after pair, for the actions that record a field change. */
type Change<TFields> = {
  readonly before: TFields;
  readonly after: TFields;
};

/**
 * `USER_UPDATED` covers three unrelated edits, so it carries its own `change`
 * discriminant. `ics-token-regenerated` records **that** it happened and never
 * the token: an append-only table nobody can redact is the worst possible place
 * for the only credential on the personal calendar feed.
 */
type UserUpdatedPayload =
  | ({ readonly change: 'settings' } & Change<{
      readonly licensePlate: string | null;
      readonly preferredParkingSpotId: string | null;
      readonly preferredDeskId: string | null;
    }>)
  | ({ readonly change: 'admin-updated' } & Change<{
      readonly role: UserRole;
      readonly active: boolean;
      readonly officeId: string | null;
      readonly manualAccount: boolean;
    }>)
  | { readonly change: 'ics-token-regenerated'; readonly attempt: number };

/** `SPOT_UPDATED` likewise covers create, edit and retire. */
type SpotUpdatedPayload =
  | {
      readonly change: 'created';
      readonly label: string;
      readonly group: ParkingGroup;
      readonly evCharger: boolean;
    }
  | ({ readonly change: 'updated' } & Change<{
      readonly label: string;
      readonly group: ParkingGroup;
      readonly active: boolean;
      readonly hidden: boolean;
      readonly evCharger: boolean;
      readonly officeId: string;
    }>)
  | { readonly change: 'deactivated'; readonly label: string };

type DeskCell = {
  readonly deskId: string;
  readonly deskCode: string;
  readonly date: DateOnly;
};

type DeskCancelReason =
  | 'USER'
  | 'ADMIN'
  | 'DESK_DEACTIVATED'
  | 'DESK_OFFICE_CHANGED'
  | 'PERMANENT_ASSIGNMENT'
  | 'USER_DEACTIVATED';

type DeskApprovalDecidedReason =
  | 'DECIDED'
  | 'DESK_DEACTIVATED'
  | 'DESK_HIVE_CHANGED'
  | 'DESK_OFFICE_CHANGED'
  /** Another request for the same desk and day was approved. */
  | 'DESK_TAKEN'
  | 'HIVE_DELETED'
  /** The requester got a desk for that day, so the request can never be approved. */
  | 'REQUESTER_HAS_DESK'
  | 'USER_DEACTIVATED';

/**
 * Admin-managed catalogue entities (desk, hive, office, zone): `before` null
 * means created, `after` null means deleted.
 */
type CatalogChange<TFields> = {
  readonly before: TFields | null;
  readonly after: TFields | null;
};

type DeskCancelPayload = DeskCell & {
  readonly userId: string;
  readonly reason: DeskCancelReason;
};

/**
 * Identity, but with the key set checked: a member added to `AUDIT_LOG_ACTIONS`
 * and not to the map below stops compiling here rather than silently getting an
 * unconstrained payload.
 */
type PayloadMap<T extends Record<AuditLogAction, object>> = T;

export type AuditPayloads = PayloadMap<{
  RESERVATION_CREATED: AuditCell;
  /**
   * An admin booked for somebody else. Exactly one of the two holder fields is
   * set, mirroring `Reservation_holder_check`.
   */
  RESERVATION_CREATED_BY_ADMIN: AuditCell & {
    readonly holderUserId: string | null;
    readonly guestName: string | null;
  };
  RESERVATION_CANCELLED: AuditCell & { readonly holderUserId: string | null };
  RESERVATION_CANCELLED_BY_ADMIN: AuditCell & { readonly holderUserId: string | null };
  WAITLIST_PROMOTED: AuditCell & {
    readonly promotedUserId: string;
    readonly fromWaitlistEntryId: string;
    /** How long the queue was when the promotion ran, the promoted entry included. */
    readonly queueLength: number;
  };
  WAITLIST_JOINED: AuditCell;
  /**
   * An admin queued somebody else. Mirrors `RESERVATION_CREATED_BY_ADMIN`'s
   * split, minus the guest branch: `WaitlistEntry.userId` is non-nullable, so
   * the target is always a user and needs no `guestName` alternative.
   */
  WAITLIST_JOINED_BY_ADMIN: AuditCell & { readonly targetUserId: string };
  USER_UPDATED: UserUpdatedPayload;
  SPOT_UPDATED: SpotUpdatedPayload;
  RESERVATION_WINDOW_UPDATED: Change<WindowFields>;
  RESERVATION_LIMITS_UPDATED: Change<LimitFields>;
  /** An admin booked a guest-only half-hour block. */
  TIMED_RESERVATION_CREATED: AuditCell & {
    readonly startTime: TimeOfDay;
    readonly endTime: TimeOfDay;
    readonly guestName: string;
  };
  /** An admin removed a timed block. Mirrors `TIMED_RESERVATION_CREATED`. */
  TIMED_RESERVATION_CANCELLED: AuditCell & {
    readonly startTime: TimeOfDay;
    readonly endTime: TimeOfDay;
    readonly guestName: string;
  };
  DESK_RESERVATION_CREATED: DeskCell & { readonly userId: string };
  DESK_RESERVATION_CANCELLED: DeskCancelPayload;
  DESK_RESERVATION_CANCELLED_BY_ADMIN: DeskCancelPayload;
  DESK_RELEASED: DeskCell;
  DESK_RELEASE_CANCELLED: DeskCell;
  DESK_APPROVAL_REQUESTED: DeskCell & { readonly userId: string };
  DESK_APPROVAL_DECIDED: DeskCell & {
    readonly userId: string;
    readonly status: 'APPROVED' | 'REJECTED';
    readonly reason: DeskApprovalDecidedReason;
  };
  DESK_UPDATED: CatalogChange<{
    readonly code: string;
    readonly officeId: string;
    readonly zoneId: string;
    readonly hiveId: string | null;
    readonly active: boolean;
    readonly permanentAssigneeId: string | null;
  }>;
  HIVE_UPDATED: CatalogChange<{
    readonly name: string;
    readonly color: string;
    readonly ownerId: string;
  }>;
  OFFICE_UPDATED: CatalogChange<{ readonly name: string; readonly active: boolean }>;
  ZONE_UPDATED: CatalogChange<{
    readonly key: string;
    readonly name: string;
    readonly officeId: string;
  }>;
  EMPLOYEE_SYNC_APPLIED: {
    readonly mode: 'DRY' | 'LIVE';
    readonly created: number;
    readonly updated: number;
    readonly deactivated: number;
  };
  EMPLOYEE_SYNC_SETTINGS_UPDATED: Change<{ readonly liveMode: boolean }>;
  USER_DEACTIVATED: {
    readonly source: 'EMPLOYEE_SYNC' | 'ADMIN';
    readonly freedReservations: number;
    readonly freedDeskReservations: number;
    readonly removedWaitlistEntries: number;
    readonly rejectedRequests: number;
  };
}>;
