/**
 * Offices for parking: a user sees and books the
 * parking spots of their own office.
 *
 * A user with `officeId = null` sees **every** office's spots. Parking
 * predates offices, and locking out an account nobody has assigned yet would
 * turn a missing admin step into "the car park is empty". Desks are stricter
 * (`NO_OFFICE_ASSIGNED`), because desks never existed without offices.
 */

import type { Prisma } from '@sit-and-park/database';

type UserReader = Pick<Prisma.TransactionClient, 'user'>;
type OfficeReader = Pick<Prisma.TransactionClient, 'office'>;

/** The office whose spots `userId` sees; `null` = every office (see above). */
export async function parkingOfficeOf(client: UserReader, userId: string): Promise<string | null> {
  const row = await client.user.findUnique({ where: { id: userId }, select: { officeId: true } });
  return row?.officeId ?? null;
}

/** Whether a viewer scoped to `viewerOfficeId` sees a spot of `spotOfficeId`. */
export function seesParkingOffice(viewerOfficeId: string | null, spotOfficeId: string): boolean {
  return viewerOfficeId === null || viewerOfficeId === spotOfficeId;
}

/**
 * The office new users and new spots get when nobody names one: the oldest
 * active office. `null` when there is no active office at all.
 */
export async function defaultOfficeId(client: OfficeReader): Promise<string | null> {
  const row = await client.office.findFirst({
    where: { active: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return row?.id ?? null;
}
