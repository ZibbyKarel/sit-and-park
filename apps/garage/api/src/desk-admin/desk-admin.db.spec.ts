/**
 * The admin desk and hive edits against a real PostgreSQL 17: the clean-up
 * they run in their transaction (cancelled reservations, rejected requests),
 * what they leave alone, and the uniques behind the permanent-desk and
 * hive-membership rules. The desks are this file's own, in the migration's
 * Praha office, so the seeded desks are never touched.
 *
 * The services read "today" from the clock, so a past reservation here is a
 * genuinely past date and a future one is in 2099.
 */

import type { PrismaClient, User as UserRow } from '@garage/database';
import type { DateOnly } from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toDateColumn } from '../common/prisma-mapping';
import { DeskCleanupService } from '../desks/desk-cleanup.service';
import { lockDesk } from '../desks/desk-db';
import {
  asPrismaService,
  codeOf,
  connect,
  holdTransaction,
  RecordingPublisher,
  waitForBlockedBackend,
} from '../testing/database/reservation-harness';
import { unique } from '../testing/database/test-database';
import { DeskAdminService } from './desk-admin.service';
import { HiveAdminService } from './hive-admin.service';

const FUTURE = '2099-02-02' as DateOnly;
const LATER = '2099-02-03' as DateOnly;
const PAST = '2020-01-06' as DateOnly;

