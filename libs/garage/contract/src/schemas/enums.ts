/**
 * Zod mirrors of the domain enumerations.
 *
 * The allowed values live exactly once, in `@garage/shared-types`, because
 * `apps/garage/api` and `libs/shared/i18n` need them without pulling in Zod. The schemas here
 * wrap those tuples, and the exported types stay derived through `z.infer`.
 */

import * as z from 'zod';
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
} from '@garage/shared-types';

export const parkingGroupSchema = z.enum(PARKING_GROUPS);
export type ParkingGroup = z.infer<typeof parkingGroupSchema>;

export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const reservationLockModeSchema = z.enum(RESERVATION_LOCK_MODES);
export type ReservationLockMode = z.infer<typeof reservationLockModeSchema>;

export const monthLockStateSchema = z.enum(MONTH_LOCK_STATES);
export type MonthLockState = z.infer<typeof monthLockStateSchema>;

export const deskApprovalStatusSchema = z.enum(DESK_APPROVAL_STATUSES);
export type DeskApprovalStatus = z.infer<typeof deskApprovalStatusSchema>;

export const employeeSyncModeSchema = z.enum(EMPLOYEE_SYNC_MODES);
export type EmployeeSyncMode = z.infer<typeof employeeSyncModeSchema>;

export const employeeSyncStatusSchema = z.enum(EMPLOYEE_SYNC_STATUSES);
export type EmployeeSyncStatus = z.infer<typeof employeeSyncStatusSchema>;

/** Computed per (desk, viewer, day); never stored. */
export const deskStatusSchema = z.enum(DESK_STATUSES);
export type DeskStatus = z.infer<typeof deskStatusSchema>;

/** Computed per (desk, viewer); never stored. */
export const deskAccessSchema = z.enum(DESK_ACCESS_LEVELS);
export type DeskAccess = z.infer<typeof deskAccessSchema>;

/** Why one day of a desk series is not booked; never stored. */
export const deskSkipReasonSchema = z.enum(DESK_SKIP_REASONS);
export type DeskSkipReason = z.infer<typeof deskSkipReasonSchema>;

/** A bundled floor plan key; `Office.floorPlan` stores one as a plain string. */
export const floorPlanSchema = z.enum(FLOOR_PLANS);
export type FloorPlan = z.infer<typeof floorPlanSchema>;
