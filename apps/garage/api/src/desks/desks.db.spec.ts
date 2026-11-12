/**
 * Desk booking against a real PostgreSQL 17: the uniques, the desk row lock,
 * the permanent-desk and release rules, approval, cancelling and the clean-up
 * other modules reuse. Same harness and style as the reservation suites; the
 * desks are this file's own (unique codes in the migration's Praha office),
 * so the 221 seeded desks are never touched.
 */

import type { PrismaClient, User as UserRow } from '@garage/database';
import type { DateOnly } from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { toDateColumn } from '../common/prisma-mapping';
import {
  actorFor,
  asPrismaService,
  codeOf,
  codeOfRejection,
  connect,
  contractCodeOf,
  holdTransaction,
  RecordingPublisher,
  TODAY,
  waitForBlockedBackend,
} from '../testing/database/reservation-harness';
import { unique } from '../testing/database/test-database';
import { DeskCleanupService } from './desk-cleanup.service';
import { DeskRequestsService } from './desk-requests.service';
import { DesksService } from './desks.service';

const D1 = '2099-01-05' as DateOnly;
const D2 = '2099-01-06' as DateOnly;
const D3 = '2099-01-07' as DateOnly;
const PAST = '2098-12-28' as DateOnly;

describe('desk booking against a real PostgreSQL', () => {
  let client: PrismaClient;
  let otherClient: PrismaClient;
  let publisher: RecordingPublisher;
  let desks: DesksService;
  let otherDesks: DesksService;
  let requests: DeskRequestsService;
  let cleanup: DeskCleanupService;
  let officeId: string;
  let zoneId: string;

  function services(db: PrismaClient, recorder: RecordingPublisher) {
    const prisma = asPrismaService(db);
    const audit = new AuditLogService(prisma);
    return {
      desks: new DesksService(prisma, audit, recorder),
      requests: new DeskRequestsService(prisma, audit, recorder),
      cleanup: new DeskCleanupService(audit, recorder),
    };
  }

  beforeAll(async () => {
    client = connect();
    otherClient = connect();
    publisher = new RecordingPublisher();
    ({ desks, requests, cleanup } = services(client, publisher));
    otherDesks = services(otherClient, new RecordingPublisher()).desks;
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

  // --- fixtures ---------------------------------------------------------------

  async function user(
    overrides: { role?: 'USER' | 'ADMIN'; inOffice?: boolean; active?: boolean } = {}
  ): Promise<UserRow> {
    return client.user.create({
      data: {
        email: `${unique('desk-user')}@example.test`,
        name: unique('Desk Tester'),
        oktaId: unique('okta'),
        icsToken: unique('ics'),
        role: overrides.role ?? 'USER',
        active: overrides.active ?? true,
        officeId: overrides.inOffice === false ? null : officeId,
      },
    });
  }

  async function hive(ownerId: string): Promise<string> {
    const row = await client.hive.create({
      data: { name: unique('Hive'), color: '#2563EB', ownerId },
    });
    return row.id;
  }

  async function desk(
    overrides: { hiveId?: string; permanentAssigneeId?: string; active?: boolean } = {}
  ): Promise<{ id: string; code: string }> {
    return client.desk.create({
      data: {
        officeId,
        zoneId,
        code: unique('T'),
        active: overrides.active ?? true,
        hiveId: overrides.hiveId ?? null,
        permanentAssigneeId: overrides.permanentAssigneeId ?? null,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      select: { id: true, code: true },
    });
  }

  async function book(holder: UserRow, deskId: string, date: DateOnly): Promise<string> {
    const row = await client.deskReservation.create({
      data: { deskId, userId: holder.id, date: toDateColumn(date) },
    });
    return row.id;
  }

  // --- series -------------------------------------------------------------------

  describe('reserve and previewSeries', () => {
    it('books the free days of a mixed series and reports the others; preview agrees', async () => {
      const [me, other] = [await user(), await user()];
      const target = await desk();
      const elsewhere = await desk();
      await book(other, target.id, D2);
      await book(me, elsewhere.id, D3);
      const input = { deskId: target.id, dates: [D3, PAST, D1, D2] };

      const preview = await desks.previewSeries(input, actorFor(me), TODAY);
      expect(preview.days).toEqual([
        { date: PAST, ok: false, reason: 'PAST_DATE' },
        { date: D1, ok: true, reason: null },
        { date: D2, ok: false, reason: 'DESK_TAKEN' },
        { date: D3, ok: false, reason: 'ALREADY_RESERVED_OTHER_DESK' },
      ]);
      expect(await client.deskReservation.count({ where: { deskId: target.id } })).toBe(1);

      const result = await desks.reserve(input, actorFor(me), TODAY);
      expect(result.reserved.map((row) => row.date)).toEqual([D1]);
      expect(result.skipped).toEqual([
        { date: PAST, reason: 'PAST_DATE' },
        { date: D2, reason: 'DESK_TAKEN' },
        { date: D3, reason: 'ALREADY_RESERVED_OTHER_DESK' },
      ]);
      expect(
        await client.auditLog.count({
          where: { action: 'DESK_RESERVATION_CREATED', entityId: result.reserved[0]?.id ?? '' },
        })
      ).toBe(1);
      expect(publisher.ofKind('desk:reserved').map((event) => event.payload)).toEqual([
        {
          date: D1,
          deskId: target.id,
          reservationId: result.reserved[0]?.id,
          userId: me.id,
          userName: me.name,
        },
      ]);
    });

    it('NO_FREE_DAY when nothing can be booked, and writes nothing', async () => {
      const [me, other] = [await user(), await user()];
      const target = await desk();
      await book(other, target.id, D1);
      expect(
        await codeOf(desks.reserve({ deskId: target.id, dates: [D1] }, actorFor(me), TODAY))
      ).toBe('NO_FREE_DAY');
      expect(publisher.events).toEqual([]);
    });

    it('the series blockers fail the whole call', async () => {
      const [me, owner, noOffice] = [await user(), await user(), await user({ inOffice: false })];
      const hiveDesk = await desk({ hiveId: await hive(owner.id) });
      const inactive = await desk({ active: false });
      const plain = await desk();

      expect(
        await codeOf(desks.previewSeries({ deskId: hiveDesk.id, dates: [D1] }, actorFor(me), TODAY))
      ).toBe('DESK_ACCESS_DENIED');
      expect(
        await codeOf(desks.reserve({ deskId: inactive.id, dates: [D1] }, actorFor(me), TODAY))
      ).toBe('DESK_NOT_AVAILABLE');
      expect(
        await codeOf(desks.reserve({ deskId: plain.id, dates: [D1] }, actorFor(noOffice), TODAY))
      ).toBe('NO_OFFICE_ASSIGNED');
      expect(
        await codeOf(
          desks.reserve(
            { deskId: '01900000-0000-7000-8000-000000000000', dates: [D1] },
            actorFor(me),
            TODAY
          )
        )
      ).toBe('NOT_FOUND');
    });

    it('a hive member, a grantee and an admin book a hive desk directly', async () => {
      const owner = await user();
      const hiveId = await hive(owner.id);
      const [member, grantee, admin] = [await user(), await user(), await user({ role: 'ADMIN' })];
      await client.hiveMembership.create({ data: { hiveId, userId: member.id } });
      const target = await desk({ hiveId });
      await client.deskGrant.create({ data: { deskId: target.id, userId: grantee.id } });

      await desks.reserve({ deskId: target.id, dates: [D1] }, actorFor(member), TODAY);
      await desks.reserve({ deskId: target.id, dates: [D2] }, actorFor(grantee), TODAY);
      await desks.reserve({ deskId: target.id, dates: [D3] }, actorFor(admin, 'ADMIN'), TODAY);
      expect(await client.deskReservation.count({ where: { deskId: target.id } })).toBe(3);
    });
  });

  // --- concurrency --------------------------------------------------------------

  describe('races', () => {
    it('two users racing for one desk and day: one wins, the other is told nothing was free', async () => {
      const [a, b] = [await user(), await user()];
      const target = await desk();
      const outcomes = await Promise.allSettled([
        desks.reserve({ deskId: target.id, dates: [D1] }, actorFor(a), TODAY),
        otherDesks.reserve({ deskId: target.id, dates: [D1] }, actorFor(b), TODAY),
      ]);
      const codes = outcomes.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [] : [codeOfRejection(outcome)]
      );
      expect(codes).toHaveLength(1);
      // The desk lock serialises them, so the loser's plan already sees the
      // winner's row; if it ever slipped past, the unique index answers.
      expect(['NO_FREE_DAY', 'DESK_ALREADY_RESERVED']).toContain(codes[0]);
      expect(await client.deskReservation.count({ where: { deskId: target.id } })).toBe(1);
    });

    it('even a writer that skips the desk lock is serialised by it, and (deskId, date) maps to DESK_ALREADY_RESERVED', async () => {
      const [a, b] = [await user(), await user()];
      const target = await desk();
      // An uncommitted reservation inserted without `lockDesk`. Its foreign key
      // still takes `FOR KEY SHARE` on the desk row, which conflicts with the
      // service's `FOR UPDATE`: the service waits at the lock, then plans
      // against the committed row.
      const held = holdTransaction(otherClient, (tx) =>
        tx.deskReservation.create({
          data: { deskId: target.id, userId: a.id, date: toDateColumn(D1) },
        })
      );
      await held.ready;
      const loser = desks.reserve({ deskId: target.id, dates: [D1] }, actorFor(b), TODAY);
      await waitForBlockedBackend(client);
      held.release();
      await held.done;
      expect(await codeOf(loser)).toBe('NO_FREE_DAY');

      // The index itself, and the mapping of its real driver error.
      let code = '';
      try {
        await client.deskReservation.create({
          data: { deskId: target.id, userId: b.id, date: toDateColumn(D1) },
        });
      } catch (error) {
        code = contractCodeOf(error);
      }
      expect(code).toBe('DESK_ALREADY_RESERVED');
    });

    it('one user racing for two desks the same day: one wins, the other DESK_RESERVATION_LIMIT_REACHED', async () => {
      const me = await user();
      const [first, second] = [await desk(), await desk()];
      // The first booking, held open: another desk, so the second desk's lock
      // does not serialise against it — only (userId, date) does.
      const held = holdTransaction(otherClient, (tx) =>
        tx.deskReservation.create({
          data: { deskId: first.id, userId: me.id, date: toDateColumn(D1) },
        })
      );
      await held.ready;
      const loser = desks.reserve({ deskId: second.id, dates: [D1] }, actorFor(me), TODAY);
      await waitForBlockedBackend(client);
      held.release();
      await held.done;
      expect(await codeOf(loser)).toBe('DESK_RESERVATION_LIMIT_REACHED');
      expect(await client.deskReservation.count({ where: { userId: me.id } })).toBe(1);
    });
  });

  // --- permanent desks and releases --------------------------------------------

  describe('permanent desks and releases', () => {
    it('a permanent holder cannot book any desk, even on a day they released their own', async () => {
      const holder = await user();
      const own = await desk({ permanentAssigneeId: holder.id });
      const other = await desk();
      await desks.release({ dates: [D1] }, actorFor(holder), TODAY);

      expect(
        await codeOf(desks.reserve({ deskId: other.id, dates: [D1] }, actorFor(holder), TODAY))
      ).toBe('PERMANENT_DESK_HOLDER');
      expect(
        await codeOf(desks.reserve({ deskId: own.id, dates: [D2] }, actorFor(holder), TODAY))
      ).toBe('PERMANENT_DESK_HOLDER');
    });

    it('a released day is bookable by another, and the release cannot be withdrawn afterwards', async () => {
      const [holder, guest] = [await user(), await user()];
      const own = await desk({ permanentAssigneeId: holder.id });

      const plan = await desks.previewSeries(
        { deskId: own.id, dates: [D1, D2] },
        actorFor(guest),
        TODAY
      );
      expect(plan.days.map((day) => day.reason)).toEqual(['DESK_ASSIGNED', 'DESK_ASSIGNED']);

      expect(await desks.release({ dates: [D1, D2] }, actorFor(holder), TODAY)).toEqual({
        added: 2,
      });
      // Already released days are skipped silently.
      expect(await desks.release({ dates: [D2, D3] }, actorFor(holder), TODAY)).toEqual({
        added: 1,
      });

      const result = await desks.reserve({ deskId: own.id, dates: [D1] }, actorFor(guest), TODAY);
      expect(result.reserved).toHaveLength(1);

      const mine = await desks.myReleases(actorFor(holder), TODAY);
      expect(mine?.releases.map((release) => [release.date, release.reservedByName])).toEqual([
        [D1, guest.name],
        [D2, null],
        [D3, null],
      ]);
      const [booked, free] = mine?.releases ?? [];
      expect(
        await codeOf(desks.cancelRelease({ releaseId: booked?.id ?? '' }, actorFor(holder)))
      ).toBe('DESK_RELEASE_ALREADY_RESERVED');
      expect(
        await codeOf(desks.cancelRelease({ releaseId: free?.id ?? '' }, actorFor(guest)))
      ).toBe('FORBIDDEN');
      expect(await desks.cancelRelease({ releaseId: free?.id ?? '' }, actorFor(holder))).toEqual({
        releaseId: free?.id,
      });
      expect(
        await client.auditLog.count({ where: { action: 'DESK_RELEASED', actorUserId: holder.id } })
      ).toBe(3);
    });

    it('release refuses past days and a caller without a permanent desk', async () => {
      const [holder, nobody] = [await user(), await user()];
      await desk({ permanentAssigneeId: holder.id });
      expect(await codeOf(desks.release({ dates: [PAST, D1] }, actorFor(holder), TODAY))).toBe(
        'PAST_DATE'
      );
      expect(await codeOf(desks.release({ dates: [D1] }, actorFor(nobody), TODAY))).toBe(
        'NO_PERMANENT_DESK'
      );
      expect(await desks.myReleases(actorFor(nobody), TODAY)).toBeNull();
    });
  });

  // --- cancelling ------------------------------------------------------------

  describe('cancel', () => {
    it('the holder cancels today and later, not the past; others are FORBIDDEN; an admin may cancel anything', async () => {
      const [me, other, admin] = [await user(), await user(), await user({ role: 'ADMIN' })];
      const target = await desk();
      const future = await book(me, target.id, D1);
      const today = await book(me, target.id, TODAY);
      const past = await book(me, target.id, PAST);

      expect(await codeOf(desks.cancel({ reservationId: future }, actorFor(other), TODAY))).toBe(
        'FORBIDDEN'
      );
      expect(await codeOf(desks.cancel({ reservationId: past }, actorFor(me), TODAY))).toBe(
        'PAST_DATE'
      );

      expect(await desks.cancel({ reservationId: today }, actorFor(me), TODAY)).toEqual({
        reservationId: today,
        date: TODAY,
        deskId: target.id,
      });
      await desks.cancel({ reservationId: future }, actorFor(me), TODAY);
      await desks.cancel({ reservationId: past }, actorFor(admin, 'ADMIN'), TODAY);

      expect(await client.deskReservation.count({ where: { deskId: target.id } })).toBe(0);
      expect(
        await client.auditLog.count({
          where: { action: 'DESK_RESERVATION_CANCELLED', entityId: { in: [today, future] } },
        })
      ).toBe(2);
      expect(
        await client.auditLog.count({
          where: { action: 'DESK_RESERVATION_CANCELLED_BY_ADMIN', entityId: past },
        })
      ).toBe(1);
      expect(publisher.ofKind('desk:released')).toHaveLength(3);
      expect(await codeOf(desks.cancel({ reservationId: future }, actorFor(me), TODAY))).toBe(
        'NOT_FOUND'
      );
    });
  });

  // --- directory ---------------------------------------------------------------

  describe('directory', () => {
    it('reports status and access per desk for the day', async () => {
      const [me, other, owner] = [await user(), await user(), await user()];
      const hiveId = await hive(owner.id);
      const free = await desk();
      const mine = await desk();
      const taken = await desk();
      const hiveDesk = await desk({ hiveId });
      const assigned = await desk({ permanentAssigneeId: other.id });
      const inactive = await desk({ active: false });
      const myId = await book(me, mine.id, D1);
      await book(other, taken.id, D1);

      const result = await desks.directory({ date: D1 }, actorFor(me));
      const byId = new Map(result.desks.map((row) => [row.id, row]));
      expect(byId.get(free.id)).toMatchObject({
        status: 'FREE',
        access: 'DIRECT',
        myReservationId: null,
      });
      expect(byId.get(mine.id)).toMatchObject({ status: 'RESERVED_BY_ME', myReservationId: myId });
      expect(byId.get(taken.id)).toMatchObject({ status: 'RESERVED', reservedByName: other.name });
      expect(byId.get(hiveDesk.id)).toMatchObject({
        status: 'FREE',
        access: 'APPROVAL',
        hiveColor: '#2563EB',
      });
      expect(byId.get(assigned.id)).toMatchObject({
        status: 'ASSIGNED',
        permanentAssigneeName: other.name,
        releasedOn: false,
      });
      expect(byId.get(inactive.id)).toMatchObject({ status: 'INACTIVE' });
      expect(result.office.name).toBe('Praha');
      expect(result.hives.some((row) => row.id === hiveId)).toBe(true);
    });

    it('NO_OFFICE_ASSIGNED for a caller without an office', async () => {
      const homeless = await user({ inOffice: false });
      expect(await codeOf(desks.directory({ date: D1 }, actorFor(homeless)))).toBe(
        'NO_OFFICE_ASSIGNED'
      );
    });
  });

  // --- approval -------------------------------------------------------------------

  describe('approval requests', () => {
    async function hiveDeskScene() {
      const [owner, requester, stranger] = [await user(), await user(), await user()];
      const hiveId = await hive(owner.id);
      const target = await desk({ hiveId });
      return { owner, requester, stranger, hiveId, target };
    }

    it('happy path: request, owner inbox, approval books the desk for the requester', async () => {
      const { owner, requester, stranger, target } = await hiveDeskScene();
      const request = await requests.requestApproval(
        { deskId: target.id, date: D1 },
        actorFor(requester),
        TODAY
      );
      expect(request.status).toBe('PENDING');
      expect(publisher.approvalNotices).toEqual([
        expect.objectContaining({ hiveOwnerId: owner.id, status: 'PENDING' }),
      ]);

      const inbox = await requests.pendingRequests(actorFor(owner));
      expect(inbox.requests.map((row) => row.id)).toEqual([request.id]);
      expect(inbox.requests[0]).toMatchObject({
        requesterName: requester.name,
        deskCode: target.code,
      });
      expect((await requests.pendingRequests(actorFor(stranger))).requests).toEqual([]);

      expect(
        await codeOf(
          requests.decideRequest(
            { requestId: request.id, approve: true },
            actorFor(stranger),
            TODAY
          )
        )
      ).toBe('FORBIDDEN');

      const decided = await requests.decideRequest(
        { requestId: request.id, approve: true },
        actorFor(owner),
        TODAY
      );
      expect(decided.request).toMatchObject({ status: 'APPROVED', decidedById: owner.id });
      expect(decided.reservation).toMatchObject({
        deskId: target.id,
        userId: requester.id,
        date: D1,
      });
      expect(publisher.ofKind('desk:reserved').map((event) => event.payload.userId)).toEqual([
        requester.id,
      ]);
      expect(
        await codeOf(
          requests.decideRequest({ requestId: request.id, approve: false }, actorFor(owner), TODAY)
        )
      ).toBe('DESK_REQUEST_ALREADY_DECIDED');
      expect((await requests.myRequests(actorFor(requester))).requests[0]?.status).toBe('APPROVED');
    });

    it('approval after the desk got taken is DESK_ALREADY_RESERVED; rejection still works', async () => {
      const { owner, requester, target } = await hiveDeskScene();
      const member = await user();
      const request = await requests.requestApproval(
        { deskId: target.id, date: D1 },
        actorFor(requester),
        TODAY
      );
      await book(member, target.id, D1);
      expect(
        await codeOf(
          requests.decideRequest({ requestId: request.id, approve: true }, actorFor(owner), TODAY)
        )
      ).toBe('DESK_ALREADY_RESERVED');
      const rejected = await requests.decideRequest(
        { requestId: request.id, approve: false },
        actorFor(owner),
        TODAY
      );
      expect(rejected).toMatchObject({ request: { status: 'REJECTED' }, reservation: null });
    });

    it('approval re-checks the requester', async () => {
      const { owner, requester, target } = await hiveDeskScene();
      const request = await requests.requestApproval(
        { deskId: target.id, date: D1 },
        actorFor(requester),
        TODAY
      );
      await desk({ permanentAssigneeId: requester.id });
      expect(
        await codeOf(
          requests.decideRequest({ requestId: request.id, approve: true }, actorFor(owner), TODAY)
        )
      ).toBe('PERMANENT_DESK_HOLDER');
      await client.user.update({ where: { id: requester.id }, data: { active: false } });
      expect(
        await codeOf(
          requests.decideRequest({ requestId: request.id, approve: true }, actorFor(owner), TODAY)
        )
      ).toBe('VALIDATION_FAILED');
    });

    it('refuses a duplicate pending request, a directly bookable desk and a desk outside any hive', async () => {
      const { requester, hiveId, target } = await hiveDeskScene();
      const member = await user();
      await client.hiveMembership.create({ data: { hiveId, userId: member.id } });
      const plain = await desk();

      await requests.requestApproval({ deskId: target.id, date: D1 }, actorFor(requester), TODAY);
      expect(
        await codeOf(
          requests.requestApproval({ deskId: target.id, date: D1 }, actorFor(requester), TODAY)
        )
      ).toBe('DESK_REQUEST_ALREADY_PENDING');
      expect(
        await codeOf(
          requests.requestApproval({ deskId: target.id, date: D2 }, actorFor(member), TODAY)
        )
      ).toBe('VALIDATION_FAILED');
      expect(
        await codeOf(
          requests.requestApproval({ deskId: plain.id, date: D2 }, actorFor(requester), TODAY)
        )
      ).toBe('VALIDATION_FAILED');
      expect(
        await codeOf(
          requests.requestApproval({ deskId: target.id, date: PAST }, actorFor(requester), TODAY)
        )
      ).toBe('PAST_DATE');
    });

    it('the partial unique index maps to DESK_REQUEST_ALREADY_PENDING', async () => {
      const { requester, target } = await hiveDeskScene();
      const data = { deskId: target.id, userId: requester.id, date: toDateColumn(D2) };
      await client.deskApprovalRequest.create({ data });
      let code = '';
      try {
        await client.deskApprovalRequest.create({ data });
      } catch (error) {
        code = contractCodeOf(error);
      }
      expect(code).toBe('DESK_REQUEST_ALREADY_PENDING');
      // A decided request does not block a new one.
      await client.deskApprovalRequest.updateMany({ where: data, data: { status: 'REJECTED' } });
      await client.deskApprovalRequest.create({ data });
    });

    it('an admin sees every pending request; only its author withdraws one, and only while pending', async () => {
      const { requester, stranger, target } = await hiveDeskScene();
      const admin = await user({ role: 'ADMIN' });
      const request = await requests.requestApproval(
        { deskId: target.id, date: D2 },
        actorFor(requester),
        TODAY
      );

      const inbox = await requests.pendingRequests(actorFor(admin, 'ADMIN'));
      expect(inbox.requests.map((row) => row.id)).toContain(request.id);

      expect(
        await codeOf(requests.cancelRequest({ requestId: request.id }, actorFor(stranger)))
      ).toBe('FORBIDDEN');
      expect(await requests.cancelRequest({ requestId: request.id }, actorFor(requester))).toEqual({
        requestId: request.id,
      });
      expect(
        await codeOf(requests.cancelRequest({ requestId: request.id }, actorFor(requester)))
      ).toBe('NOT_FOUND');

      const again = await requests.requestApproval(
        { deskId: target.id, date: D2 },
        actorFor(requester),
        TODAY
      );
      await requests.decideRequest(
        { requestId: again.id, approve: false },
        actorFor(admin, 'ADMIN'),
        TODAY
      );
      expect(
        await codeOf(requests.cancelRequest({ requestId: again.id }, actorFor(requester)))
      ).toBe('DESK_REQUEST_ALREADY_DECIDED');
    });
  });

  // --- clean-up for other modules ------------------------------------------------

  describe('DeskCleanupService', () => {
    it('cancels only today-and-later reservations, audits them and returns their events', async () => {
      const [me, admin] = [await user(), await user({ role: 'ADMIN' })];
      const target = await desk();
      const past = await book(me, target.id, PAST);
      const future = await book(me, target.id, D1);

      const events = await client.$transaction((tx) =>
        cleanup.cancelReservations(tx, { deskId: target.id }, 'DESK_DEACTIVATED', admin.id, TODAY)
      );
      expect(events).toEqual([{ date: D1, deskId: target.id, reservationId: future }]);
      expect(
        await client.deskReservation.findMany({
          where: { deskId: target.id },
          select: { id: true },
        })
      ).toEqual([{ id: past }]);
      expect(
        await client.auditLog.count({
          where: { action: 'DESK_RESERVATION_CANCELLED_BY_ADMIN', entityId: future },
        })
      ).toBe(1);
      cleanup.publish(events);
      expect(publisher.ofKind('desk:released')).toHaveLength(1);
    });

    it('rejects pending requests with a reason', async () => {
      const [owner, requester, admin] = [await user(), await user(), await user({ role: 'ADMIN' })];
      const target = await desk({ hiveId: await hive(owner.id) });
      await requests.requestApproval({ deskId: target.id, date: D1 }, actorFor(requester), TODAY);

      const count = await client.$transaction((tx) =>
        cleanup.rejectPendingRequests(tx, { deskId: target.id }, 'HIVE_DELETED', admin.id)
      );
      expect(count).toBe(1);
      expect(
        await client.deskApprovalRequest.findFirst({ where: { deskId: target.id } })
      ).toMatchObject({
        status: 'REJECTED',
        decidedById: admin.id,
      });
    });
  });
});
