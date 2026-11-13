import { DEFAULT_MONTHLY_RESERVATION_CAP } from '@sit-and-park/shared-types';
import type { MyMonthReservationsOutput } from '@sit-and-park/contract';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaDouble } from '../testing/prisma-double';
import { ReservationLimitsService } from '../reservation-limits/reservation-limits.service';
import { ReservationWindowService } from '../reservation-window/reservation-window.service';
import { ReservationsService } from './reservations.service';
import { WaitlistPromotionService } from './waitlist-promotion.service';
import { ReservationPolicy } from './reservation-policy';
import type { DomainEventPublisher } from './reservation-events';

/** Nothing in this suite asserts on published events; a plain no-op stands in. */
const noopPublisher: DomainEventPublisher = {
  publish: jest.fn(),
  notifyPromotions: jest.fn(),
  deskReserved: jest.fn(),
  deskReleased: jest.fn(),
  deskApprovalRequested: jest.fn(),
  deskApprovalDecided: jest.fn(),
};

/**
 * Inside September 2026's automatic window (default `openDaysBefore` 7:
 * 2026-08-25 … 2026-08-31), where the cap is in force. Passed explicitly,
 * because the real clock would make the expected `cap` depend on the day the
 * suite runs.
 */
const IN_WINDOW = '2026-08-31';

function authenticated(id: string): AuthenticatedUser {
  return {
    id,
    oktaId: `okta-${id}`,
    email: `${id}@example.test`,
    name: id,
    role: 'USER',
    active: true,
  };
}

/** `myMonth` adds the per-day detail; `userMonth` answers the shared summary only. */
function omitMyMonthExtras({
  reservations: _r,
  waitlist: _w,
  ...summary
}: MyMonthReservationsOutput) {
  return summary;
}

describe('ReservationsService.myMonth', () => {
  let double: PrismaDouble;
  let reservations: ReservationsService;

  beforeEach(() => {
    double = new PrismaDouble();
    const prisma = double.asPrismaService();
    const audit = new AuditLogService(prisma);
    const window = new ReservationWindowService(prisma, audit);
    reservations = new ReservationsService(
      prisma,
      window,
      new ReservationPolicy(),
      new WaitlistPromotionService(audit),
      audit,
      noopPublisher,
      new ReservationLimitsService(prisma, audit)
    );
  });

  it('returns the dates and count of the caller’s own reservations in the month', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    const first = double.seedReservation({
      parkingSpotId: spot.id,
      userId: viewer.id,
      date: '2026-09-07',
    });
    const second = double.seedReservation({
      parkingSpotId: spot.id,
      userId: viewer.id,
      date: '2026-09-14',
    });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: ['2026-09-07', '2026-09-14'],
      count: 2,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
      reservations: [
        {
          date: '2026-09-07',
          reservationId: first.id,
          parkingSpotId: spot.id,
          parkingSpotLabel: 'A1',
        },
        {
          date: '2026-09-14',
          reservationId: second.id,
          parkingSpotId: spot.id,
          parkingSpotLabel: 'A1',
        },
      ],
      waitlist: [],
    });
  });

  it('does not count another user’s reservations', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [viewer, other] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: other.id, date: '2026-09-07' });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: [],
      count: 0,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
      reservations: [],
      waitlist: [],
    });
  });

  it('reports the configured cap, not the default, in the month summary', async () => {
    const viewer = double.seedUser();
    double.seedLimitSettings({ monthlyReservationCap: 3 });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result.cap).toBe(3);
  });

  it('does not count a reservation in a different month', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-10-01' });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: [],
      count: 0,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
      reservations: [],
      waitlist: [],
    });
  });

  it('reports cap null once the month is running — leftovers are uncapped', async () => {
    const viewer = double.seedUser();

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      '2026-09-02'
    );

    expect(result.cap).toBeNull();
  });

  it('reports cap null under FORCE_OPEN, even inside the automatic window', async () => {
    const viewer = double.seedUser();
    double.seedWindowSettings({ openDaysBefore: 7, lockMode: 'FORCE_OPEN' });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result.cap).toBeNull();
  });

  it('lists the caller’s waitlist entries with their place in each spot’s queue', async () => {
    const [a1, b2] = [double.seedSpot({ label: 'A1' }), double.seedSpot({ label: 'B2' })];
    const [viewer, other] = [double.seedUser(), double.seedUser()];
    const at = (minute: number) => new Date(Date.UTC(2026, 7, 1, 8, minute));
    double.seedWaitlistEntry({
      parkingSpotId: a1.id,
      userId: other.id,
      date: '2026-09-07',
      createdAt: at(1),
    });
    double.seedWaitlistEntry({
      parkingSpotId: a1.id,
      userId: viewer.id,
      date: '2026-09-07',
      createdAt: at(2),
    });
    double.seedWaitlistEntry({
      parkingSpotId: b2.id,
      userId: viewer.id,
      date: '2026-09-03',
      createdAt: at(3),
    });
    double.seedWaitlistEntry({
      parkingSpotId: a1.id,
      userId: viewer.id,
      date: '2026-10-01',
      createdAt: at(4),
    });

    const result = await reservations.myMonth(
      { month: '2026-09' },
      authenticated(viewer.id),
      IN_WINDOW
    );

    expect(result.waitlist).toEqual([
      { date: '2026-09-03', parkingSpotId: b2.id, parkingSpotLabel: 'B2', position: 1 },
      { date: '2026-09-07', parkingSpotId: a1.id, parkingSpotLabel: 'A1', position: 2 },
    ]);
    expect(result.count).toBe(0);
  });
});

