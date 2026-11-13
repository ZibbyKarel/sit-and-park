/**
 * Desk bulk booking: `desk.previewBulk` proposes, `desk.confirmBulk` books an
 * explicit list of (person, day, desk) rows. Rules in `desk-bulk-rules.ts`;
 * the concurrency arrangement is `desks.service.ts`'s `reserve` for many desks
 * and people: desks locked ascending, then users `FOR SHARE` ascending (lock
 * order desk → user), the facts re-read after the locks, events after commit.
 */

import { Injectable } from '@nestjs/common';
import type {
  DeskBulkConfirmInput,
  DeskBulkConfirmOutput,
  DeskBulkPreviewInput,
  DeskBulkPreviewOutput,
  DeskBulkSkippedRow,
} from '@sit-and-park/contract';
import type { DateOnly } from '@sit-and-park/shared-types';
import { compareDateOnly, todayInPrague } from '@sit-and-park/shared-types';
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
import { ReservationPolicy } from '../reservations/reservation-policy';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';
import { DeskCleanupService } from './desk-cleanup.service';
import type { BulkDesk, BulkFacts } from './desk-bulk-rules';
import { allocateBulk, allocationOrder, bulkRowVerdict, dayKey } from './desk-bulk-rules';
import type { DeskReader } from './desk-db';
import { loadPeople, lockDesks, lockUsersForShare, toContractDeskReservation } from './desk-db';
import { deskAccess, isAssignedOn } from './desk-rules';

/** Up to 1 550 rows in one transaction: the admin bulk edit's longer timeout. */
const BULK_TRANSACTION_OPTIONS = { ...RESERVATION_TRANSACTION_OPTIONS, timeout: 60_000 } as const;

const BULK_DESK_SELECT = {
  id: true,
  code: true,
  officeId: true,
  zoneId: true,
  hiveId: true,
  active: true,
  permanentAssigneeId: true,
  x: true,
  y: true,
  width: true,
  height: true,
  zone: { select: { name: true } },
} as const;

async function loadDesks(
  db: DeskReader,
  where: { officeId: { in: string[] } } | { id: { in: string[] } }
): Promise<BulkDesk[]> {
  const rows = await db.desk.findMany({
    where,
    select: BULK_DESK_SELECT,
    orderBy: { code: 'asc' },
  });
  return rows.map(({ zone, ...desk }) => ({ ...desk, zoneName: zone.name }));
}

/** {@link BulkFacts}, writable so `confirm` can record its own accepted rows. */
interface MutableBulkFacts extends BulkFacts {
  holderByDeskDay: Map<string, string>;
  deskByPersonDay: Map<string, string>;
  releasedDeskDays: Set<string>;
}

/** Reservations and releases on `dates`, for the given desks and people. */
async function loadFacts(
  db: DeskReader,
  dates: readonly DateOnly[],
  deskWhere: { officeId: { in: string[] } } | { id: { in: string[] } },
  userIds: readonly string[]
): Promise<MutableBulkFacts> {
  const date = { in: dates.map(toDateColumn) };
  const deskFilter = 'officeId' in deskWhere ? { desk: deskWhere } : { deskId: deskWhere.id };
  const [onDesks, ofPeople, releases] = await Promise.all([
    db.deskReservation.findMany({
      where: { date, ...deskFilter },
      select: { deskId: true, userId: true, date: true },
    }),
    db.deskReservation.findMany({
      where: { date, userId: { in: [...userIds] } },
      select: { deskId: true, userId: true, date: true },
    }),
    db.deskRelease.findMany({
      where: { date, ...deskFilter },
      select: { deskId: true, date: true },
    }),
  ]);
  return {
    holderByDeskDay: new Map(
      onDesks.map((row) => [dayKey(row.deskId, toDateOnly(row.date)), row.userId])
    ),
    deskByPersonDay: new Map(
      ofPeople.map((row) => [dayKey(row.userId, toDateOnly(row.date)), row.deskId])
    ),
    releasedDeskDays: new Set(releases.map((row) => dayKey(row.deskId, toDateOnly(row.date)))),
  };
}

/** A P2002 on one of `DeskReservation`'s unique indexes; anything else is rethrown as is. */
function isDeskReservationTarget(meta: Record<string, unknown> | undefined): boolean {
  const code = mapUniqueConstraintViolation(meta);
  return code === 'DESK_ALREADY_RESERVED' || code === 'DESK_RESERVATION_LIMIT_REACHED';
}

