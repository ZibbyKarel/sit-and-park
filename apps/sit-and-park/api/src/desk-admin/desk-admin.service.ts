/**
 * `admin.desk.*`: the all-offices list, single and bulk edits, permanent
 * holders, direct grants and the day's statistics.
 *
 * Every write runs in one transaction that first locks the desk rows
 * (`SELECT … FOR UPDATE`, ascending id so two bulk edits cannot deadlock) —
 * the same lock `desk.reserve` and approval take, so a booking either commits
 * before the edit and is cleaned up by it, or waits and sees the edited desk.
 * The clean-up the source app lacked (cancelling future reservations,
 * rejecting pending requests; `doc/desk-merge-plan.md` defect table) runs in
 * that same transaction through `DeskCleanupService`, and the `desk:released`
 * broadcasts go out after commit.
 */

import { Injectable } from '@nestjs/common';
import type {
  AdminBulkUpdateDesksInput,
  AdminBulkUpdateDesksOutput,
  AdminDeskGrantsInput,
  AdminDeskGrantsOutput,
  AdminDeskListInput,
  AdminDeskListOutput,
  AdminDeskStatsInput,
  AdminDeskStatsOutput,
  AdminDeskStatus,
  AdminSetDeskGrantInput,
  AdminSetDeskGrantOutput,
  AdminSetPermanentAssigneeInput,
  AdminUpdateDeskInput,
  Desk,
} from '@sit-and-park/contract';
import type { DeskReleasedEvent } from '@sit-and-park/contract/realtime';
import type { Desk as DeskRow, Prisma } from '@sit-and-park/database';
import { todayInPrague } from '@sit-and-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuditPayloads } from '../audit/audit-payloads';
import { DomainError } from '../common/errors/domain-error';
import { toDateColumn } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import { DeskCleanupService } from '../desks/desk-cleanup.service';
import { lockDesk, lockDesks, lockUser, toContractDesk } from '../desks/desk-db';
import { deskStatus } from '../desks/desk-rules';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';
import { computeDeskStats, deskChangeEffects } from './desk-admin-rules';

/**
 * A bulk edit touches up to 500 desks, each an update, its clean-up reads and
 * an audit row. ponytail: one long transaction holding up to 500 row locks;
 * split into chunks if bulk edits ever contend with booking traffic.
 */
const BULK_TRANSACTION_OPTIONS = { ...RESERVATION_TRANSACTION_OPTIONS, timeout: 60_000 } as const;

type DeskFields = NonNullable<AuditPayloads['DESK_UPDATED']['before']>;

/** What one desk should look like after an edit. */
type DeskTarget = Pick<DeskRow, 'active' | 'hiveId' | 'zoneId' | 'officeId'>;

function auditFields(row: DeskRow): DeskFields {
  return {
    code: row.code,
    officeId: row.officeId,
    zoneId: row.zoneId,
    hiveId: row.hiveId,
    active: row.active,
    permanentAssigneeId: row.permanentAssigneeId,
  };
}

