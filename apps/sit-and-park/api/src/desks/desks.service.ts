/**
 * Desk booking for the caller: the day's directory, series preview and
 * booking, cancelling, and a permanent holder's releases.
 *
 * Same concurrency arrangement as `reservations.service.ts`: correctness rests
 * on the unique indexes `DeskReservation (deskId, date)` and `(userId, date)`
 * plus `SELECT … FOR UPDATE` on the desk row (`lockDesk`), the reads before
 * them only produce better errors, and events are published after commit.
 */

import { Injectable } from '@nestjs/common';
import type {
  CancelDeskReleaseInput,
  CancelDeskReleaseOutput,
  CancelDeskReservationInput,
  CancelDeskReservationOutput,
  DeskDirectoryInput,
  DeskDirectoryOutput,
  DeskSeriesDay,
  DeskSeriesInput,
  MyDeskReleasesOutput,
  MyDeskReservationsOutput,
  PreviewDeskSeriesOutput,
  ReleaseDeskInput,
  ReleaseDeskOutput,
  ReserveDeskOutput,
} from '@sit-and-park/contract';
import type { FloorPlan, DateOnly } from '@sit-and-park/shared-types';
import {
  addMonths,
  compareDateOnly,
  DESK_HISTORY_MONTHS,
  FLOOR_PLANS,
  todayInPrague,
} from '@sit-and-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { DomainError } from '../common/errors/domain-error';
import {
  isUniqueConstraintViolation,
  mapUniqueConstraintViolation,
} from '../common/errors/prisma-error-mapping';
import { toDateColumn, toDateOnly } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import { DomainEventPublisher } from '../reservations/reservation-events';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';
import { DeskCleanupService } from './desk-cleanup.service';
import type { DeskReader } from './desk-db';
import {
  loadCaller,
  lockDesk,
  lockUser,
  toContractDesk,
  toContractDeskReservation,
} from './desk-db';
import type { DeskFacts } from './desk-rules';
import { assertSeriesAllowed, deskAccess, deskStatus, planSeries } from './desk-rules';

/** The earliest date the caller's own lists reach back to (`DESK_HISTORY_MONTHS`). */
export function historyFloor(today: DateOnly): Date {
  return toDateColumn(addMonths(today, -DESK_HISTORY_MONTHS));
}

function isFloorPlan(value: string | null): value is FloorPlan {
  return value !== null && (FLOOR_PLANS as readonly string[]).includes(value);
}

/**
 * Turns a lost race on a desk unique index into its contract code. The
 * oRPC middleware would map it too; doing it here keeps the service's own
 * callers (tests, other modules) on `DomainError`.
 */
export function rethrowUnique(error: unknown): never {
  if (isUniqueConstraintViolation(error)) {
    throw new DomainError(mapUniqueConstraintViolation(error.meta), {
      message: 'A concurrent booking took this desk or day first.',
    });
  }
  throw error;
}

