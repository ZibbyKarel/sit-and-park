/**
 * Desk bulk booking against a real PostgreSQL 17: one desk per person and day
 * whatever the batch says, admin booking for others, the non-admin refusal,
 * desks taken between preview and confirm (and while confirm waits on the
 * lock), and a lost race on `(userId, date)`. Desks are this file's own, and
 * every preview names them as its pool, so the seeded Praha desks never matter.
 */

import type { PrismaClient, User as UserRow } from '@sit-and-park/database';
import type { DateOnly } from '@sit-and-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toDateColumn } from '../common/prisma-mapping';
import { ReservationPolicy } from '../reservations/reservation-policy';
import {
  actorFor,
  asPrismaService,
  codeOf,
  connect,
  holdTransaction,
  RecordingPublisher,
  TODAY,
  waitForBlockedBackend,
} from '../testing/database/reservation-harness';
import { unique } from '../testing/database/test-database';
import { DeskBulkService } from './desk-bulk.service';
import { DeskCleanupService } from './desk-cleanup.service';

const D1 = '2099-01-05' as DateOnly;
const D2 = '2099-01-06' as DateOnly;
const PAST = '2098-12-28' as DateOnly;

describe('desk bulk booking against a real PostgreSQL', () => {
  let client: PrismaClient;
  let otherClient: PrismaClient;
  let publisher: RecordingPublisher;
  let bulk: DeskBulkService;
  let officeId: string;
  let zoneId: string;

  beforeAll(async () => {
    client = connect();
    otherClient = connect();
    publisher = new RecordingPublisher();
    const prisma = asPrismaService(client);
    const audit = new AuditLogService(prisma);
    bulk = new DeskBulkService(
      prisma,
      audit,
      publisher,
      new DeskCleanupService(audit, publisher),
      new ReservationPolicy()
    );
    const office = await client.office.findUniqueOrThrow({
      where: { name: 'Praha' },
      include: { zones: { take: 1 } },
    });
    officeId = office.id;
    const zone = office.zones[0];
    if (zone === undefined) {
      throw new Error('The migrations created no zone for Praha.');
    }
    zoneId = zone.id;
  });

  afterAll(async () => {
    await Promise.all([client.$disconnect(), otherClient.$disconnect()]);
  });

  beforeEach(() => {
    publisher.reset();
  });

  async function user(role: 'USER' | 'ADMIN' = 'USER'): Promise<UserRow> {
    return client.user.create({
      data: {
        email: `${unique('bulk-user')}@example.test`,
        name: unique('Bulk Tester'),
        oktaId: unique('okta'),
        icsToken: unique('ics'),
        role,
        officeId,
      },
    });
  }

  async function desk(x: number, hiveId: string | null = null): Promise<{ id: string }> {
    return client.desk.create({
      data: { officeId, zoneId, code: unique('B'), hiveId, x, y: 0, width: 10, height: 10 },
      select: { id: true },
    });
  }

  function book(holder: UserRow, deskId: string, date: DateOnly) {
    return client.deskReservation.create({
      data: { deskId, userId: holder.id, date: toDateColumn(date) },
    });
  }

  it('previews the preferred desk, then books it and nothing else is written by preview', async () => {
    const me = await user();
    const [a, b] = [await desk(0), await desk(20)];
    await client.user.update({ where: { id: me.id }, data: { preferredDeskId: b.id } });

    const plan = await bulk.preview(
      { dates: [D2, D1], deskIds: [a.id, b.id] },
      actorFor(me),
      TODAY
    );
    expect(plan.month).toBe('2099-01');
    expect(plan.rows).toEqual([
      expect.objectContaining({ outcome: 'ASSIGNED', date: D1, deskId: b.id, isPreferred: true }),
      expect.objectContaining({ outcome: 'ASSIGNED', date: D2, deskId: b.id, isPreferred: true }),
    ]);
    const freeD1 = plan.freeDesks.find((day) => day.date === D1)?.desks.map((d) => d.id) ?? [];
    expect(freeD1).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(await client.deskReservation.count({ where: { userId: me.id } })).toBe(0);

    const result = await bulk.confirm(
      {
        assignments: [
          { userId: me.id, date: D1, deskId: b.id },
          { userId: me.id, date: D2, deskId: b.id },
        ],
      },
      actorFor(me),
      TODAY
    );
    expect(result.reserved.map((row) => row.date)).toEqual([D1, D2]);
    expect(result.skipped).toEqual([]);
    expect(publisher.events.map((event) => event.name)).toEqual(['desk:reserved', 'desk:reserved']);
    expect(
      await client.auditLog.count({
        where: { action: 'DESK_RESERVATION_CREATED', actorUserId: me.id },
      })
    ).toBe(2);
  });

  it('never gives one person two desks on a day: an existing booking skips the row', async () => {
    const me = await user();
    const [a, b] = [await desk(0), await desk(20)];
    await book(me, a.id, D1);

    const plan = await bulk.preview({ dates: [D1, D2], deskIds: [b.id] }, actorFor(me), TODAY);
    expect(plan.rows[0]).toMatchObject({ outcome: 'UNAVAILABLE', date: D1 });

    const result = await bulk.confirm(
      {
        assignments: [
          { userId: me.id, date: D1, deskId: b.id },
          { userId: me.id, date: D2, deskId: b.id },
        ],
      },
      actorFor(me),
      TODAY
    );
    expect(result.reserved.map((row) => row.date)).toEqual([D2]);
    expect(result.skipped).toEqual([
      { userId: me.id, date: D1, deskId: b.id, reason: 'ALREADY_RESERVED_OTHER_DESK' },
    ]);
    expect(
      await client.deskReservation.count({ where: { userId: me.id, date: toDateColumn(D1) } })
    ).toBe(1);
  });

  it('a racing booking of the same person on another desk rolls the batch back as CONFLICT', async () => {
    const me = await user();
    const [a, b] = [await desk(0), await desk(20)];
    // Not one of the batch's desks, so the batch's desk lock does not order it.
    const held = holdTransaction(otherClient, (tx) =>
      tx.deskReservation.create({ data: { deskId: a.id, userId: me.id, date: toDateColumn(D1) } })
    );
    await held.ready;
    const loser = bulk.confirm(
      {
        assignments: [
          { userId: me.id, date: D1, deskId: b.id },
          { userId: me.id, date: D2, deskId: b.id },
        ],
      },
      actorFor(me),
      TODAY
    );
    await waitForBlockedBackend(client);
    held.release();
    await held.done;
    expect(await codeOf(loser)).toBe('CONFLICT');
    expect(await client.deskReservation.count({ where: { userId: me.id } })).toBe(1);
  });

  it('an admin books for others, overrides hive access by hand, and is the audited actor', async () => {
    const admin = await user('ADMIN');
    const [p1, p2] = [await user(), await user()];
    const hive = await client.hive.create({
      data: { name: unique('Hive'), color: '#2563EB', ownerId: admin.id },
    });
    const [open, hiveDesk] = [await desk(0), await desk(20, hive.id)];
    await client.deskApprovalRequest.create({
      data: { deskId: hiveDesk.id, userId: p2.id, date: toDateColumn(D1), status: 'PENDING' },
    });

    const plan = await bulk.preview(
      { dates: [D1], userIds: [admin.id, p1.id, p2.id], deskIds: [open.id] },
      actorFor(admin, 'ADMIN'),
      TODAY
    );
    expect(plan.people.map((person) => person.id)).toEqual([admin.id, p1.id, p2.id]);
    // One open desk in the pool, three people: the first gets it, the rest pick by hand.
    expect(plan.rows.map((row) => row.outcome)).toEqual(['ASSIGNED', 'UNASSIGNED', 'UNASSIGNED']);

    const result = await bulk.confirm(
      {
        assignments: [
          { userId: p1.id, date: D1, deskId: open.id },
          { userId: p2.id, date: D1, deskId: hiveDesk.id },
        ],
      },
      actorFor(admin, 'ADMIN'),
      TODAY
    );
    expect(result.skipped).toEqual([]);
    expect(result.reserved.map((row) => row.userId).sort()).toEqual([p1.id, p2.id].sort());
    expect(
      await client.auditLog.count({
        where: {
          action: 'DESK_RESERVATION_CREATED',
          actorUserId: admin.id,
          entityId: { in: result.reserved.map((row) => row.id) },
        },
      })
    ).toBe(2);
    // p2's own pending request for that day is moot now.
    expect(
      await client.deskApprovalRequest.findFirstOrThrow({ where: { userId: p2.id } })
    ).toMatchObject({ status: 'REJECTED', decidedById: admin.id });
  });

  it('a non-admin naming somebody else is FORBIDDEN and nothing is written', async () => {
    const [me, other] = [await user(), await user()];
    const a = await desk(0);

    expect(
      await codeOf(bulk.preview({ dates: [D1], userIds: [me.id, other.id] }, actorFor(me), TODAY))
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(
        bulk.confirm(
          { assignments: [{ userId: other.id, date: D1, deskId: a.id }] },
          actorFor(me),
          TODAY
        )
      )
    ).toBe('FORBIDDEN');
    expect(await client.deskReservation.count({ where: { deskId: a.id } })).toBe(0);
  });

  it('skips a desk taken after the preview, and one taken while confirm waits on its lock', async () => {
    const [me, rival, late] = [await user(), await user(), await user()];
    const a = await desk(0);
    const plan = await bulk.preview({ dates: [D1, D2], deskIds: [a.id] }, actorFor(me), TODAY);
    expect(plan.rows.every((row) => row.outcome === 'ASSIGNED')).toBe(true);

    // Taken between preview and confirm.
    await book(rival, a.id, D1);
    // Taken by a transaction still open when confirm starts: confirm waits on the desk lock.
    const held = holdTransaction(otherClient, (tx) =>
      tx.deskReservation.create({ data: { deskId: a.id, userId: late.id, date: toDateColumn(D2) } })
    );
    await held.ready;
    const confirming = bulk.confirm(
      {
        assignments: [
          { userId: me.id, date: D1, deskId: a.id },
          { userId: me.id, date: D2, deskId: a.id },
        ],
      },
      actorFor(me),
      TODAY
    );
    await waitForBlockedBackend(client);
    held.release();
    await held.done;

    const result = await confirming;
    expect(result.reserved).toEqual([]);
    expect(result.skipped.map((row) => row.reason)).toEqual(['DESK_TAKEN', 'DESK_TAKEN']);
    expect(publisher.events).toEqual([]);
  });

  it('skips a second row of one batch for the same person or desk and day', async () => {
    const admin = await user('ADMIN');
    const [p1, p2] = [await user(), await user()];
    const [a, b] = [await desk(0), await desk(20)];
    // Called directly, so the contract's no-duplicates refine never ran.
    const result = await bulk.confirm(
      {
        assignments: [
          { userId: p1.id, date: D1, deskId: a.id },
          { userId: p1.id, date: D1, deskId: b.id },
          { userId: p2.id, date: D1, deskId: a.id },
        ],
      },
      actorFor(admin, 'ADMIN'),
      TODAY
    );
    expect(result.reserved.map((row) => [row.userId, row.deskId])).toEqual([[p1.id, a.id]]);
    expect(result.skipped).toEqual([
      { userId: p1.id, date: D1, deskId: b.id, reason: 'ALREADY_RESERVED_OTHER_DESK' },
      { userId: p2.id, date: D1, deskId: a.id, reason: 'DESK_TAKEN' },
    ]);
    expect(await client.deskReservation.count({ where: { deskId: { in: [a.id, b.id] } } })).toBe(1);
  });

  it('a non-admin never books, nor is offered, a hive desk they may only request', async () => {
    const [me, owner] = [await user(), await user()];
    const hive = await client.hive.create({
      data: { name: unique('Hive'), color: '#2563EB', ownerId: owner.id },
    });
    const [open, hiveDesk] = [await desk(0), await desk(20, hive.id)];

    const plan = await bulk.preview(
      { dates: [D1], deskIds: [open.id, hiveDesk.id] },
      actorFor(me),
      TODAY
    );
    const freeD1 = plan.freeDesks.find((day) => day.date === D1)?.desks.map((d) => d.id) ?? [];
    expect(freeD1).toContain(open.id);
    expect(freeD1).not.toContain(hiveDesk.id);

    const result = await bulk.confirm(
      { assignments: [{ userId: me.id, date: D1, deskId: hiveDesk.id }] },
      actorFor(me),
      TODAY
    );
    expect(result.reserved).toEqual([]);
    expect(result.skipped).toEqual([
      { userId: me.id, date: D1, deskId: hiveDesk.id, reason: 'DESK_ACCESS_DENIED' },
    ]);
    expect(await client.deskReservation.count({ where: { deskId: hiveDesk.id } })).toBe(0);
    expect(publisher.events).toEqual([]);
  });

  it('reports a past day per row rather than failing the batch', async () => {
    const me = await user();
    const a = await desk(0);
    const result = await bulk.confirm(
      { assignments: [{ userId: me.id, date: PAST, deskId: a.id }] },
      actorFor(me),
      TODAY
    );
    expect(result.skipped).toEqual([
      { userId: me.id, date: PAST, deskId: a.id, reason: 'PAST_DATE' },
    ]);
  });
});
