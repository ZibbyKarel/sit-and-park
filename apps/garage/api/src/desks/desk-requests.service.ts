/**
 * Approval requests: a hive desk of the caller's office the caller cannot book
 * directly, for one date. The owner of the desk's current hive, or any admin,
 * decides; approval re-checks every booking rule for the requester, with the
 * desk locked like a booking.
 */

import { Injectable } from '@nestjs/common';
import type {
  CancelDeskRequestInput,
  CancelDeskRequestOutput,
  DecideDeskRequestInput,
  DecideDeskRequestOutput,
  DeskApprovalRequest,
  MyDeskRequestsOutput,
  PendingDeskRequestsOutput,
  RequestDeskApprovalInput,
} from '@garage/contract';
import type { DateOnly } from '@garage/shared-types';
import { compareDateOnly, todayInPrague } from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { DomainError } from '../common/errors/domain-error';
import { toDateColumn, toDateOnly } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import type { DeskApprovalNotice } from '../reservations/reservation-events';
import { DomainEventPublisher } from '../reservations/reservation-events';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';
import { DeskCleanupService } from './desk-cleanup.service';
import {
  loadCaller,
  lockDesk,
  lockUser,
  toContractDeskRequest,
  toContractDeskReservation,
} from './desk-db';
import { deskAccess, isAssignedOn } from './desk-rules';
import { historyFloor, rethrowUnique } from './desks.service';

const NOT_FOUND_REQUEST = { message: 'No such approval request.' };

