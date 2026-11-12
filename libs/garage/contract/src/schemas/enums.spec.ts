import {
  DESK_ACCESS_LEVELS,
  DESK_APPROVAL_STATUSES,
  DESK_SKIP_REASONS,
  DESK_STATUSES,
  EMPLOYEE_SYNC_MODES,
  EMPLOYEE_SYNC_STATUSES,
  FLOOR_PLANS,
  MONTH_LOCK_STATES,
  PARKING_GROUPS,
  RESERVATION_LOCK_MODES,
  USER_ROLES,
  type DeskApprovalStatus as SharedDeskApprovalStatus,
  type DeskSkipReason as SharedDeskSkipReason,
  type DeskStatus as SharedDeskStatus,
  type MonthLockState as SharedMonthLockState,
  type ParkingGroup as SharedParkingGroup,
  type ReservationLockMode as SharedReservationLockMode,
  type UserRole as SharedUserRole,
} from '@garage/shared-types';
import {
  deskAccessSchema,
  deskApprovalStatusSchema,
  deskSkipReasonSchema,
  deskStatusSchema,
  employeeSyncModeSchema,
  employeeSyncStatusSchema,
  floorPlanSchema,
  monthLockStateSchema,
  parkingGroupSchema,
  reservationLockModeSchema,
  userRoleSchema,
  type DeskApprovalStatus,
  type DeskSkipReason,
  type DeskStatus,
  type MonthLockState,
  type ParkingGroup,
  type ReservationLockMode,
  type UserRole,
} from './enums';

/** Compile-time assertion that two types are mutually assignable. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function expectSameType<T extends true>(): void {
  void (undefined as unknown as T);
}

describe('enum schemas mirror the shared-types tuples', () => {
  it.each([
    ['parkingGroupSchema', parkingGroupSchema, PARKING_GROUPS],
    ['userRoleSchema', userRoleSchema, USER_ROLES],
    ['reservationLockModeSchema', reservationLockModeSchema, RESERVATION_LOCK_MODES],
    ['monthLockStateSchema', monthLockStateSchema, MONTH_LOCK_STATES],
    ['deskApprovalStatusSchema', deskApprovalStatusSchema, DESK_APPROVAL_STATUSES],
    ['employeeSyncModeSchema', employeeSyncModeSchema, EMPLOYEE_SYNC_MODES],
    ['employeeSyncStatusSchema', employeeSyncStatusSchema, EMPLOYEE_SYNC_STATUSES],
    ['deskStatusSchema', deskStatusSchema, DESK_STATUSES],
    ['deskAccessSchema', deskAccessSchema, DESK_ACCESS_LEVELS],
    ['deskSkipReasonSchema', deskSkipReasonSchema, DESK_SKIP_REASONS],
    ['floorPlanSchema', floorPlanSchema, FLOOR_PLANS],
  ] as const)('%s accepts exactly its tuple', (_name, schema, values) => {
    for (const value of values) {
      expect(schema.safeParse(value).success).toBe(true);
    }
    expect(schema.safeParse('SOMETHING_ELSE').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it('is case sensitive', () => {
    expect(parkingGroupSchema.safeParse('it').success).toBe(false);
    expect(userRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('derives types identical to the shared-types ones', () => {
    // The values live once, in shared-types; the contract types stay derived
    // through z.infer. This asserts the two never drift apart.
    expectSameType<Equals<ParkingGroup, SharedParkingGroup>>();
    expectSameType<Equals<UserRole, SharedUserRole>>();
    expectSameType<Equals<ReservationLockMode, SharedReservationLockMode>>();
    expectSameType<Equals<MonthLockState, SharedMonthLockState>>();
    expectSameType<Equals<DeskApprovalStatus, SharedDeskApprovalStatus>>();
    expectSameType<Equals<DeskStatus, SharedDeskStatus>>();
    expectSameType<Equals<DeskSkipReason, SharedDeskSkipReason>>();
    expect(true).toBe(true);
  });
});
