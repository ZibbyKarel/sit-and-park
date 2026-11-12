/**
 * The employee sync and user deactivation against a real PostgreSQL.
 *
 * The suites share one database, and a sync reads **every** user. Isolation
 * rests on `isManualAccount`: other suites create `@example.test` users, which
 * the sync never touches, and `beforeEach` marks the `@team.blue` users of
 * earlier tests here as manual, so each test sees only the employees it made.
 */

import type { ConfigService } from '@nestjs/config';
import type { PrismaClient, User as UserRow } from '@garage/database';
import type { DateOnly } from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toDateColumn } from '../common/prisma-mapping';
import { DeskCleanupService } from '../desks/desk-cleanup.service';
import type { ApiEnv } from '../env';
import type { Harness } from '../testing/database/reservation-harness';
import {
  asPrismaService,
  buildHarness,
  connect,
  seedSpot,
  seedUser,
  TODAY,
} from '../testing/database/reservation-harness';
import { unique } from '../testing/database/test-database';
import { EmployeeSyncService, placeholderOktaId } from './employee-sync.service';
import { UserDeactivationService } from './user-deactivation.service';

const FUTURE = '2099-01-05' as DateOnly;
const PAST = '2098-12-28' as DateOnly;

describe('employee sync against a real PostgreSQL', () => {
  let client: PrismaClient;
  let harness: Harness;
  let sync: EmployeeSyncService;
  let deactivation: UserDeactivationService;
  let admin: UserRow;
  let officeId: string;
  let zoneId: string;

  beforeAll(async () => {
    client = connect();
    harness = buildHarness(client);
    const prisma = asPrismaService(client);
    const audit = new AuditLogService(prisma);
    deactivation = new UserDeactivationService(
      prisma,
      new DeskCleanupService(audit, harness.publisher),
      harness.reservations,
      audit,
      harness.publisher
    );
    const config = { get: () => 'a'.repeat(64) } as unknown as ConfigService<ApiEnv, true>;
    sync = new EmployeeSyncService(prisma, deactivation, audit, config);
    admin = await seedUser(client);
    const office = await client.office.findUniqueOrThrow({
      where: { name: 'Praha' },
      include: { zones: { take: 1 } },
    });
    officeId = office.id;
    zoneId = office.zones[0]?.id ?? '';
  });

  afterAll(async () => {
    await sync.setLiveMode({ liveMode: false }, admin.id);
    await client.$disconnect();
  });

  beforeEach(async () => {
    harness.publisher.reset();
    await client.user.updateMany({
      where: { email: { endsWith: '@team.blue' } },
      data: { manualAccount: true },
    });
  });

  async function employee(
    overrides: { hibobId?: string | null; name?: string; active?: boolean; manual?: boolean } = {}
  ): Promise<UserRow> {
    const tag = unique('emp');
    return client.user.create({
      data: {
        email: `${tag}@team.blue`,
        name: overrides.name ?? tag,
        oktaId: unique('okta'),
        icsToken: unique('ics'),
        hibobId: overrides.hibobId === undefined ? unique('hb') : overrides.hibobId,
        active: overrides.active ?? true,
        manualAccount: overrides.manual ?? false,
        officeId,
      },
    });
  }

  function rowOf(user: UserRow, overrides: Partial<{ id: string; name: string }> = {}) {
    return {
      id: overrides.id ?? user.hibobId ?? '',
      email: user.email,
      name: overrides.name ?? user.name,
    };
  }

  async function desk(
    permanentAssigneeId: string | null = null
  ): Promise<{ id: string; code: string }> {
    return client.desk.create({
      data: {
        officeId,
        zoneId,
        code: unique('ES'),
        permanentAssigneeId,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      select: { id: true, code: true },
    });
  }

  async function reload(user: UserRow): Promise<UserRow> {
    return client.user.findUniqueOrThrow({ where: { id: user.id } });
  }

  it('links, renames, reactivates, creates and deactivates in a live run, and logs it', async () => {
    await sync.setLiveMode({ liveMode: true }, admin.id);
    const unlinked = await employee({ hibobId: null });
    const renamed = await employee({ name: 'Old Name' });
    const returning = await employee({ active: false });
    const leaver = await employee();
    const newHibobId = unique('hb-new');
    const newEmail = `${unique('new')}@team.blue`;

    const result = await sync.run(
      {
        source: 'test',
        employees: [
          rowOf(unlinked, { id: 'hb-linked-' + unlinked.id }),
          rowOf(renamed, { name: 'New Name' }),
          rowOf(returning),
          { id: newHibobId, email: newEmail, name: 'New Person' },
        ],
      },
      TODAY
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      mode: 'LIVE',
      reason: null,
      counts: {
        received: 4,
        activeBefore: 3,
        created: 1,
        renamed: 1,
        reactivated: 1,
        linked: 1,
        deactivated: 1,
      },
    });
    expect((await reload(unlinked)).hibobId).toBe('hb-linked-' + unlinked.id);
    expect((await reload(renamed)).name).toBe('New Name');
    expect(await reload(returning)).toMatchObject({ active: true, deactivatedAt: null });
    expect(await reload(leaver)).toMatchObject({ active: false, deactivatedAt: expect.any(Date) });

    // Pre-created so the first sign-in adopts it by e-mail.
    const created = await client.user.findUniqueOrThrow({ where: { email: newEmail } });
    expect(created).toMatchObject({
      hibobId: newHibobId,
      oktaId: placeholderOktaId(newHibobId),
      officeId: expect.any(String),
      active: true,
    });

    const run = await client.employeeSyncRun.findUniqueOrThrow({
      where: { id: result.body.runId },
    });
    expect(run).toMatchObject({ source: 'test', mode: 'LIVE', status: 'OK', reason: null });
    expect(await sync.adminGet()).toMatchObject({
      liveMode: true,
      configured: true,
      runs: expect.arrayContaining([expect.objectContaining({ id: run.id })]),
    });
  });

  it('frees a leaver’s future desk and parking bookings, queues and requests, and keeps the past', async () => {
    await sync.setLiveMode({ liveMode: true }, admin.id);
    const stayer = await employee();
    const leaver = await employee();
    const queued = await seedUser(client);
    const spot = await seedSpot(client);
    const otherSpot = await seedSpot(client);
    const freeDesk = await desk();
    const permanent = await desk(leaver.id);
    const hive = await client.hive.create({
      data: { name: unique('Hive'), color: '#2563EB', ownerId: leaver.id },
    });

    const futureParking = await client.reservation.create({
      data: { parkingSpotId: spot.id, userId: leaver.id, date: toDateColumn(FUTURE) },
    });
    const pastParking = await client.reservation.create({
      data: { parkingSpotId: spot.id, userId: leaver.id, date: toDateColumn(PAST) },
    });
    await client.waitlistEntry.create({
      data: { parkingSpotId: spot.id, userId: queued.id, date: toDateColumn(FUTURE) },
    });
    await client.waitlistEntry.create({
      data: {
        parkingSpotId: otherSpot.id,
        userId: leaver.id,
        date: toDateColumn('2099-01-06' as DateOnly),
      },
    });
    await client.deskReservation.create({
      data: { deskId: freeDesk.id, userId: leaver.id, date: toDateColumn(FUTURE) },
    });
    const pastDesk = await client.deskReservation.create({
      data: { deskId: freeDesk.id, userId: leaver.id, date: toDateColumn(PAST) },
    });
    const request = await client.deskApprovalRequest.create({
      data: {
        deskId: freeDesk.id,
        userId: leaver.id,
        date: toDateColumn('2099-01-07' as DateOnly),
      },
    });

    // Padding: two active employees need two rows to clear the shrink check.
    const result = await sync.run(
      {
        employees: [
          rowOf(stayer),
          { id: unique('hb'), email: `${unique('pad')}@team.blue`, name: 'Padding' },
        ],
      },
      TODAY
    );

    expect(result.status).toBe(200);
    const deactivated = (
      await client.employeeSyncRun.findUniqueOrThrow({ where: { id: result.body.runId } })
    ).summary as { deactivated: unknown[]; warnings: string[] };
    expect(deactivated.deactivated).toEqual([
      {
        email: leaver.email,
        name: leaver.name,
        freedDeskReservations: 1,
        freedParkingReservations: 1,
        removedWaitlistEntries: 1,
        rejectedRequests: 1,
        permanentDesks: [permanent.code],
        ownedHives: [hive.name],
      },
    ]);
    expect(deactivated.warnings).toEqual([
      expect.stringContaining(hive.name),
      expect.stringContaining(permanent.code),
    ]);

    // Parking: the future one went through the cancel path, so the queue got it.
    expect(await client.reservation.findUnique({ where: { id: futureParking.id } })).toBeNull();
    expect(
      await client.reservation.findFirst({
        where: { parkingSpotId: spot.id, date: toDateColumn(FUTURE) },
      })
    ).toMatchObject({ userId: queued.id });
    expect(await client.reservation.findUnique({ where: { id: pastParking.id } })).not.toBeNull();
    expect(await client.waitlistEntry.count({ where: { userId: leaver.id } })).toBe(0);

    // Desks: future freed, past kept, request rejected; hive and desk kept.
    expect(
      await client.deskReservation.findMany({ where: { userId: leaver.id }, select: { id: true } })
    ).toEqual([{ id: pastDesk.id }]);
    expect(
      await client.deskApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })
    ).toMatchObject({
      status: 'REJECTED',
    });
    expect(
      (await client.desk.findUniqueOrThrow({ where: { id: permanent.id } })).permanentAssigneeId
    ).toBe(leaver.id);
    expect((await client.hive.findUniqueOrThrow({ where: { id: hive.id } })).ownerId).toBe(
      leaver.id
    );

    const audit = await client.auditLog.findFirstOrThrow({
      where: { action: 'USER_DEACTIVATED', entityId: leaver.id },
    });
    expect(audit).toMatchObject({
      actorUserId: leaver.id,
      payload: {
        source: 'EMPLOYEE_SYNC',
        freedReservations: 1,
        freedDeskReservations: 1,
        removedWaitlistEntries: 1,
        rejectedRequests: 1,
      },
    });
    expect(harness.publisher.events.map((event) => event.name)).toEqual(
      expect.arrayContaining(['desk:released', 'reservation:reassigned', 'waitlist:updated'])
    );
  });

  it('changes nothing in a dry run, but logs what it would have done', async () => {
    await sync.setLiveMode({ liveMode: false }, admin.id);
    const stayer = await employee({ name: 'Before' });
    const leaver = await employee();
    const spot = await seedSpot(client);
    await client.reservation.create({
      data: { parkingSpotId: spot.id, userId: leaver.id, date: toDateColumn(FUTURE) },
    });
    const newEmail = `${unique('dry')}@team.blue`;

    const result = await sync.run(
      {
        employees: [
          rowOf(stayer, { name: 'After' }),
          { id: unique('hb'), email: newEmail, name: 'Dry New' },
        ],
      },
      TODAY
    );

    expect(result.body).toMatchObject({
      ok: true,
      mode: 'DRY',
      counts: { renamed: 1, created: 1, deactivated: 1 },
    });
    expect((await reload(stayer)).name).toBe('Before');
    expect((await reload(leaver)).active).toBe(true);
    expect(await client.user.findUnique({ where: { email: newEmail } })).toBeNull();
    expect(await client.reservation.count({ where: { userId: leaver.id } })).toBe(1);
    const run = await client.employeeSyncRun.findUniqueOrThrow({
      where: { id: result.body.runId },
    });
    expect(run).toMatchObject({ mode: 'DRY', status: 'OK' });
    expect((run.summary as { deactivated: unknown[] }).deactivated).toEqual([
      expect.objectContaining({ email: leaver.email, freedParkingReservations: 1 }),
    ]);
  });

  it('rejects a list that shrank by more than 10 %, logs the rejection and changes nothing', async () => {
    await sync.setLiveMode({ liveMode: true }, admin.id);
    const everyone = await Promise.all(Array.from({ length: 10 }, () => employee()));

    const result = await sync.run({ employees: everyone.slice(0, 8).map((u) => rowOf(u)) }, TODAY);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      ok: false,
      mode: 'LIVE',
      reason: expect.stringMatching(/^LIST_SHRANK: /),
    });
    expect(
      await client.user.count({ where: { id: { in: everyone.map((u) => u.id) }, active: true } })
    ).toBe(10);
    expect(
      await client.employeeSyncRun.findUniqueOrThrow({ where: { id: result.body.runId } })
    ).toMatchObject({ status: 'REJECTED', reason: result.body.reason });
  });

  it('logs a malformed payload as a rejected run with 400', async () => {
    const result = await sync.run({ employees: 'nope' }, TODAY);

    expect(result.status).toBe(400);
    expect(result.body.reason).toMatch(/^INVALID_PAYLOAD: /);
    expect(
      await client.employeeSyncRun.findUniqueOrThrow({ where: { id: result.body.runId } })
    ).toMatchObject({ status: 'REJECTED' });
  });

  it('never touches manual or non-company accounts', async () => {
    await sync.setLiveMode({ liveMode: true }, admin.id);
    const stayer = await employee();
    const manual = await employee({ manual: true });
    const external = await seedUser(client);

    const result = await sync.run(
      { employees: [rowOf(stayer), { id: unique('hb'), email: external.email, name: 'Renamed' }] },
      TODAY
    );

    expect(result.body.counts).toMatchObject({ deactivated: 0, renamed: 0, unchanged: 2 });
    expect(await reload(manual)).toMatchObject({ active: true, deactivatedAt: null });
    expect(await reload(external)).toMatchObject({
      active: true,
      name: external.name,
      hibobId: null,
    });
  });

  it('runs the same clean-up for an admin deactivation, attributed to the admin', async () => {
    const leaver = await employee();
    const freeDesk = await desk();
    await client.deskReservation.create({
      data: { deskId: freeDesk.id, userId: leaver.id, date: toDateColumn(FUTURE) },
    });

    const report = await deactivation.deactivate(leaver.id, 'ADMIN', admin.id, TODAY);

    expect(report.freedDeskReservations).toBe(1);
    expect(await client.deskReservation.count({ where: { userId: leaver.id } })).toBe(0);
    expect(
      await client.auditLog.findFirstOrThrow({
        where: { action: 'USER_DEACTIVATED', entityId: leaver.id },
      })
    ).toMatchObject({
      actorUserId: admin.id,
      payload: expect.objectContaining({ source: 'ADMIN' }),
    });
  });
});