@Injectable()
export class DeskAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly cleanup: DeskCleanupService
  ) {}

  /** Every desk (of one office, or of all) with its status that day. Three reads, no N+1. */
  async list(input: AdminDeskListInput): Promise<AdminDeskListOutput> {
    const date = toDateColumn(input.date);
    const scope: Prisma.DeskWhereInput =
      input.officeId === undefined ? {} : { officeId: input.officeId };
    const [desks, reservations, releases] = await Promise.all([
      this.prisma.client.desk.findMany({
        where: scope,
        orderBy: [{ office: { name: 'asc' } }, { code: 'asc' }],
        include: {
          zone: { select: { name: true } },
          office: { select: { name: true } },
          hive: { select: { name: true, color: true } },
          permanentAssignee: { select: { name: true } },
        },
      }),
      this.prisma.client.deskReservation.findMany({
        where: { date, desk: scope },
        select: { deskId: true, userId: true, user: { select: { name: true } } },
      }),
      this.prisma.client.deskRelease.findMany({
        where: { date, desk: scope },
        select: { deskId: true },
      }),
    ]);
    const reservationByDesk = new Map(reservations.map((row) => [row.deskId, row]));
    const released = new Set(releases.map((row) => row.deskId));

    return {
      date: input.date,
      desks: desks.map((desk) => {
        const reservation = reservationByDesk.get(desk.id);
        return {
          ...toContractDesk(desk),
          status: adminStatus(desk, reservation?.userId ?? null, released.has(desk.id)),
          reservedByName: reservation?.user.name ?? null,
          permanentAssigneeName: desk.permanentAssignee?.name ?? null,
          hiveName: desk.hive?.name ?? null,
          hiveColor: desk.hive?.color ?? null,
          zoneName: desk.zone.name,
          officeName: desk.office.name,
        };
      }),
    };
  }

  /**
   * One desk's active flag, hive, zone or office. Unknown desk, hive, zone or
   * office → `NOT_FOUND`; a zone outside the desk's (new) office →
   * `VALIDATION_FAILED` (so an office change needs a zone of that office); a
   * code already taken in the new office → `CONFLICT` from the unique index.
   */
  async update(input: AdminUpdateDeskInput, actorUserId: string): Promise<Desk> {
    const { deskId, ...changes } = input;
    const { row, events } = await this.prisma.client.$transaction(async (tx) => {
      await lockDesk(tx, deskId);
      const before = await requireDesk(tx, deskId);
      const target: DeskTarget = {
        active: changes.active ?? before.active,
        hiveId: changes.hiveId === undefined ? before.hiveId : changes.hiveId,
        zoneId: changes.zoneId ?? before.zoneId,
        officeId: changes.officeId ?? before.officeId,
      };
      if (target.officeId !== before.officeId) {
        await requireOffice(tx, target.officeId);
      }
      if (target.hiveId !== null && target.hiveId !== before.hiveId) {
        await requireHive(tx, target.hiveId);
      }
      if (target.zoneId !== before.zoneId || target.officeId !== before.officeId) {
        const zone = await tx.zone.findUnique({ where: { id: target.zoneId } });
        if (zone === null) {
          throw new DomainError('NOT_FOUND', { message: 'No such zone.' });
        }
        if (zone.officeId !== target.officeId) {
          throw new DomainError('VALIDATION_FAILED', {
            message: 'The zone belongs to another office than the desk.',
            details: { zoneId: zone.id, officeId: target.officeId },
          });
        }
      }
      const [result] = await this.applyEdits(tx, [{ before, target }], actorUserId);
      return result ?? { row: before, events: [] };
    }, RESERVATION_TRANSACTION_OPTIONS);

    this.cleanup.publish(events);
    return toContractDesk(row);
  }

  /** The same side effects as {@link update}, for up to 500 desks, in one transaction. */
  async bulkUpdate(
    input: AdminBulkUpdateDesksInput,
    actorUserId: string
  ): Promise<AdminBulkUpdateDesksOutput> {
    const results = await this.prisma.client.$transaction(async (tx) => {
      await lockDesks(tx, input.deskIds);
      const rows = await tx.desk.findMany({ where: { id: { in: input.deskIds } } });
      if (rows.length !== input.deskIds.length) {
        const found = new Set(rows.map((row) => row.id));
        throw new DomainError('NOT_FOUND', {
          message: 'No such desk.',
          details: { deskIds: input.deskIds.filter((id) => !found.has(id)) },
        });
      }
      if (input.hiveId !== undefined && input.hiveId !== null) {
        await requireHive(tx, input.hiveId);
      }
      return this.applyEdits(
        tx,
        rows.map((before) => ({
          before,
          target: {
            active: input.active ?? before.active,
            hiveId: input.hiveId === undefined ? before.hiveId : input.hiveId,
            zoneId: before.zoneId,
            officeId: before.officeId,
          },
        })),
        actorUserId
      );
    }, BULK_TRANSACTION_OPTIONS);

    this.cleanup.publish(results.flatMap((result) => result.events));
    return { updated: results.length };
  }

  /**
   * Makes `userId` the desk's permanent holder, or clears it (`null`).
   *
   * The user must exist (`NOT_FOUND`), be active and be in the desk's office
   * (`VALIDATION_FAILED`), and hold no other permanent desk (`CONFLICT`; the
   * unique on `permanentAssigneeId` backs the check against a race). Any change
   * of holder deletes the desk's release days from today on that nobody booked
   * — a booked one keeps its release and its reservation. A new holder also
   * takes the desk back from everybody else on every day it is not released,
   * and gives up their own reservations of other desks (a holder books
   * nothing else), both from today on.
   */
  async setPermanentAssignee(
    input: AdminSetPermanentAssigneeInput,
    actorUserId: string
  ): Promise<Desk> {
    const { row, events } = await this.prisma.client.$transaction(async (tx) => {
      await lockDesk(tx, input.deskId);
      const before = await requireDesk(tx, input.deskId);
      if (before.permanentAssigneeId === input.userId) {
        return { row: before, events: [] as DeskReleasedEvent[] };
      }
      if (input.userId !== null) {
        // After the desk lock (order desk → user): a booking by this user on
        // another desk either committed (and is cancelled below) or waits and
        // then sees the permanent desk.
        await lockUser(tx, input.userId, 'UPDATE');
        await this.requireEligibleHolder(tx, input.userId, before);
      }

      const today = todayInPrague();
      const row = await tx.desk.update({
        where: { id: before.id },
        data: { permanentAssigneeId: input.userId },
      });
      const keptReleaseDates = await deleteUnbookedReleases(tx, before.id, today);

      const events: DeskReleasedEvent[] = [];
      if (input.userId !== null) {
        events.push(
          ...(await this.cleanup.cancelReservations(
            tx,
            { deskId: before.id, userId: { not: input.userId }, date: { notIn: keptReleaseDates } },
            'PERMANENT_ASSIGNMENT',
            actorUserId,
            today
          )),
          ...(await this.cleanup.cancelReservations(
            tx,
            { userId: input.userId, deskId: { not: before.id } },
            'PERMANENT_ASSIGNMENT',
            actorUserId,
            today
          ))
        );
      }
      await this.recordDeskUpdated(tx, [{ before, after: row }], actorUserId);
      return { row, events };
    }, RESERVATION_TRANSACTION_OPTIONS);

    this.cleanup.publish(events);
    return toContractDesk(row);
  }

  async grants(input: AdminDeskGrantsInput): Promise<AdminDeskGrantsOutput> {
    await requireDesk(this.prisma.client, input.deskId);
    const rows = await this.prisma.client.deskGrant.findMany({
      where: { deskId: input.deskId },
      orderBy: [{ user: { name: 'asc' } }, { user: { email: 'asc' } }],
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    return {
      grants: rows.map(({ user }) => ({ userId: user.id, name: user.name, email: user.email })),
    };
  }

  /**
   * Grants or revokes on many desks at once; idempotent, `updated` counts the
   * rows actually created or removed. A grant on a desk of another office, or
   * on one with no hive, is harmless (access needs the office anyway), so it
   * is not refused. Unaudited: there is no grant audit action.
   */
  async setGrant(input: AdminSetDeskGrantInput): Promise<AdminSetDeskGrantOutput> {
    const [user, deskCount] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
      this.prisma.client.desk.count({ where: { id: { in: input.deskIds } } }),
    ]);
    if (user === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }
    if (deskCount !== input.deskIds.length) {
      throw new DomainError('NOT_FOUND', { message: 'No such desk.' });
    }
    const result = input.granted
      ? await this.prisma.client.deskGrant.createMany({
          data: input.deskIds.map((deskId) => ({ deskId, userId: input.userId })),
          skipDuplicates: true,
        })
      : await this.prisma.client.deskGrant.deleteMany({
          where: { deskId: { in: input.deskIds }, userId: input.userId },
        });
    return { updated: result.count };
  }

  /** The day's statistics; the arithmetic is `computeDeskStats`. Seven grouped reads. */
  async stats(input: AdminDeskStatsInput): Promise<AdminDeskStatsOutput> {
    if (input.officeId !== undefined) {
      await requireOffice(this.prisma.client, input.officeId);
    }
    const date = toDateColumn(input.date);
    const scope: Prisma.DeskWhereInput =
      input.officeId === undefined ? {} : { officeId: input.officeId };
    const [desks, reservations, releases, zones, offices, hiveCount, pendingApprovals] =
      await Promise.all([
        this.prisma.client.desk.findMany({
          where: scope,
          select: {
            id: true,
            officeId: true,
            zoneId: true,
            active: true,
            permanentAssigneeId: true,
          },
        }),
        this.prisma.client.deskReservation.findMany({
          where: { date, desk: scope },
          select: { deskId: true },
        }),
        this.prisma.client.deskRelease.findMany({
          where: { date, desk: scope },
          select: { deskId: true },
        }),
        this.prisma.client.zone.findMany({ select: { id: true, name: true, officeId: true } }),
        this.prisma.client.office.findMany({ select: { id: true, name: true } }),
        this.prisma.client.hive.count(),
        this.prisma.client.deskApprovalRequest.count({
          where: { status: 'PENDING', desk: scope },
        }),
      ]);

    return computeDeskStats({
      date: input.date,
      desks,
      reservedDeskIds: new Set(reservations.map((row) => row.deskId)),
      releasedDeskIds: new Set(releases.map((row) => row.deskId)),
      zones: new Map(zones.map((zone) => [zone.id, zone])),
      offices: new Map(offices.map((office) => [office.id, office.name])),
      hiveCount,
      pendingApprovals,
    });
  }

  // --- the shared edit -------------------------------------------------------

  /**
   * Writes each edit that changes something, runs its clean-up
   * (`deskChangeEffects`) and audits it. Edits that change nothing are left
   * out of the result. Moving a desk to another office also clears its
   * permanent holder when the holder is not in that office (they could no
   * longer reach it) and drops the release days nobody booked; grants stay,
   * since access needs the office anyway.
   */
  private async applyEdits(
    tx: Prisma.TransactionClient,
    edits: readonly { before: DeskRow; target: DeskTarget }[],
    actorUserId: string
  ): Promise<{ row: DeskRow; events: DeskReleasedEvent[] }[]> {
    const today = todayInPrague();
    const results: { before: DeskRow; row: DeskRow; events: DeskReleasedEvent[] }[] = [];

    for (const { before, target } of edits) {
      if (
        before.active === target.active &&
        before.hiveId === target.hiveId &&
        before.zoneId === target.zoneId &&
        before.officeId === target.officeId
      ) {
        continue;
      }
      const clearHolder =
        target.officeId !== before.officeId &&
        before.permanentAssigneeId !== null &&
        (
          await tx.user.findUnique({
            where: { id: before.permanentAssigneeId },
            select: { officeId: true },
          })
        )?.officeId !== target.officeId;

      const row = await tx.desk.update({
        where: { id: before.id },
        data: { ...target, ...(clearHolder ? { permanentAssigneeId: null } : {}) },
      });

      const effects = deskChangeEffects(before, target);
      const events =
        effects.cancelReservations === null
          ? []
          : await this.cleanup.cancelReservations(
              tx,
              { deskId: before.id },
              effects.cancelReservations,
              actorUserId,
              today
            );
      if (effects.rejectRequests !== null) {
        await this.cleanup.rejectPendingRequests(
          tx,
          { deskId: before.id },
          effects.rejectRequests,
          actorUserId
        );
      }
      if (clearHolder) {
        await deleteUnbookedReleases(tx, before.id, today);
      }
      results.push({ before, row, events });
    }

    await this.recordDeskUpdated(
      tx,
      results.map(({ before, row }) => ({ before, after: row })),
      actorUserId
    );
    return results.map(({ row, events }) => ({ row, events }));
  }

  private async recordDeskUpdated(
    tx: Prisma.TransactionClient,
    changes: readonly { before: DeskRow; after: DeskRow }[],
    actorUserId: string
  ): Promise<void> {
    await this.audit.recordMany(
      changes.map(({ before, after }) => ({
        actorUserId,
        action: 'DESK_UPDATED' as const,
        entityType: 'Desk' as const,
        entityId: after.id,
        payload: { before: auditFields(before), after: auditFields(after) },
      })),
      tx
    );
  }

  private async requireEligibleHolder(
    tx: Prisma.TransactionClient,
    userId: string,
    desk: DeskRow
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { active: true, officeId: true, permanentDesk: { select: { id: true } } },
    });
    if (user === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }
    if (!user.active || user.officeId !== desk.officeId) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'A permanent holder must be an active user of the desk’s office.',
        details: { userId, active: user.active, officeId: user.officeId },
      });
    }
    if (user.permanentDesk !== null && user.permanentDesk.id !== desk.id) {
      throw new DomainError('CONFLICT', {
        message: 'The user already holds another permanent desk.',
        details: { deskId: user.permanentDesk.id },
      });
    }
  }
}

