/**
 * Offices for parking (desk merge, stage 6), against a real PostgreSQL: a user
 * books and queues only spots of their own office, a spot elsewhere answers
 * `NOT_FOUND` exactly like a hidden one, an admin books across offices, a user
 * without an office sees every office, and bulk booking allocates only in the
 * holder's office.
 *
 * Run with `nx run api:test-db`.
 */

import type { Office, PrismaClient, User } from '@sit-and-park/database';
import { addDays } from '@sit-and-park/shared-types';
import type { Harness } from '../testing/database/reservation-harness';
import {
  FUTURE_BUSINESS_DAY,
  TODAY,
  actorFor,
  buildHarness,
  codeOf,
  connect,
  seedUser,
  setLockMode,
} from '../testing/database/reservation-harness';
import { unique } from '../testing/database/test-database';

describe('parking spots are scoped to the user’s office', () => {
  let client: PrismaClient;
  let harness: Harness;
  let here: Office;
  let there: Office;

  async function spotIn(office: Office) {
    return client.parkingSpot.create({
      data: { label: unique('OFF'), group: 'SHARED', officeId: office.id },
    });
  }

  async function userIn(office: Office | null): Promise<User> {
    const user = await seedUser(client);
    return client.user.update({ where: { id: user.id }, data: { officeId: office?.id ?? null } });
  }

  beforeAll(async () => {
    client = connect();
    harness = buildHarness(client);
    here = await client.office.create({ data: { name: unique('Here') } });
    there = await client.office.create({ data: { name: unique('There') } });
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  beforeEach(async () => {
    harness.publisher.reset();
    await setLockMode(client, 'AUTO');
  });

  it('refuses a spot of another office to a normal user with NOT_FOUND', async () => {
    const [user, spot] = [await userIn(here), await spotIn(there)];

    await expect(
      codeOf(
        harness.reservations.create(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(user),
          TODAY
        )
      )
    ).resolves.toBe('NOT_FOUND');
  });

  it('books a spot of the user’s own office', async () => {
    const [user, spot] = [await userIn(here), await spotIn(here)];

    await expect(
      harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(user),
        TODAY
      )
    ).resolves.toMatchObject({ parkingSpotId: spot.id, userId: user.id });
  });

  it('lets a user without an office book any office’s spot', async () => {
    const [user, spot] = [await userIn(null), await spotIn(there)];

    await expect(
      harness.reservations.create(
        { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
        actorFor(user),
        TODAY
      )
    ).resolves.toMatchObject({ parkingSpotId: spot.id });
  });

  it('lets an admin book another office’s spot for somebody', async () => {
    const [admin, holder, spot] = [await userIn(here), await userIn(here), await spotIn(there)];

    await expect(
      harness.reservations.create(
        {
          parkingSpotId: spot.id,
          date: FUTURE_BUSINESS_DAY,
          holder: { kind: 'USER', userId: holder.id, licensePlate: null },
        },
        actorFor(admin, 'ADMIN'),
        TODAY
      )
    ).resolves.toMatchObject({ parkingSpotId: spot.id, userId: holder.id });
  });

  it('refuses another office’s queue to a normal user with NOT_FOUND', async () => {
    const [holder, waiter, spot] = [await userIn(there), await userIn(here), await spotIn(there)];
    await harness.reservations.create(
      { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
      actorFor(holder),
      TODAY
    );

    await expect(
      codeOf(
        harness.waitlist.join(
          { parkingSpotId: spot.id, date: FUTURE_BUSINESS_DAY },
          actorFor(waiter),
          TODAY
        )
      )
    ).resolves.toBe('NOT_FOUND');
  });

  it('allocates bulk days only in the holder’s office', async () => {
    // A fresh office with exactly one spot: whatever the rest of the shared
    // database holds, the allocator may only ever pick this one.
    const solo = await client.office.create({ data: { name: unique('Solo') } });
    const [user, spot] = [await userIn(solo), await spotIn(solo)];
    await setLockMode(client, 'FORCE_OPEN');
    const date = addDays(FUTURE_BUSINESS_DAY, 7);

    const preview = await harness.bulk.preview({ dates: [date] }, actorFor(user));

    expect(preview.days).toEqual([
      expect.objectContaining({ outcome: 'SPOT_ASSIGNED', parkingSpotId: spot.id }),
    ]);
  });
});