@Injectable()
export class DeskRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly publisher: DomainEventPublisher,
    private readonly cleanup: DeskCleanupService
  ) {}

  /**
   * Files a `PENDING` request. Besides the contract's booking errors, a desk
   * that cannot be requested — no hive, another office, or one the caller may
   * book directly — is `VALIDATION_FAILED`. The desk is locked first, so an
   * admin edit or hive deletion that clears pending requests either commits
   * before this (and is seen) or waits and then finds this request.
   */
  async requestApproval(
    input: RequestDeskApprovalInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<DeskApprovalRequest> {
    const { request, notice } = await this.prisma.client
      .$transaction(async (tx) => {
        if (compareDateOnly(input.date, today) < 0) {
          throw new DomainError('PAST_DATE');
        }
        await lockDesk(tx, input.deskId);
        const caller = await loadCaller(tx, actor.id);
        if (caller.officeId === null) {
          throw new DomainError('NO_OFFICE_ASSIGNED');
        }
        if (caller.permanentDeskId !== null) {
          throw new DomainError('PERMANENT_DESK_HOLDER');
        }
        const desk = await tx.desk.findUnique({
          where: { id: input.deskId },
          include: { hive: { select: { ownerId: true } } },
        });
        if (desk === null) {
          throw new DomainError('NOT_FOUND', { message: 'No such desk.' });
        }
        if (desk.officeId !== caller.officeId) {
          throw new DomainError('VALIDATION_FAILED', { message: 'The desk is in another office.' });
        }
        const date = toDateColumn(input.date);
        const released =
          (await tx.deskRelease.findUnique({
            where: { deskId_date: { deskId: desk.id, date } },
            select: { id: true },
          })) !== null;
        if (!desk.active || isAssignedOn(desk, { released })) {
          throw new DomainError('DESK_NOT_AVAILABLE');
        }
        if (desk.hiveId === null || desk.hive === null) {
          throw new DomainError('VALIDATION_FAILED', { message: 'The desk is in no hive.' });
        }
        if (deskAccess(desk, caller) === 'DIRECT') {
          throw new DomainError('VALIDATION_FAILED', {
            message: 'The desk can be booked directly; no approval is needed.',
          });
        }
        const mine = await tx.deskReservation.findUnique({
          where: { userId_date: { userId: caller.id, date } },
          select: { id: true },
        });
        if (mine !== null) {
          throw new DomainError('DESK_RESERVATION_LIMIT_REACHED');
        }
        const pending = await tx.deskApprovalRequest.findFirst({
          where: { deskId: desk.id, userId: caller.id, date, status: 'PENDING' },
          select: { id: true },
        });
        if (pending !== null) {
          throw new DomainError('DESK_REQUEST_ALREADY_PENDING');
        }
        const taken = await tx.deskReservation.findUnique({
          where: { deskId_date: { deskId: desk.id, date } },
          select: { id: true },
        });
        if (taken !== null) {
          throw new DomainError('DESK_ALREADY_RESERVED');
        }

        const row = await tx.deskApprovalRequest.create({
          data: { deskId: desk.id, userId: caller.id, date },
        });
        await this.audit.record(
          {
            actorUserId: caller.id,
            action: 'DESK_APPROVAL_REQUESTED',
            entityType: 'DeskApprovalRequest',
            entityId: row.id,
            payload: { deskId: desk.id, deskCode: desk.code, date: input.date, userId: caller.id },
          },
          tx
        );
        const request = toContractDeskRequest(row);
        return {
          request,
          notice: {
            requestId: row.id,
            deskId: desk.id,
            deskCode: desk.code,
            date: input.date,
            requesterId: caller.id,
            hiveOwnerId: desk.hive.ownerId,
            status: 'PENDING',
          } satisfies DeskApprovalNotice,
        };
      }, RESERVATION_TRANSACTION_OPTIONS)
      .catch(rethrowUnique);

    this.publisher.deskApprovalRequested(notice);
    return request;
  }

  /** Deletes one of the caller's own pending requests. */
  async cancelRequest(
    input: CancelDeskRequestInput,
    actor: AuthenticatedUser
  ): Promise<CancelDeskRequestOutput> {
    const db = this.prisma.client;
    const row = await db.deskApprovalRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, userId: true, status: true },
    });
    if (row === null) {
      throw new DomainError('NOT_FOUND', NOT_FOUND_REQUEST);
    }
    if (row.userId !== actor.id) {
      throw new DomainError('FORBIDDEN', { message: 'Only its author may withdraw a request.' });
    }
    // The status guard is in the `WHERE`, so a decision that lands between the
    // read and the delete is not silently erased.
    const { count } = await db.deskApprovalRequest.deleteMany({
      where: { id: row.id, status: 'PENDING' },
    });
    if (count === 0) {
      throw new DomainError('DESK_REQUEST_ALREADY_DECIDED');
    }
    return { requestId: row.id };
  }

  async myRequests(
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<MyDeskRequestsOutput> {
    const rows = await this.prisma.client.deskApprovalRequest.findMany({
      where: { userId: actor.id, date: { gte: historyFloor(today) } },
      include: { desk: { select: { code: true, zone: { select: { name: true } } } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      requests: rows.map((row) => ({
        ...toContractDeskRequest(row),
        deskCode: row.desk.code,
        zoneName: row.desk.zone.name,
      })),
    };
  }

  /** An admin sees every pending request; anybody else those of the hives they own. */
  async pendingRequests(actor: AuthenticatedUser): Promise<PendingDeskRequestsOutput> {
    const db = this.prisma.client;
    const caller = await loadCaller(db, actor.id);
    const rows = await db.deskApprovalRequest.findMany({
      where: {
        status: 'PENDING',
        desk: caller.isAdmin ? { hiveId: { not: null } } : { hive: { ownerId: caller.id } },
      },
      include: {
        desk: {
          select: {
            code: true,
            zone: { select: { name: true } },
            hive: { select: { id: true, name: true } },
          },
        },
        user: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      requests: rows.flatMap((row) =>
        row.desk.hive === null
          ? []
          : [
              {
                ...toContractDeskRequest(row),
                deskCode: row.desk.code,
                zoneName: row.desk.zone.name,
                hiveId: row.desk.hive.id,
                hiveName: row.desk.hive.name,
                requesterName: row.user.name,
              },
            ]
      ),
    };
  }

  /**
   * Approves or rejects one pending request. Allowed for an admin or the owner
   * of the desk's **current** hive. A rejection always goes through; an
   * approval locks the desk, then the requester (order desk → user, see
   * `lockUser`), re-checks the date, the desk and the requester, books, and
   * rejects the other pending requests for that desk and day (reason
   * `DESK_TAKEN`, no notification: they can no longer be approved).
   */
  async decideRequest(
    input: DecideDeskRequestInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<DecideDeskRequestOutput> {
    const outcome = await this.prisma.client
      .$transaction(async (tx) => {
        const found = await tx.deskApprovalRequest.findUnique({
          where: { id: input.requestId },
          select: { deskId: true },
        });
        if (found === null) {
          throw new DomainError('NOT_FOUND', NOT_FOUND_REQUEST);
        }
        // Locked for a rejection too: it is cheap, and it orders this decision
        // against a concurrent approval of the same request.
        await lockDesk(tx, found.deskId);

        const request = await tx.deskApprovalRequest.findUnique({
          where: { id: input.requestId },
          include: { desk: { include: { hive: { select: { ownerId: true } } } } },
        });
        if (request === null) {
          throw new DomainError('NOT_FOUND', NOT_FOUND_REQUEST);
        }
        if (input.approve) {
          // Before reading the requester: orders this booking against the
          // requester becoming a permanent holder of another desk.
          await lockUser(tx, request.userId, 'SHARE');
        }
        const requester = await tx.user.findUniqueOrThrow({
          where: { id: request.userId },
          select: {
            id: true,
            name: true,
            active: true,
            officeId: true,
            permanentDesk: { select: { id: true } },
          },
        });
        const caller = await loadCaller(tx, actor.id);
        const { desk } = request;
        if (!caller.isAdmin && desk.hive?.ownerId !== caller.id) {
          throw new DomainError('FORBIDDEN', {
            message: 'Only the owner of the desk’s hive, or an admin, may decide this request.',
          });
        }
        if (request.status !== 'PENDING') {
          throw new DomainError('DESK_REQUEST_ALREADY_DECIDED');
        }

        const date = toDateOnly(request.date);
        const cell = { deskId: desk.id, deskCode: desk.code, date };
        let reservation = null;

        if (input.approve) {
          if (compareDateOnly(date, today) < 0) {
            throw new DomainError('PAST_DATE');
          }
          if (!desk.active) {
            throw new DomainError('DESK_NOT_AVAILABLE');
          }
          if (desk.hiveId === null) {
            throw new DomainError('VALIDATION_FAILED', {
              message: 'The desk is in no hive any more.',
            });
          }
          const released =
            (await tx.deskRelease.findUnique({
              where: { deskId_date: { deskId: desk.id, date: request.date } },
              select: { id: true },
            })) !== null;
          if (isAssignedOn(desk, { released })) {
            throw new DomainError('DESK_NOT_AVAILABLE');
          }
          if (!requester.active) {
            throw new DomainError('VALIDATION_FAILED', {
              message: 'The requester is deactivated.',
            });
          }
          if (requester.officeId !== desk.officeId) {
            throw new DomainError('VALIDATION_FAILED', {
              message: 'The requester is not in the desk’s office.',
            });
          }
          if (requester.permanentDesk !== null) {
            throw new DomainError('PERMANENT_DESK_HOLDER');
          }
          const requesterDesk = await tx.deskReservation.findUnique({
            where: { userId_date: { userId: requester.id, date: request.date } },
            select: { id: true },
          });
          if (requesterDesk !== null) {
            throw new DomainError('DESK_RESERVATION_LIMIT_REACHED');
          }
          const taken = await tx.deskReservation.findUnique({
            where: { deskId_date: { deskId: desk.id, date: request.date } },
            select: { id: true },
          });
          if (taken !== null) {
            throw new DomainError('DESK_ALREADY_RESERVED');
          }
          reservation = await tx.deskReservation.create({
            data: { deskId: desk.id, userId: requester.id, date: request.date },
          });
          await this.audit.record(
            {
              actorUserId: caller.id,
              action: 'DESK_RESERVATION_CREATED',
              entityType: 'DeskReservation',
              entityId: reservation.id,
              payload: { ...cell, userId: requester.id },
            },
            tx
          );
          await this.cleanup.rejectPendingRequests(
            tx,
            { deskId: desk.id, date: request.date, id: { not: request.id } },
            'DESK_TAKEN',
            caller.id
          );
          await this.cleanup.rejectPendingRequests(
            tx,
            { userId: requester.id, date: request.date, id: { not: request.id } },
            'REQUESTER_HAS_DESK',
            caller.id
          );
        }

        const status = input.approve ? 'APPROVED' : 'REJECTED';
        const decided = await tx.deskApprovalRequest.update({
          where: { id: request.id },
          data: { status, decidedById: caller.id, decidedAt: new Date() },
        });
        await this.audit.record(
          {
            actorUserId: caller.id,
            action: 'DESK_APPROVAL_DECIDED',
            entityType: 'DeskApprovalRequest',
            entityId: request.id,
            payload: { ...cell, userId: requester.id, status, reason: 'DECIDED' },
          },
          tx
        );
        return {
          request: toContractDeskRequest(decided),
          reservation: reservation === null ? null : toContractDeskReservation(reservation),
          requesterName: requester.name,
          notice: {
            requestId: request.id,
            deskId: desk.id,
            deskCode: desk.code,
            date,
            requesterId: requester.id,
            hiveOwnerId: desk.hive?.ownerId ?? null,
            status,
          } satisfies DeskApprovalNotice,
        };
      }, RESERVATION_TRANSACTION_OPTIONS)
      .catch(rethrowUnique);

    if (outcome.reservation !== null) {
      this.publisher.deskReserved({
        date: outcome.reservation.date,
        deskId: outcome.reservation.deskId,
        reservationId: outcome.reservation.id,
        userId: outcome.reservation.userId,
        userName: outcome.requesterName,
      });
    }
    this.publisher.deskApprovalDecided(outcome.notice);
    return { request: outcome.request, reservation: outcome.reservation };
  }
}
