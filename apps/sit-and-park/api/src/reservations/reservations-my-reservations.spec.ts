import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaDouble } from '../testing/prisma-double';
import { ReservationLimitsService } from '../reservation-limits/reservation-limits.service';
import { ReservationWindowService } from '../reservation-window/reservation-window.service';
import { ReservationsService } from './reservations.service';
import { WaitlistPromotionService } from './waitlist-promotion.service';
import { ReservationPolicy } from './reservation-policy';
import type { DomainEventPublisher } from './reservation-events';

const noopPublisher: DomainEventPublisher = {
  publish: jest.fn(),
  notifyPromotions: jest.fn(),
  deskReserved: jest.fn(),
  deskReleased: jest.fn(),
  deskApprovalRequested: jest.fn(),
  deskApprovalDecided: jest.fn(),
};

const TODAY = '2026-09-15';

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

describe('ReservationsService.myReservations', () => {
  let double: PrismaDouble;
  let reservations: ReservationsService;

  beforeEach(() => {
    double = new PrismaDouble();
    const prisma = double.asPrismaService();
    const audit = new AuditLogService(prisma);
    reservations = new ReservationsService(
      prisma,
      new ReservationWindowService(prisma, audit),
      new ReservationPolicy(),
      new WaitlistPromotionService(audit),
      audit,
      noopPublisher,
      new ReservationLimitsService(prisma, audit)
    );
  });

  it('lists the caller’s reservations ascending, a year ahead included, with the spot label', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2027-09-01' });
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2026-09-16' });

    const result = await reservations.myReservations(authenticated(viewer.id), TODAY);

    expect(result.reservations.map((r) => [r.date, r.parkingSpotLabel])).toEqual([
      ['2026-09-16', 'A1'],
      ['2027-09-01', 'A1'],
    ]);
    for (const entry of result.reservations) {
      expect(entry).toMatchObject({ userId: viewer.id, parkingSpotId: spot.id });
    }
  });

  it('does not list another user’s reservations', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const viewer = double.seedUser();
    const other = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: other.id, date: '2026-09-16' });

    const result = await reservations.myReservations(authenticated(viewer.id), TODAY);

    expect(result.reservations).toEqual([]);
  });

  it('reaches back DESK_HISTORY_MONTHS months and no further', async () => {
    const spot = double.seedSpot({ label: 'A1' });
    const spot2 = double.seedSpot({ label: 'A2' });
    const viewer = double.seedUser();
    double.seedReservation({ parkingSpotId: spot.id, userId: viewer.id, date: '2025-09-15' });
    double.seedReservation({ parkingSpotId: spot2.id, userId: viewer.id, date: '2025-09-14' });

    const result = await reservations.myReservations(authenticated(viewer.id), TODAY);

    expect(result.reservations.map((r) => r.date)).toEqual(['2025-09-15']);
  });
});
