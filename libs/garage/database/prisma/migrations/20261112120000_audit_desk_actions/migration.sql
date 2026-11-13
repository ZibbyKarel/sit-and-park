-- The desk merge (`doc/desk-merge-plan.md`) adds fourteen audit actions.
--
-- In a migration of their own, before the one that creates the desk tables:
-- Postgres 12+ allows ADD VALUE inside a transaction block only as long as the
-- new value is not used in the same transaction, and the database suites apply
-- each migration file as one query. Nothing here uses them.
--
-- `ADD VALUE IF NOT EXISTS` rather than a recreate, for the reason
-- `20260902090000_audit_reservation_window_updated` gives at length: rewriting
-- the type would mean an UPDATE of "AuditLog", which is append-only by trigger
-- (`doc/decision/0027-*`).
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_RESERVATION_CREATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_RESERVATION_CANCELLED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_RESERVATION_CANCELLED_BY_ADMIN';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_RELEASED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_RELEASE_CANCELLED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_APPROVAL_REQUESTED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_APPROVAL_DECIDED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'DESK_UPDATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'HIVE_UPDATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'OFFICE_UPDATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'ZONE_UPDATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'EMPLOYEE_SYNC_APPLIED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'EMPLOYEE_SYNC_SETTINGS_UPDATED';
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'USER_DEACTIVATED';
