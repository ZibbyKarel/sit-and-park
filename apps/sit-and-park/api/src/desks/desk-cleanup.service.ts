/**
 * Clean-up other modules run inside their own transaction when a desk, a hive,
 * an office or a user changes under existing bookings (`doc/desk-merge-plan.md`
 * §"Defects of the source that are fixed"): admin desk edits (stage 4B) and
 * employee deactivation (stage 5) reuse these instead of re-implementing them.
 *
 * Both methods write through the caller's `tx` and never publish: the caller
 * passes the returned events to {@link DeskCleanupService.publish} **after**
 * its transaction committed, the same after-commit arrangement as
 * `reservations.service.ts`.
 */

import { Injectable } from '@nestjs/common';
import type { DeskReleasedEvent } from '@sit-and-park/contract/realtime';
import type { Prisma } from '@sit-and-park/database';
import type { DateOnly } from '@sit-and-park/shared-types';
import { todayInPrague } from '@sit-and-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuditPayloads } from '../audit/audit-payloads';
import { toDateColumn, toDateOnly } from '../common/prisma-mapping';
import { DomainEventPublisher } from '../reservations/reservation-events';

/** Why a reservation is cancelled by somebody other than its holder. */
export type DeskCleanupCancelReason = Exclude<
  AuditPayloads['DESK_RESERVATION_CANCELLED_BY_ADMIN']['reason'],
  'USER'
>;

/** Why a pending request is rejected without anybody deciding it. */
export type DeskCleanupRejectReason = Exclude<
  AuditPayloads['DESK_APPROVAL_DECIDED']['reason'],
  'DECIDED'
>;

@Injectable()
export class DeskCleanupService {
  constructor(
    private readonly audit: AuditLogService,
    private readonly publisher: DomainEventPublisher
  ) {}

  /**
   * Deletes the desk reservations matching `where` dated **today or later**
   * (history is never touched, whatever `where` says), audits each as
   * `DESK_RESERVATION_CANCELLED_BY_ADMIN` (`DESK_RESERVATION_CANCELLED` when
   * the actor is the holder) with `reason`, and returns the
   * `desk:released` events to publish after commit. `actorUserId` must be a
   * real user (the audit log's FK).
   */
  async cancelReservations(
    tx: Prisma.TransactionClient,
    where: Prisma.DeskReservationWhereInput,
    reason: DeskCleanupCancelReason,
    actorUserId: string,
    today: DateOnly = todayInPrague()
  ): Promise<DeskReleasedEvent[]> {
    const rows = await tx.deskReservation.findMany({
      where: { AND: [where, { date: { gte: toDateColumn(today) } }] },
      select: {
        id: true,
        deskId: true,
        userId: true,
        date: true,
        desk: { select: { code: true } },
      },
    });
    if (rows.length === 0) {
      return [];
    }
    await tx.deskReservation.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    await this.audit.recordMany(
      rows.map((row) => ({
        actorUserId,
        // The employee sync deactivates a user as themself: that is not an admin's doing.
        action:
          row.userId === actorUserId
            ? ('DESK_RESERVATION_CANCELLED' as const)
            : ('DESK_RESERVATION_CANCELLED_BY_ADMIN' as const),
        entityType: 'DeskReservation' as const,
        entityId: row.id,
        payload: {
          deskId: row.deskId,
          deskCode: row.desk.code,
          date: toDateOnly(row.date),
          userId: row.userId,
          reason,
        },
      })),
      tx
    );
    return rows.map((row) => ({
      date: toDateOnly(row.date),
      deskId: row.deskId,
      reservationId: row.id,
    }));
  }

  /**
   * Marks every `PENDING` request matching `where` as `REJECTED` (any date),
   * decided by `actorUserId` now, audited as `DESK_APPROVAL_DECIDED` with
   * `reason`. Returns how many were rejected. Broadcasts nothing: requests are
   * not part of the realtime contract.
   */
  async rejectPendingRequests(
    tx: Prisma.TransactionClient,
    where: Prisma.DeskApprovalRequestWhereInput,
    reason: DeskCleanupRejectReason,
    actorUserId: string
  ): Promise<number> {
    const rows = await tx.deskApprovalRequest.findMany({
      where: { AND: [where, { status: 'PENDING' }] },
      select: {
        id: true,
        deskId: true,
        userId: true,
        date: true,
        desk: { select: { code: true } },
      },
    });
    if (rows.length === 0) {
      return 0;
    }
    await tx.deskApprovalRequest.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: actorUserId, decidedAt: new Date() },
    });
    await this.audit.recordMany(
      rows.map((row) => ({
        actorUserId,
        action: 'DESK_APPROVAL_DECIDED' as const,
        entityType: 'DeskApprovalRequest' as const,
        entityId: row.id,
        payload: {
          deskId: row.deskId,
          deskCode: row.desk.code,
          date: toDateOnly(row.date),
          userId: row.userId,
          status: 'REJECTED' as const,
          reason,
        },
      })),
      tx
    );
    return rows.length;
  }

  /**
   * Clears `preferredDeskId` of everyone who prefers `deskId`: run when the
   * desk is deactivated or moves to another office, so a preference never
   * points at a desk its owner could not pick again. Not audited (a setting,
   * not a booking). Returns how many users were changed.
   */
  async clearPreferredDesk(tx: Prisma.TransactionClient, deskId: string): Promise<number> {
    const { count } = await tx.user.updateMany({
      where: { preferredDeskId: deskId },
      data: { preferredDeskId: null },
    });
    return count;
  }

  /** Broadcasts what {@link cancelReservations} returned. Call after commit only. */
  publish(events: readonly DeskReleasedEvent[]): void {
    for (const event of events) {
      this.publisher.deskReleased(event);
    }
  }
}