describe('desk administration against a real PostgreSQL', () => {
  let client: PrismaClient;
  let otherClient: PrismaClient;
  let publisher: RecordingPublisher;
  let deskAdmin: DeskAdminService;
  let hiveAdmin: HiveAdminService;
  let officeId: string;
  let zoneId: string;
  let admin: UserRow;

  beforeAll(async () => {
    client = connect();
    otherClient = connect();
    publisher = new RecordingPublisher();
    const prisma = asPrismaService(client);
    const audit = new AuditLogService(prisma);
    const cleanup = new DeskCleanupService(audit, publisher);
    deskAdmin = new DeskAdminService(prisma, audit, cleanup);
    hiveAdmin = new HiveAdminService(prisma, audit, cleanup);
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
    admin = await user('ADMIN');
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
        email: `${unique('desk-admin')}@example.test`,
        name: unique('Desk Admin Tester'),
        oktaId: unique('okta'),
        icsToken: unique('ics'),
        role,
        officeId,
      },
    });
  }

  async function hive(ownerId: string): Promise<string> {
    const row = await client.hive.create({
      data: { name: unique('Hive'), color: '#2563EB', ownerId },
    });
    return row.id;
  }

  async function desk(hiveId: string | null = null): Promise<string> {
    const row = await client.desk.create({
      data: { officeId, zoneId, code: unique('A'), hiveId, x: 0, y: 0, width: 10, height: 10 },
    });
    return row.id;
  }

  async function book(userId: string, deskId: string, date: DateOnly): Promise<string> {
    const row = await client.deskReservation.create({
      data: { deskId, userId, date: toDateColumn(date) },
    });
    return row.id;
  }

  async function request(userId: string, deskId: string, date: DateOnly): Promise<string> {
    const row = await client.deskApprovalRequest.create({
      data: { deskId, userId, date: toDateColumn(date), status: 'PENDING' },
    });
    return row.id;
  }

  async function reservationsOf(deskId: string): Promise<string[]> {
    const rows = await client.deskReservation.findMany({
      where: { deskId },
      orderBy: { date: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async function statusOf(requestId: string): Promise<string> {
    const row = await client.deskApprovalRequest.findUniqueOrThrow({ where: { id: requestId } });
    return row.status;
  }

  it('deactivating a desk cancels future reservations and rejects requests, but keeps the past', async () => {
    const [booker, past, asker] = [await user(), await user(), await user()];
    const deskId = await desk(await hive(admin.id));
    const kept = await book(past.id, deskId, PAST);
    const future = await book(booker.id, deskId, FUTURE);
    const pending = await request(asker.id, deskId, LATER);

    await deskAdmin.update({ deskId, active: false }, admin.id);

    expect(await reservationsOf(deskId)).toEqual([kept]);
    expect(await statusOf(pending)).toBe('REJECTED');
    expect(publisher.ofKind('desk:released').map((event) => event.payload.reservationId)).toEqual([
      future,
    ]);
    const audit = await client.auditLog.findMany({
      where: { entityId: { in: [future, deskId] } },
      select: { action: true },
    });
    expect(audit.map((row) => row.action).sort()).toEqual([
      'DESK_RESERVATION_CANCELLED_BY_ADMIN',
      'DESK_UPDATED',
    ]);
  });

  it('a bulk hive change rejects the pending requests of every desk but cancels nothing', async () => {
    const [booker, a, b] = [await user(), await user(), await user()];
    const fromHive = await hive(admin.id);
    const toHive = await hive(admin.id);
    const [first, second] = [await desk(fromHive), await desk(fromHive)];
    const reservation = await book(booker.id, first, FUTURE);
    const [r1, r2] = [await request(a.id, first, LATER), await request(b.id, second, LATER)];

    await expect(
      deskAdmin.bulkUpdate({ deskIds: [first, second], hiveId: toHive }, admin.id)
    ).resolves.toEqual({ updated: 2 });

    expect([await statusOf(r1), await statusOf(r2)]).toEqual(['REJECTED', 'REJECTED']);
    expect(await reservationsOf(first)).toEqual([reservation]);
    const rows = await client.desk.findMany({ where: { id: { in: [first, second] } } });
    expect(rows.map((row) => row.hiveId)).toEqual([toHive, toHive]);
  });

  it('a permanent holder takes the desk from others, gives up other desks, and holds one desk only', async () => {
    const [holder, other] = [await user(), await user()];
    const [deskId, elsewhere, second] = [await desk(), await desk(), await desk()];
    const othersDay = await book(other.id, deskId, FUTURE);
    const holdersOwn = await book(holder.id, deskId, LATER);
    const holdersElsewhere = await book(holder.id, elsewhere, FUTURE);
    const othersPast = await book(other.id, deskId, PAST);

    await deskAdmin.setPermanentAssignee({ deskId, userId: holder.id }, admin.id);

    expect(await reservationsOf(deskId)).toEqual([othersPast, holdersOwn]);
    expect(await reservationsOf(elsewhere)).toEqual([]);
    expect(
      publisher
        .ofKind('desk:released')
        .map((event) => event.payload.reservationId)
        .sort()
    ).toEqual([othersDay, holdersElsewhere].sort());

    const refusal = await codeOf(
      deskAdmin.setPermanentAssignee({ deskId: second, userId: holder.id }, admin.id)
    );
    expect(refusal).toBe('CONFLICT');
    const secondRow = await client.desk.findUniqueOrThrow({ where: { id: second } });
    expect(secondRow.permanentAssigneeId).toBeNull();
  });

  it('deleting a hive rejects its desks’ requests and opens the desks, keeping reservations', async () => {
    const [booker, asker, member] = [await user(), await user(), await user()];
    const hiveId = await hive(admin.id);
    const deskId = await desk(hiveId);
    await client.hiveMembership.create({ data: { hiveId, userId: member.id } });
    const reservation = await book(booker.id, deskId, FUTURE);
    const pending = await request(asker.id, deskId, LATER);

    await hiveAdmin.delete({ hiveId }, admin.id);

    expect(await client.hive.findUnique({ where: { id: hiveId } })).toBeNull();
    expect((await client.desk.findUniqueOrThrow({ where: { id: deskId } })).hiveId).toBeNull();
    expect(await client.hiveMembership.findUnique({ where: { userId: member.id } })).toBeNull();
    expect(await statusOf(pending)).toBe('REJECTED');
    expect(await reservationsOf(deskId)).toEqual([reservation]);
  });

  it('a new permanent holder’s booking of another desk, still uncommitted, is waited for and cancelled', async () => {
    const holder = await user();
    const [deskId, elsewhere] = [await desk(), await desk()];
    // `desk.reserve` on another desk, mid-transaction: it locks only that desk.
    const held = holdTransaction(otherClient, (tx) =>
      tx.deskReservation.create({
        data: { deskId: elsewhere, userId: holder.id, date: toDateColumn(FUTURE) },
      })
    );
    await held.ready;
    const assignment = deskAdmin.setPermanentAssignee({ deskId, userId: holder.id }, admin.id);
    await waitForBlockedBackend(client);
    held.release();
    await held.done;
    await assignment;
    expect(await reservationsOf(elsewhere)).toEqual([]);
  });

  it('a request filed during a hive deletion is waited for and rejected', async () => {
    const asker = await user();
    const hiveId = await hive(admin.id);
    const deskId = await desk(hiveId);
    // `desk.requestApproval` mid-transaction: the desk locked, the request written.
    const held = holdTransaction(otherClient, async (tx) => {
      await lockDesk(tx, deskId);
      return tx.deskApprovalRequest.create({
        data: { deskId, userId: asker.id, date: toDateColumn(FUTURE) },
      });
    });
    const pending = await held.ready;
    const deletion = hiveAdmin.delete({ hiveId }, admin.id);
    await waitForBlockedBackend(client);
    held.release();
    await held.done;
    await deletion;
    expect(await statusOf(pending.id)).toBe('REJECTED');
  });

  it('setMembership moves a user from one hive to another, and removes only from its own hive', async () => {
    const member = await user();
    const [first, second] = [await hive(admin.id), await hive(admin.id)];

    await hiveAdmin.setMembership({ hiveId: first, userId: member.id, member: true });
    await expect(
      hiveAdmin.setMembership({ hiveId: second, userId: member.id, member: true })
    ).resolves.toEqual({ userId: member.id, hiveId: second });
    expect(await client.hiveMembership.count({ where: { userId: member.id } })).toBe(1);

    await expect(
      hiveAdmin.setMembership({ hiveId: first, userId: member.id, member: false })
    ).resolves.toEqual({ userId: member.id, hiveId: second });
    await expect(
      hiveAdmin.setMembership({ hiveId: second, userId: member.id, member: false })
    ).resolves.toEqual({ userId: member.id, hiveId: null });
  });
});