@Injectable()
export class DesksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly publisher: DomainEventPublisher,
    private readonly cleanup: DeskCleanupService
  ) {}

  /** Every desk of the caller's office for one day. A fixed set of queries, no N+1. */
  async directory(
    input: DeskDirectoryInput,
    actor: AuthenticatedUser
  ): Promise<DeskDirectoryOutput> {
    const db = this.prisma.client;
    const caller = await loadCaller(db, actor.id);
    if (caller.officeId === null) {
      throw new DomainError('NO_OFFICE_ASSIGNED');
    }
    const officeId = caller.officeId;
    const date = toDateColumn(input.date);

    const [office, zones, hives, desks, reservations, releases, myPending] = await Promise.all([
      db.office.findUniqueOrThrow({ where: { id: officeId } }),
      db.zone.findMany({ where: { officeId }, orderBy: { name: 'asc' } }),
      db.hive.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
      db.desk.findMany({
        where: { officeId },
        include: {
          zone: { select: { name: true } },
          hive: { select: { name: true, color: true } },
          permanentAssignee: { select: { name: true } },
        },
        orderBy: { code: 'asc' },
      }),
      db.deskReservation.findMany({
        where: { date, desk: { officeId } },
        select: { id: true, deskId: true, userId: true, user: { select: { name: true } } },
      }),
      db.deskRelease.findMany({ where: { date, desk: { officeId } }, select: { deskId: true } }),
      db.deskApprovalRequest.findMany({
        where: { date, userId: caller.id, status: 'PENDING' },
        select: { id: true, deskId: true },
      }),
    ]);

    const reservationByDesk = new Map(reservations.map((row) => [row.deskId, row]));
    const releasedDesks = new Set(releases.map((row) => row.deskId));
    const myPendingByDesk = new Map(myPending.map((row) => [row.deskId, row.id]));

    return {
      date: input.date,
      office: {
        id: office.id,
        name: office.name,
        floorPlan: isFloorPlan(office.floorPlan) ? office.floorPlan : null,
        floorPlanWidth: office.floorPlanWidth,
        floorPlanHeight: office.floorPlanHeight,
      },
      zones: zones.map((zone) => ({
        id: zone.id,
        officeId: zone.officeId,
        key: zone.key,
        name: zone.name,
      })),
      hives,
      desks: desks.map((desk) => {
        const reservation = reservationByDesk.get(desk.id) ?? null;
        const released = releasedDesks.has(desk.id);
        return {
          ...toContractDesk(desk),
          zoneName: desk.zone.name,
          hiveName: desk.hive?.name ?? null,
          hiveColor: desk.hive?.color ?? null,
          status: deskStatus(
            desk,
            { reservedByUserId: reservation?.userId ?? null, released },
            caller.id
          ),
          access: deskAccess(desk, caller),
          reservedByName: reservation?.user.name ?? null,
          permanentAssigneeName: desk.permanentAssignee?.name ?? null,
          releasedOn: desk.permanentAssigneeId !== null && released,
          myReservationId: reservation?.userId === caller.id ? reservation.id : null,
          myPendingRequestId: myPendingByDesk.get(desk.id) ?? null,
          assignedToMe: desk.permanentAssigneeId === caller.id,
          grantedToMe: caller.grantedDeskIds.has(desk.id),
        };
      }),
    };
  }

  /** The plan `reserve` would execute, without writing. */
  async previewSeries(
    input: DeskSeriesInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<PreviewDeskSeriesOutput> {
    const { days } = await this.plan(this.prisma.client, input, actor.id, today);
    return { days };
  }

  /**
   * Books the plan's free days in one transaction, with the desk locked so
   * concurrent series on it serialise. The caller booking another desk at the
   * same moment is not serialised by that lock; `(userId, date)` stops it and
   * {@link rethrowUnique} reports it as `DESK_RESERVATION_LIMIT_REACHED`.
   */
  async reserve(
    input: DeskSeriesInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<ReserveDeskOutput> {
    const outcome = await this.prisma.client
      .$transaction(async (tx) => {
        await lockDesk(tx, input.deskId);
        // Orders this booking against the caller becoming a permanent holder
        // of another desk; `plan` reads the caller's facts after it.
        await lockUser(tx, actor.id, 'SHARE');
        const { desk, days, callerName } = await this.plan(tx, input, actor.id, today);
        const free = days.filter((day) => day.ok);
        if (free.length === 0) {
          throw new DomainError('NO_FREE_DAY');
        }
        const rows = await tx.deskReservation.createManyAndReturn({
          data: free.map((day) => ({
            deskId: desk.id,
            userId: actor.id,
            date: toDateColumn(day.date),
          })),
        });
        await this.audit.recordMany(
          rows.map((row) => ({
            actorUserId: actor.id,
            action: 'DESK_RESERVATION_CREATED' as const,
            entityType: 'DeskReservation' as const,
            entityId: row.id,
            payload: {
              deskId: desk.id,
              deskCode: desk.code,
              date: toDateOnly(row.date),
              userId: actor.id,
            },
          })),
          tx
        );
        // Pending requests that can no longer be approved: other people's for
        // this desk, and the caller's own for any desk, on the booked days.
        const date = { in: rows.map((row) => row.date) };
        await this.cleanup.rejectPendingRequests(
          tx,
          { deskId: desk.id, date, userId: { not: actor.id } },
          'DESK_TAKEN',
          actor.id
        );
        await this.cleanup.rejectPendingRequests(
          tx,
          { userId: actor.id, date },
          'REQUESTER_HAS_DESK',
          actor.id
        );
        return { rows, days, callerName };
      }, RESERVATION_TRANSACTION_OPTIONS)
      .catch(rethrowUnique);

    const reserved = outcome.rows
      .map(toContractDeskReservation)
      .sort((a, b) => compareDateOnly(a.date, b.date));
    for (const reservation of reserved) {
      this.publisher.deskReserved({
        date: reservation.date,
        deskId: reservation.deskId,
        reservationId: reservation.id,
        userId: reservation.userId,
        userName: outcome.callerName,
      });
    }
    return {
      reserved,
      skipped: outcome.days.flatMap((day) =>
        day.reason === null ? [] : [{ date: day.date, reason: day.reason }]
      ),
    };
  }

  /** The holder cancels today and later; an admin anything, anybody's. */
  async cancel(
    input: CancelDeskReservationInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<CancelDeskReservationOutput> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const caller = await loadCaller(tx, actor.id);
      const row = await tx.deskReservation.findUnique({
        where: { id: input.reservationId },
        include: { desk: { select: { code: true } } },
      });
      if (row === null) {
        throw new DomainError('NOT_FOUND', { message: 'No such desk reservation.' });
      }
      const isOwner = row.userId === caller.id;
      if (!isOwner && !caller.isAdmin) {
        throw new DomainError('FORBIDDEN', {
          message: 'Only the holder of a desk reservation, or an admin, may cancel it.',
        });
      }
      const date = toDateOnly(row.date);
      if (compareDateOnly(date, today) < 0 && !caller.isAdmin) {
        throw new DomainError('PAST_DATE', {
          message: 'A past desk reservation cannot be cancelled.',
        });
      }
      await tx.deskReservation.delete({ where: { id: row.id } });
      const payload = {
        deskId: row.deskId,
        deskCode: row.desk.code,
        date,
        userId: row.userId,
      };
      await this.audit.record(
        isOwner
          ? {
              actorUserId: caller.id,
              action: 'DESK_RESERVATION_CANCELLED',
              entityType: 'DeskReservation',
              entityId: row.id,
              payload: { ...payload, reason: 'USER' },
            }
          : {
              actorUserId: caller.id,
              action: 'DESK_RESERVATION_CANCELLED_BY_ADMIN',
              entityType: 'DeskReservation',
              entityId: row.id,
              payload: { ...payload, reason: 'ADMIN' },
            },
        tx
      );
      return { reservationId: row.id, date, deskId: row.deskId };
    }, RESERVATION_TRANSACTION_OPTIONS);

    this.publisher.deskReleased(result);
    return result;
  }

  async myReservations(
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<MyDeskReservationsOutput> {
    const rows = await this.prisma.client.deskReservation.findMany({
      where: { userId: actor.id, date: { gte: historyFloor(today) } },
      include: {
        desk: {
          select: {
            code: true,
            zone: { select: { name: true } },
            hive: { select: { name: true } },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    return {
      reservations: rows.map((row) => ({
        ...toContractDeskReservation(row),
        deskCode: row.desk.code,
        zoneName: row.desk.zone.name,
        hiveName: row.desk.hive?.name ?? null,
      })),
    };
  }

  // --- releases ---------------------------------------------------------------

  async myReleases(
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<MyDeskReleasesOutput> {
    const db = this.prisma.client;
    const desk = await db.desk.findUnique({
      where: { permanentAssigneeId: actor.id },
      select: { id: true, code: true },
    });
    if (desk === null) {
      return null;
    }
    const releases = await db.deskRelease.findMany({
      where: { deskId: desk.id, date: { gte: toDateColumn(today) } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true },
    });
    const reservations = await db.deskReservation.findMany({
      where: { deskId: desk.id, date: { in: releases.map((release) => release.date) } },
      select: { date: true, user: { select: { name: true } } },
    });
    const nameByDate = new Map(reservations.map((row) => [toDateOnly(row.date), row.user.name]));
    return {
      deskId: desk.id,
      code: desk.code,
      releases: releases.map((release) => {
        const date = toDateOnly(release.date);
        return { id: release.id, date, reservedByName: nameByDate.get(date) ?? null };
      }),
    };
  }

  /**
   * Releases the caller's permanent desk on today-or-later dates; existing ones
   * are skipped. Locks the desk and re-reads its holder like
   * {@link cancelRelease}, so a reassignment that lands first is seen.
   */
  async release(
    input: ReleaseDeskInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<ReleaseDeskOutput> {
    return this.prisma.client.$transaction(async (tx) => {
      const found = await tx.desk.findUnique({
        where: { permanentAssigneeId: actor.id },
        select: { id: true },
      });
      if (found === null) {
        throw new DomainError('NO_PERMANENT_DESK');
      }
      await lockDesk(tx, found.id);
      const desk = await tx.desk.findUnique({
        where: { id: found.id },
        select: { id: true, code: true, permanentAssigneeId: true },
      });
      if (desk?.permanentAssigneeId !== actor.id) {
        throw new DomainError('NO_PERMANENT_DESK');
      }
      const dates = [...new Set(input.dates)].sort(compareDateOnly);
      if (dates.some((date) => compareDateOnly(date, today) < 0)) {
        throw new DomainError('PAST_DATE', { message: 'Past days cannot be released.' });
      }
      const rows = await tx.deskRelease.createManyAndReturn({
        data: dates.map((date) => ({
          deskId: desk.id,
          date: toDateColumn(date),
          releasedById: actor.id,
        })),
        // An already released day is skipped, not an error.
        skipDuplicates: true,
      });
      await this.audit.recordMany(
        rows.map((row) => ({
          actorUserId: actor.id,
          action: 'DESK_RELEASED' as const,
          entityType: 'DeskRelease' as const,
          entityId: row.id,
          payload: { deskId: desk.id, deskCode: desk.code, date: toDateOnly(row.date) },
        })),
        tx
      );
      return { added: rows.length };
    }, RESERVATION_TRANSACTION_OPTIONS);
  }

  /**
   * Withdraws one release of the caller's own desk, unless somebody booked
   * that day. The desk is locked first, so a booking of the released day
   * either committed before this (and is seen) or waits and then finds the
   * day assigned again.
   */
  async cancelRelease(
    input: CancelDeskReleaseInput,
    actor: AuthenticatedUser
  ): Promise<CancelDeskReleaseOutput> {
    return this.prisma.client.$transaction(async (tx) => {
      const found = await tx.deskRelease.findUnique({
        where: { id: input.releaseId },
        select: { deskId: true },
      });
      if (found === null) {
        throw new DomainError('NOT_FOUND', { message: 'No such release.' });
      }
      await lockDesk(tx, found.deskId);
      const release = await tx.deskRelease.findUnique({
        where: { id: input.releaseId },
        include: { desk: { select: { code: true, permanentAssigneeId: true } } },
      });
      if (release === null) {
        throw new DomainError('NOT_FOUND', { message: 'No such release.' });
      }
      if (release.desk.permanentAssigneeId !== actor.id) {
        throw new DomainError('FORBIDDEN', { message: 'This release is not of your desk.' });
      }
      const booked = await tx.deskReservation.findUnique({
        where: { deskId_date: { deskId: release.deskId, date: release.date } },
        select: { id: true },
      });
      if (booked !== null) {
        throw new DomainError('DESK_RELEASE_ALREADY_RESERVED');
      }
      await tx.deskRelease.delete({ where: { id: release.id } });
      await this.audit.record(
        {
          actorUserId: actor.id,
          action: 'DESK_RELEASE_CANCELLED',
          entityType: 'DeskRelease',
          entityId: release.id,
          payload: {
            deskId: release.deskId,
            deskCode: release.desk.code,
            date: toDateOnly(release.date),
          },
        },
        tx
      );
      return { releaseId: release.id };
    }, RESERVATION_TRANSACTION_OPTIONS);
  }

  // --- the shared plan ----------------------------------------------------------

  /**
   * Loads every fact the series rules need and computes the plan. Throws the
   * series-level blockers. Runs on whatever `db` is given — inside `reserve`'s
   * transaction, after the desk lock, so the plan is still true at the insert.
   */
  private async plan(
    db: DeskReader,
    input: DeskSeriesInput,
    callerId: string,
    today: DateOnly
  ): Promise<{ desk: DeskFacts & { code: string }; days: DeskSeriesDay[]; callerName: string }> {
    const caller = await loadCaller(db, callerId);
    const desk = await db.desk.findUnique({
      where: { id: input.deskId },
      select: {
        id: true,
        code: true,
        officeId: true,
        hiveId: true,
        active: true,
        permanentAssigneeId: true,
      },
    });
    assertSeriesAllowed(desk, caller);

    const dates = { in: input.dates.map(toDateColumn) };
    const onDesk = await db.deskReservation.findMany({
      where: { deskId: desk.id, date: dates },
      select: { userId: true, date: true },
    });
    const mine = await db.deskReservation.findMany({
      where: { userId: callerId, date: dates },
      select: { deskId: true, date: true },
    });
    const releases = await db.deskRelease.findMany({
      where: { deskId: desk.id, date: dates },
      select: { date: true },
    });

    const holderByDate = new Map(onDesk.map((row) => [toDateOnly(row.date), row.userId]));
    const myDeskByDate = new Map(mine.map((row) => [toDateOnly(row.date), row.deskId]));
    const released = new Set(releases.map((row) => toDateOnly(row.date)));

    const days = planSeries(
      desk,
      input.dates.map((date) => ({
        date,
        reservedByUserId: holderByDate.get(date) ?? null,
        released: released.has(date),
        callerReservedDeskId: myDeskByDate.get(date) ?? null,
      })),
      today
    );
    return { desk, days, callerName: caller.name };
  }
}
