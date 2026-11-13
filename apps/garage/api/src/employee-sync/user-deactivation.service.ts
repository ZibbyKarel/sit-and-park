/**
 * Deactivating a user, whoever asks: the employee sync, or an admin through
 * `admin.user.update` (`doc/decision/0329-*`).
 *
 * One transaction per user flips the account off (`active = false`,
 * `deactivatedAt`), frees their future desk reservations and rejects their
 * pending desk requests (through `DeskCleanupService`), removes their future
 * waitlist entries and audits `USER_DEACTIVATED`. Hives they own and a
 * permanent desk are kept and only reported back, so a human decides.
 *
 * **Future parking reservations are cancelled after that commit**, one by one
 * through `ReservationsService.cancel`, because a freed spot must go to the
 * next person queued for it and that path already owns the promotion, its
 * retry loop, the broadcast and the Slack notice. Promotion cannot join the
 * user transaction: its retry re-runs a whole transaction. The account is
 * already inactive by then, so the user cannot book anything in the gap.
 *
 * A cancel that fails is logged and counted, not thrown, and the clean-up is
 * **re-runnable**: calling {@link UserDeactivationService.deactivate} for a
 * user who is already inactive finishes whatever is left (the employee sync
 * sweeps such users on every run, an admin re-saving "inactive" does the same).
 * Only the call that actually flips the account audits `USER_DEACTIVATED`, so
 * the audit trail keeps who deactivated the user, which decides whether the
 * sync may reactivate them.
 */

import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '@garage/database';
import type { DateOnly } from '@garage/shared-types';
import { todayInPrague } from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { DomainError } from '../common/errors/domain-error';
import { toDateColumn, toDateOnly } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import { DeskCleanupService } from '../desks/desk-cleanup.service';
import type { DomainEvent } from '../reservations/reservation-events';
import { DomainEventPublisher } from '../reservations/reservation-events';
import { ReservationsService } from '../reservations/reservations.service';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';

/** What deactivating one user frees (or, read-only, would free). */
export interface DeactivationReport {
  freedDeskReservations: number;
  freedParkingReservations: number;
  removedWaitlistEntries: number;
  rejectedRequests: number;
  permanentDesks: string[];
  ownedHives: string[];
}

export interface DeactivationOutcome {
  /** `freedParkingReservations` counts the cancels that succeeded. */
  report: DeactivationReport;
  /** Future parking reservations whose cancel failed; a later call retries them. */
  failedParkingReservations: number;
}

type Reader = Pick<
  Prisma.TransactionClient,
  'deskReservation' | 'deskApprovalRequest' | 'reservation' | 'waitlistEntry' | 'desk' | 'hive'
>;