describe('ReservationsService.userMonth', () => {
  let double: PrismaDouble;
  let reservations: ReservationsService;

  beforeEach(() => {
    double = new PrismaDouble();
    const prisma = double.asPrismaService();
    const audit = new AuditLogService(prisma);
    const window = new ReservationWindowService(prisma, audit);
    reservations = new ReservationsService(
      prisma,
      window,
      new ReservationPolicy(),
      new WaitlistPromotionService(audit),
      audit,
      noopPublisher,
      new ReservationLimitsService(prisma, audit)
    );
  });

  it('answers about the named user, not the calling admin', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [admin, holder] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: admin.id, date: '2026-09-01' });
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-09-07' });
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-09-14' });

    const result = await reservations.userMonth(
      { userId: holder.id, month: '2026-09' },
      authenticated(admin.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: ['2026-09-07', '2026-09-14'],
      count: 2,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
    });
  });

  it('answers the same thing myMonth does when the named user is the caller', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-09-07' });

    const actor = authenticated(viewer.id);
    expect(
      await reservations.userMonth({ userId: viewer.id, month: '2026-09' }, actor, IN_WINDOW)
    ).toEqual(
      expect.objectContaining(
        omitMyMonthExtras(await reservations.myMonth({ month: '2026-09' }, actor, IN_WINDOW))
      )
    );
  });

  it('answers an empty month for a user with no reservations in it', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const [admin, holder] = [double.seedUser(), double.seedUser()];
    double.seedReservation({ parkingSpotId: spot.id, userId: holder.id, date: '2026-10-01' });

    const result = await reservations.userMonth(
      { userId: holder.id, month: '2026-09' },
      authenticated(admin.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: [],
      count: 0,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
    });
  });

  it('answers an empty month for an id that holds nothing, rather than throwing', async () => {
    const admin = double.seedUser();
    // A well-formed but unassigned `userId`: the contract's `idSchema` is a
    // uuid, and the sibling database spec notes the real `@db.Uuid` column
    // would reject an arbitrary string before it ever reached this path.
    const noSuchUser = '00000000-0000-0000-0000-000000000000';

    const result = await reservations.userMonth(
      { userId: noSuchUser, month: '2026-09' },
      authenticated(admin.id),
      IN_WINDOW
    );

    expect(result).toEqual({
      month: '2026-09',
      reservedDates: [],
      count: 0,
      cap: DEFAULT_MONTHLY_RESERVATION_CAP,
    });
  });
});
