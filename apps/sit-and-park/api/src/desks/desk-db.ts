/**
 * The database side the desk services share: loading the caller's facts for
 * `desk-rules.ts`, the desk row lock, and row → contract mapping.
 */

import type { Desk, DeskApprovalRequest, DeskReservation } from '@sit-and-park/contract';
import type {
  Desk as DeskRow,
  DeskApprovalRequest as DeskApprovalRequestRow,
  DeskReservation as DeskReservationRow,
  Prisma,
} from '@sit-and-park/database';
import { DomainError } from '../common/errors/domain-error';
import { toDateOnly, toTimestamp } from '../common/prisma-mapping';
import type { DeskCaller } from './desk-rules';

/** A client a desk query may run on: the request's own, or a transaction. */
export type DeskReader = Prisma.TransactionClient;

/** The caller as the rules see them, read in one statement. */
export interface LoadedCaller extends DeskCaller {
  name: string;
  active: boolean;
  preferredDeskId: string | null;
}

const CALLER_SELECT = {
  id: true,
  name: true,
  active: true,
  role: true,
  officeId: true,
  preferredDeskId: true,
  hiveMembership: { select: { hiveId: true } },
  permanentDesk: { select: { id: true } },
  deskGrants: { select: { deskId: true } },
} satisfies Prisma.UserSelect;

function toLoadedCaller(
  row: Prisma.UserGetPayload<{ select: typeof CALLER_SELECT }>
): LoadedCaller {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    officeId: row.officeId,
    preferredDeskId: row.preferredDeskId,
    isAdmin: row.role === 'ADMIN',
    hiveId: row.hiveMembership?.hiveId ?? null,
    grantedDeskIds: new Set(row.deskGrants.map((grant) => grant.deskId)),
    permanentDeskId: row.permanentDesk?.id ?? null,
  };
}

/**
 * Reads the caller's office, role, membership, grants, permanent desk, and
 * (for bulk booking) name, activity and `preferredDeskId`.
 * `AuthenticatedUser` carries none of the desk facts, and the role is re-read
 * so that every fact a decision rests on comes from the same read.
 */
export async function loadCaller(db: DeskReader, userId: string): Promise<LoadedCaller> {
  const row = await db.user.findUnique({ where: { id: userId }, select: CALLER_SELECT });
  if (row === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such user.' });
  }
  return toLoadedCaller(row);
}

/** {@link loadCaller} for several users, in the order of `userIds`; `NOT_FOUND` if any is missing. */
export async function loadPeople(
  db: DeskReader,
  userIds: readonly string[]
): Promise<LoadedCaller[]> {
  const rows = await db.user.findMany({
    where: { id: { in: [...userIds] } },
    select: CALLER_SELECT,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return userIds.map((id) => {
    const row = byId.get(id);
    if (row === undefined) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.', details: { userId: id } });
    }
    return toLoadedCaller(row);
  });
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

/** {@link lockUser} `FOR SHARE` for several users, ascending id; taken after the desk locks. */
export async function lockUsersForShare(
  tx: Prisma.TransactionClient,
  userIds: readonly string[]
): Promise<void> {
  const sorted = [...userIds].sort();
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ANY(${sorted}::uuid[]) ORDER BY "id" FOR SHARE`;
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
