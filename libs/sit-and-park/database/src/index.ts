/**
 * `@sit-and-park/database` — the only way the backend reaches Postgres.
 *
 * Re-exports the generated Prisma Client so that no other project imports out
 * of `src/generated/**` directly: consumers see one stable entry point and the
 * generator's output path stays an implementation detail of this lib.
 *
 * The NestJS module and `PrismaService` that wrap this live in `apps/sit-and-park/api`
 * (Tasks 10 and 12); this lib deliberately knows nothing about Nest.
 */

export { createPrismaClient } from './lib/create-prisma-client';
export type { CreatePrismaClientOptions } from './lib/create-prisma-client';

export { Prisma, PrismaClient } from './generated/prisma/client';
export type {
  AuditLog,
  Desk,
  DeskApprovalRequest,
  DeskGrant,
  DeskRelease,
  DeskReservation,
  EmployeeSyncRun,
  EmployeeSyncSettings,
  Hive,
  HiveMembership,
  Office,
  ParkingSpot,
  Reservation,
  ReservationLimitSettings,
  ReservationWindowSettings,
  TimedReservation,
  User,
  WaitlistEntry,
  Zone,
} from './generated/prisma/client';

export {
  AuditLogAction,
  DeskApprovalStatus,
  EmployeeSyncMode,
  EmployeeSyncStatus,
  ParkingGroup,
  ReservationLockMode,
  UserRole,
} from './generated/prisma/enums';

export {
  EMPLOYEE_SYNC_SETTINGS_ID,
  RESERVATION_LIMIT_SETTINGS_ID,
  RESERVATION_WINDOW_SETTINGS_ID,
} from './lib/seed-data';