@Injectable()
export class DeskBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly publisher: DomainEventPublisher,
    private readonly cleanup: DeskCleanupService,
    private readonly policy: ReservationPolicy
  ) {}

  async preview(
    input: DeskBulkPreviewInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<DeskBulkPreviewOutput> {
    const userIds = input.userIds ?? [actor.id];
    this.policy.assertMayNameDeskHolders(userIds, actor);
    const db = this.prisma.client;
    const dates = [...input.dates].sort(compareDateOnly);

    const people = await loadPeople(db, userIds);
    if (input.deskIds !== undefined) {
      const found = await db.desk.count({ where: { id: { in: input.deskIds } } });
      if (found !== input.deskIds.length) {
        throw new DomainError('NOT_FOUND', { message: 'No such desk.' });
      }
    }
    const officeIds = [
      ...new Set(people.flatMap((person) => (person.officeId === null ? [] : [person.officeId]))),
    ].sort();
    const deskWhere = { officeId: { in: officeIds } };
    const [desks, facts] = await Promise.all([
      loadDesks(db, deskWhere),
      loadFacts(db, dates, deskWhere, userIds),
    ]);

    const rows = allocateBulk({
      people,
      dates,
      desks,
      pool: input.deskIds === undefined ? null : new Set(input.deskIds),
      facts,
      today,
    });

    // The manual pick: an admin may override hive access, anybody else books
    // only themselves and sees what they can book directly.
    const isAdmin = actor.role === 'ADMIN';
    const self = people.find((person) => person.id === actor.id);
    const freeDesks = dates.flatMap((date) =>
      officeIds.map((officeId) => ({
        officeId,
        date,
        desks: desks
          .filter(
            (desk) =>
              desk.officeId === officeId &&
              desk.active &&
              !isAssignedOn(desk, {
                released: facts.releasedDeskDays.has(dayKey(desk.id, date)),
              }) &&
              !facts.holderByDeskDay.has(dayKey(desk.id, date)) &&
              (isAdmin || (self !== undefined && deskAccess(desk, self) === 'DIRECT'))
          )
          .map((desk) => ({ id: desk.id, code: desk.code, zoneName: desk.zoneName })),
      }))
    );

    return {
      month: (dates[0] ?? today).slice(0, 7),
      people: allocationOrder(people).map((person) => ({
        id: person.id,
        name: person.name,
        officeId: person.officeId,
        preferredDeskId: person.preferredDeskId,
      })),
      rows,
      freeDesks,
    };
  }

  /**
   * Re-checks every row under the locks and books the valid ones in one
   * transaction. A row no longer bookable is skipped with a reason, as is a
   * second row of the batch for a (person, day) or (desk, day) already taken
   * by an earlier one. A lost race on a `DeskReservation` unique index (a
   * booking that skipped these locks, e.g. the same person on another desk)
   * rolls the whole call back as `CONFLICT`; any other P2002 is rethrown.
   */
  async confirm(
    input: DeskBulkConfirmInput,
    actor: AuthenticatedUser,
    today: DateOnly = todayInPrague()
  ): Promise<DeskBulkConfirmOutput> {
    const { assignments } = input;
    const userIds = [...new Set(assignments.map((row) => row.userId))];
    const deskIds = [...new Set(assignments.map((row) => row.deskId))];
    const dates = [...new Set(assignments.map((row) => row.date))];
    this.policy.assertMayNameDeskHolders(userIds, actor);
    const overrideHive = actor.role === 'ADMIN';

    const outcome = await this.prisma.client
      .$transaction(async (tx) => {
        await lockDesks(tx, deskIds);
        await lockUsersForShare(tx, userIds);
        const people = new Map((await loadPeople(tx, userIds)).map((p) => [p.id, p]));
        const desks = new Map((await loadDesks(tx, { id: { in: deskIds } })).map((d) => [d.id, d]));
        const facts = await loadFacts(tx, dates, { id: { in: deskIds } }, userIds);

        const valid: typeof assignments = [];
        const skipped: DeskBulkSkippedRow[] = [];
        for (const row of assignments) {
          const person = people.get(row.userId);
          const desk = desks.get(row.deskId);
          if (person === undefined || desk === undefined) {
            throw new DomainError('NOT_FOUND', {
              message: person === undefined ? 'No such user.' : 'No such desk.',
            });
          }
          const reason = bulkRowVerdict(person, desk, row.date, facts, today, overrideHive);
          if (reason === null) {
            valid.push(row);
            // A later row of this batch for the same person or desk and day
            // sees this one as booked (ALREADY_RESERVED_OTHER_DESK / DESK_TAKEN).
            facts.holderByDeskDay.set(dayKey(row.deskId, row.date), row.userId);
            facts.deskByPersonDay.set(dayKey(row.userId, row.date), row.deskId);
          } else {
            skipped.push({ ...row, reason });
          }
        }
        if (valid.length === 0) {
          return { rows: [], skipped, people };
        }

        const rows = await tx.deskReservation.createManyAndReturn({
          data: valid.map((row) => ({
            deskId: row.deskId,
            userId: row.userId,
            date: toDateColumn(row.date),
          })),
        });
        await this.audit.recordMany(
          rows.map((row) => ({
            actorUserId: actor.id,
            action: 'DESK_RESERVATION_CREATED' as const,
            entityType: 'DeskReservation' as const,
            entityId: row.id,
            payload: {
              deskId: row.deskId,
              deskCode: desks.get(row.deskId)?.code ?? '',
              date: toDateOnly(row.date),
              userId: row.userId,
            },
          })),
          tx
        );
        // Same clean-up as `reserve`: others' pending requests for a booked
        // desk and day, and the booked person's own for that day.
        await this.cleanup.rejectPendingRequests(
          tx,
          {
            OR: rows.map((row) => ({
              deskId: row.deskId,
              date: row.date,
              userId: { not: row.userId },
            })),
          },
          'DESK_TAKEN',
          actor.id
        );
        await this.cleanup.rejectPendingRequests(
          tx,
          { OR: rows.map((row) => ({ userId: row.userId, date: row.date })) },
          'REQUESTER_HAS_DESK',
          actor.id
        );
        return { rows, skipped, people };
      }, BULK_TRANSACTION_OPTIONS)
      .catch((error: unknown) => {
        if (isUniqueConstraintViolation(error) && isDeskReservationTarget(error.meta)) {
          throw new DomainError('CONFLICT', {
            message: 'A concurrent booking took a desk or day first; nothing was booked.',
          });
        }
        throw error;
      });

    const reserved = outcome.rows
      .map(toContractDeskReservation)
      .sort((a, b) => compareDateOnly(a.date, b.date) || a.userId.localeCompare(b.userId));
    for (const reservation of reserved) {
      this.publisher.deskReserved({
        date: reservation.date,
        deskId: reservation.deskId,
        reservationId: reservation.id,
        userId: reservation.userId,
        userName: outcome.people.get(reservation.userId)?.name ?? '',
      });
    }
    return { reserved, skipped: outcome.skipped };
  }
}
