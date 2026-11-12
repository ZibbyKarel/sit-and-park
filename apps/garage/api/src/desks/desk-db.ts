/**
 * The database side the desk services share: loading the caller's facts for
 * `desk-rules.ts`, the desk row lock, and row → contract mapping.
 */

import type { Desk, DeskApprovalRequest, DeskReservation } from '@garage/contract';
import type {
  Desk as DeskRow,
  DeskApprovalRequest as DeskApprovalRequestRow,
  DeskReservation as DeskReservationRow,
  Prisma,
} from '@garage/database';
import { DomainError } from '../common/errors/domain-error';
import { toDateOnly, toTimestamp } from '../common/prisma-mapping';
import type { DeskCaller } from './desk-rules';

/** A client a desk query may run on: the request's own, or a transaction. */
export type DeskReader = Prisma.TransactionClient;

/** The caller as the rules see them, read in one statement. */
export interface LoadedCaller extends DeskCaller {
  name: string;
  active: boolean;
}

/**
 * Reads the caller's office, role, membership, grants and permanent desk.
 * `AuthenticatedUser` carries none of the desk facts, and the role is re-read
 * so that every fact a decision rests on comes from the same read.
 */
export async function loadCaller(db: DeskReader, userId: string): Promise<LoadedCaller> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      active: true,
      role: true,
      officeId: true,
      hiveMembership: { select: { hiveId: true } },
      permanentDesk: { select: { id: true } },
      deskGrants: { select: { deskId: true } },
    },
  });
  if (row === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such user.' });
  }
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    officeId: row.officeId,
    isAdmin: row.role === 'ADMIN',
    hiveId: row.hiveMembership?.hiveId ?? null,
    grantedDeskIds: new Set(row.deskGrants.map((grant) => grant.deskId)),
    permanentDeskId: row.permanentDesk?.id ?? null,
  };
}

/**
 * `SELECT … FOR UPDATE` on one desk row: everything that books, approves or
 * withdraws a release of this desk serialises here, so a plan read after it is
 * still true at the insert. (The caller's own reservations on other desks are
 * not covered; `DeskReservation (userId, date)` is.) Even a writer that skips
 * this lock waits on it: a reservation's foreign key takes `FOR KEY SHARE` on
 * the desk row, which conflicts with `FOR UPDATE`. A missing desk locks
 * nothing and the caller's own lookup reports it.
 */
export async function lockDesk(tx: Prisma.TransactionClient, deskId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Desk" WHERE "id" = ${deskId}::uuid FOR UPDATE`;
}

/** {@link lockDesk} for several desks, ascending id so concurrent multi-desk writers cannot deadlock. */
export async function lockDesks(
  tx: Prisma.TransactionClient,
  deskIds: readonly string[]
): Promise<void> {
  const sorted = [...deskIds].sort();
  await tx.$queryRaw`SELECT "id" FROM "Desk" WHERE "id" = ANY(${sorted}::uuid[]) ORDER BY "id" FOR UPDATE`;
}

/**
 * A row lock on one user, always taken **after** the desk lock (order: desk →
 * user). It serialises "this user becomes a permanent holder"
 * (`setPermanentAssignee`, `FOR UPDATE`) against "this user books a desk"
 * (`reserve`, approval; `FOR SHARE`, so bookings of one user on different
 * desks do not wait on each other). Those writers lock different desks, so
 * the desk lock alone does not order them. Read the user's facts after it.
 */
export async function lockUser(
  tx: Prisma.TransactionClient,
  userId: string,
  mode: 'SHARE' | 'UPDATE'
): Promise<void> {
  if (mode === 'UPDATE') {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR SHARE`;
  }
}

export function toContractDesk(row: DeskRow): Desk {
  return {
    id: row.id,
    officeId: row.officeId,
    zoneId: row.zoneId,
    code: row.code,
    active: row.active,
    hiveId: row.hiveId,
    permanentAssigneeId: row.permanentAssigneeId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export function toContractDeskReservation(row: DeskReservationRow): DeskReservation {
  return {
    id: row.id,
    deskId: row.deskId,
    userId: row.userId,
    date: toDateOnly(row.date),
    createdAt: toTimestamp(row.createdAt),
  };
}

export function toContractDeskRequest(row: DeskApprovalRequestRow): DeskApprovalRequest {
  return {
    id: row.id,
    deskId: row.deskId,
    userId: row.userId,
    date: toDateOnly(row.date),
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt === null ? null : toTimestamp(row.decidedAt),
    createdAt: toTimestamp(row.createdAt),
  };
}