/** The admin view's status: the directory's, without the viewer-relative `RESERVED_BY_ME`. */
function adminStatus(
  desk: Pick<DeskRow, 'active' | 'permanentAssigneeId'>,
  reservedByUserId: string | null,
  released: boolean
): AdminDeskStatus {
  // No viewer: an empty id matches no reservation, so `RESERVED_BY_ME` cannot occur.
  const status = deskStatus(desk, { reservedByUserId, released }, '');
  return status === 'RESERVED_BY_ME' ? 'RESERVED' : status;
}

/**
 * Deletes the desk's release days from `today` on that nobody reserved and
 * returns the release dates that stay (each has a reservation of this desk).
 * Past releases are history and are kept.
 */
async function deleteUnbookedReleases(
  tx: Prisma.TransactionClient,
  deskId: string,
  today: string
): Promise<Date[]> {
  const from = toDateColumn(today);
  const booked = await tx.deskReservation.findMany({
    where: { deskId, date: { gte: from } },
    select: { date: true },
  });
  await tx.deskRelease.deleteMany({
    where: { deskId, date: { gte: from, notIn: booked.map((row) => row.date) } },
  });
  const kept = await tx.deskRelease.findMany({
    where: { deskId, date: { gte: from } },
    select: { date: true },
  });
  return kept.map((row) => row.date);
}

async function requireDesk(client: Prisma.TransactionClient, deskId: string): Promise<DeskRow> {
  const desk = await client.desk.findUnique({ where: { id: deskId } });
  if (desk === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such desk.' });
  }
  return desk;
}

async function requireOffice(client: Prisma.TransactionClient, officeId: string): Promise<void> {
  const office = await client.office.findUnique({ where: { id: officeId }, select: { id: true } });
  if (office === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such office.' });
  }
}

async function requireHive(client: Prisma.TransactionClient, hiveId: string): Promise<void> {
  const hive = await client.hive.findUnique({ where: { id: hiveId }, select: { id: true } });
  if (hive === null) {
    throw new DomainError('NOT_FOUND', { message: 'No such hive.' });
  }
}