@Injectable()
export class UserDeactivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deskCleanup: DeskCleanupService,
    private readonly reservations: ReservationsService,
    private readonly audit: AuditLogService,
    private readonly publisher: DomainEventPublisher,
    @InjectPinoLogger(UserDeactivationService.name) private readonly logger: PinoLogger
  ) {}

  /** What {@link deactivate} would do, without doing it (the sync's dry run). */
  inspect(userId: string, today: DateOnly = todayInPrague()): Promise<DeactivationReport> {
    return this.collect(this.prisma.client, userId, today).then(({ report }) => report);
  }

  /**
   * Deactivates `userId`, or finishes the clean-up of a user already inactive.
   * `actorUserId` is who the audit trail names: the admin, or for the sync
   * (which is not a user) the deactivated user themselves, as system actions
   * are attributed to their trigger.
   */
  async deactivate(
    userId: string,
    source: 'EMPLOYEE_SYNC' | 'ADMIN',
    actorUserId: string,
    today: DateOnly = todayInPrague()
  ): Promise<DeactivationOutcome> {
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user === null) {
        throw new DomainError('NOT_FOUND', { message: 'No such user.' });
      }
      await tx.user.update({
        where: { id: userId },
        data: { active: false, deactivatedAt: user.deactivatedAt ?? new Date() },
      });

      const { report, parkingReservationIds, waitlistCells } = await this.collect(
        tx,
        userId,
        today
      );
      const deskEvents = await this.deskCleanup.cancelReservations(
        tx,
        { userId },
        'USER_DEACTIVATED',
        actorUserId,
        today
      );
      await this.deskCleanup.rejectPendingRequests(tx, { userId }, 'USER_DEACTIVATED', actorUserId);
      await tx.waitlistEntry.deleteMany({
        where: { userId, date: { gte: toDateColumn(today) } },
      });

      // Every queue that got shorter needs its own `waitlist:updated`; the web
      // cache patches only the cells an event names.
      const waitlistEvents: DomainEvent[] = [];
      for (const cell of waitlistCells) {
        const waitlistCount = await tx.waitlistEntry.count({
          where: { parkingSpotId: cell.parkingSpotId, date: toDateColumn(cell.date) },
        });
        waitlistEvents.push({ name: 'waitlist:updated', payload: { ...cell, waitlistCount } });
      }

      if (user.active) {
        await this.audit.record(
          {
            actorUserId,
            action: 'USER_DEACTIVATED',
            entityType: 'User',
            entityId: userId,
            payload: {
              source,
              freedReservations: report.freedParkingReservations,
              freedDeskReservations: report.freedDeskReservations,
              removedWaitlistEntries: report.removedWaitlistEntries,
              rejectedRequests: report.rejectedRequests,
            },
          },
          tx
        );
      }
      return { report, parkingReservationIds, deskEvents, waitlistEvents };
    }, RESERVATION_TRANSACTION_OPTIONS);

    this.deskCleanup.publish(outcome.deskEvents);
    this.publisher.publish(outcome.waitlistEvents);

    const actor = await this.actor(actorUserId);
    let freed = 0;
    let failed = 0;
    for (const reservationId of outcome.parkingReservationIds) {
      try {
        await this.reservations.cancel({ reservationId }, actor, today);
        freed += 1;
      } catch (error) {
        // NOT_FOUND: cancelled by somebody else in the meantime, already free.
        if (!(error instanceof DomainError && error.code === 'NOT_FOUND')) {
          failed += 1;
          this.logger.error(
            { err: error, userId, reservationId },
            'Could not cancel a deactivated user’s parking reservation; the next clean-up retries'
          );
        }
      }
    }
    return {
      report: { ...outcome.report, freedParkingReservations: freed },
      failedParkingReservations: failed,
    };
  }

  private async collect(
    reader: Reader,
    userId: string,
    today: DateOnly
  ): Promise<{
    report: DeactivationReport;
    parkingReservationIds: string[];
    waitlistCells: { parkingSpotId: string; date: DateOnly }[];
  }> {
    const fromToday = { gte: toDateColumn(today) };
    const [desk, requests, parking, waitlist, permanentDesks, ownedHives] = await Promise.all([
      reader.deskReservation.count({ where: { userId, date: fromToday } }),
      reader.deskApprovalRequest.count({ where: { userId, status: 'PENDING' } }),
      reader.reservation.findMany({
        where: { userId, date: fromToday },
        select: { id: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
      reader.waitlistEntry.findMany({
        where: { userId, date: fromToday },
        select: { parkingSpotId: true, date: true },
      }),
      reader.desk.findMany({
        where: { permanentAssigneeId: userId },
        select: { code: true },
        orderBy: { code: 'asc' },
      }),
      reader.hive.findMany({
        where: { ownerId: userId },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      report: {
        freedDeskReservations: desk,
        freedParkingReservations: parking.length,
        removedWaitlistEntries: waitlist.length,
        rejectedRequests: requests,
        permanentDesks: permanentDesks.map((row) => row.code),
        ownedHives: ownedHives.map((row) => row.name),
      },
      parkingReservationIds: parking.map((row) => row.id),
      waitlistCells: waitlist.map((row) => ({
        parkingSpotId: row.parkingSpotId,
        date: toDateOnly(row.date),
      })),
    };
  }

  /** The audit actor as `ReservationsService.cancel` wants it. */
  private async actor(userId: string): Promise<AuthenticatedUser> {
    const row = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: row.id,
      oktaId: row.oktaId,
      email: row.email,
      name: row.name,
      role: row.role,
      active: row.active,
    };
  }
}
