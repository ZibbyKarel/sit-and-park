/**
 * The validation and clean-up decisions of the admin desk and hive services.
 *
 * `PrismaDouble` models parking, not desks, so the few desk queries these
 * paths issue are stubbed per test and the clean-up service is a spy: what is
 * checked here is *which* refusal and *which* clean-up an edit leads to. That
 * the clean-up then deletes and rejects the right rows, under the row lock, is
 * `desk-admin.db.spec.ts`.
 */

import type { Desk as DeskRow } from '@sit-and-park/database';
import type { AuditLogService } from '../audit/audit-log.service';
import type { PrismaService } from '../database/prisma.service';
import type { DeskCleanupService } from '../desks/desk-cleanup.service';
import { DeskAdminService } from './desk-admin.service';
import { HiveAdminService } from './hive-admin.service';

const OFFICE_A = 'office-a';
const OFFICE_B = 'office-b';

function deskRow(overrides: Partial<DeskRow> = {}): DeskRow {
  return {
    id: 'desk-1',
    officeId: OFFICE_A,
    zoneId: 'zone-a',
    code: 'D-001',
    active: true,
    hiveId: 'hive-1',
    permanentAssigneeId: null,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function build(desk: DeskRow | null) {
  const client = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((run: (tx: unknown) => unknown): unknown => run(client)),
    desk: {
      findUnique: jest.fn().mockResolvedValue(desk),
      update: jest.fn(async ({ data }: { data: Partial<DeskRow> }) => ({ ...desk, ...data })),
    },
    zone: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        officeId: where.id === 'zone-b' ? OFFICE_B : OFFICE_A,
      })),
    },
    office: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => where) },
    hive: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }): Promise<{ id: string } | null> => where
      ),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    deskReservation: { findMany: jest.fn().mockResolvedValue([]) },
    deskRelease: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const cleanup = {
    cancelReservations: jest.fn().mockResolvedValue([]),
    rejectPendingRequests: jest.fn().mockResolvedValue(0),
    clearPreferredDesk: jest.fn().mockResolvedValue(0),
    publish: jest.fn(),
  };
  const audit = { record: jest.fn(), recordMany: jest.fn() };
  const service = new DeskAdminService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    cleanup as unknown as DeskCleanupService
  );
  return { client, cleanup, audit, service };
}

describe('DeskAdminService.update', () => {
  it('refuses an unknown desk with NOT_FOUND', async () => {
    const { service } = build(null);

    await expect(service.update({ deskId: 'nope', active: false }, 'admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an unknown hive with NOT_FOUND', async () => {
    const { service, client } = build(deskRow());
    client.hive.findUnique.mockResolvedValue(null);

    await expect(
      service.update({ deskId: 'desk-1', hiveId: 'hive-x' }, 'admin')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.desk.update).not.toHaveBeenCalled();
  });

  it('refuses a zone of another office, and an office move without a zone of it', async () => {
    const { service, client } = build(deskRow());

    await expect(
      service.update({ deskId: 'desk-1', zoneId: 'zone-b' }, 'admin')
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.update({ deskId: 'desk-1', officeId: OFFICE_B }, 'admin')
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(client.desk.update).not.toHaveBeenCalled();
  });

  it('writes, cleans up and audits nothing when nothing changes', async () => {
    const { service, client, cleanup, audit } = build(deskRow());

    await service.update({ deskId: 'desk-1', active: true, hiveId: 'hive-1' }, 'admin');

    expect(client.desk.update).not.toHaveBeenCalled();
    expect(cleanup.cancelReservations).not.toHaveBeenCalled();
    expect(cleanup.rejectPendingRequests).not.toHaveBeenCalled();
    expect(audit.recordMany).toHaveBeenCalledWith([], client);
  });

  it('cancels reservations and rejects requests on deactivation, then publishes', async () => {
    const { service, client, cleanup, audit } = build(deskRow());
    const released = [{ date: '2026-10-05', deskId: 'desk-1', reservationId: 'r1' }];
    cleanup.cancelReservations.mockResolvedValue(released);

    await expect(
      service.update({ deskId: 'desk-1', active: false }, 'admin')
    ).resolves.toMatchObject({ active: false });

    expect(cleanup.cancelReservations).toHaveBeenCalledWith(
      client,
      { deskId: 'desk-1' },
      'DESK_DEACTIVATED',
      'admin',
      expect.any(String)
    );
    expect(cleanup.rejectPendingRequests).toHaveBeenCalledWith(
      client,
      { deskId: 'desk-1' },
      'DESK_DEACTIVATED',
      'admin'
    );
    expect(cleanup.publish).toHaveBeenCalledWith(released);
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: 'DESK_UPDATED',
          payload: expect.objectContaining({
            before: expect.objectContaining({ active: true }),
            after: expect.objectContaining({ active: false }),
          }),
        }),
      ],
      client
    );
  });

  it('only rejects requests when the hive is cleared', async () => {
    const { service, cleanup } = build(deskRow());

    await service.update({ deskId: 'desk-1', hiveId: null }, 'admin');

    expect(cleanup.cancelReservations).not.toHaveBeenCalled();
    expect(cleanup.rejectPendingRequests).toHaveBeenCalledWith(
      expect.anything(),
      { deskId: 'desk-1' },
      'DESK_HIVE_CHANGED',
      'admin'
    );
  });

  it('clears a permanent holder who is not in the new office, and keeps one who is', async () => {
    const moved = build(deskRow({ permanentAssigneeId: 'holder' }));
    moved.client.user.findUnique.mockResolvedValue({ officeId: OFFICE_A });

    await moved.service.update({ deskId: 'desk-1', officeId: OFFICE_B, zoneId: 'zone-b' }, 'admin');

    expect(moved.client.desk.update).toHaveBeenCalledWith({
      where: { id: 'desk-1' },
      data: expect.objectContaining({ officeId: OFFICE_B, permanentAssigneeId: null }),
    });
    expect(moved.client.deskRelease.deleteMany).toHaveBeenCalled();
    expect(moved.cleanup.cancelReservations).toHaveBeenCalledWith(
      expect.anything(),
      { deskId: 'desk-1' },
      'DESK_OFFICE_CHANGED',
      'admin',
      expect.any(String)
    );

    const kept = build(deskRow({ permanentAssigneeId: 'holder' }));
    kept.client.user.findUnique.mockResolvedValue({ officeId: OFFICE_B });

    await kept.service.update({ deskId: 'desk-1', officeId: OFFICE_B, zoneId: 'zone-b' }, 'admin');

    expect(kept.client.desk.update).toHaveBeenCalledWith({
      where: { id: 'desk-1' },
      data: expect.not.objectContaining({ permanentAssigneeId: null }),
    });
    expect(kept.client.deskRelease.deleteMany).not.toHaveBeenCalled();
  });
});

describe('DeskAdminService.setPermanentAssignee', () => {
  it('refuses an unknown user with NOT_FOUND', async () => {
    const { service } = build(deskRow());

    await expect(
      service.setPermanentAssignee({ deskId: 'desk-1', userId: 'nobody' }, 'admin')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['an inactive user', { active: false, officeId: OFFICE_A, permanentDesk: null }],
    ['a user of another office', { active: true, officeId: OFFICE_B, permanentDesk: null }],
    ['a user without an office', { active: true, officeId: null, permanentDesk: null }],
  ])('refuses %s with VALIDATION_FAILED', async (_label, user) => {
    const { service, client } = build(deskRow());
    client.user.findUnique.mockResolvedValue(user);

    await expect(
      service.setPermanentAssignee({ deskId: 'desk-1', userId: 'u1' }, 'admin')
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(client.desk.update).not.toHaveBeenCalled();
  });

  it('refuses a user who already holds another permanent desk with CONFLICT', async () => {
    const { service, client } = build(deskRow());
    client.user.findUnique.mockResolvedValue({
      active: true,
      officeId: OFFICE_A,
      permanentDesk: { id: 'desk-2' },
    });

    await expect(
      service.setPermanentAssignee({ deskId: 'desk-1', userId: 'u1' }, 'admin')
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does nothing when the holder does not change', async () => {
    const { service, client, audit } = build(deskRow({ permanentAssigneeId: 'u1' }));

    await service.setPermanentAssignee({ deskId: 'desk-1', userId: 'u1' }, 'admin');

    expect(client.desk.update).not.toHaveBeenCalled();
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('cancels other people’s reservations of the desk and the holder’s elsewhere', async () => {
    const { service, client, cleanup } = build(deskRow());
    client.user.findUnique.mockResolvedValue({
      active: true,
      officeId: OFFICE_A,
      permanentDesk: null,
    });
    const keptRelease = new Date('2026-10-07T00:00:00.000Z');
    client.deskRelease.findMany.mockResolvedValue([{ date: keptRelease }]);

    await service.setPermanentAssignee({ deskId: 'desk-1', userId: 'u1' }, 'admin');

    expect(cleanup.cancelReservations).toHaveBeenCalledWith(
      client,
      { deskId: 'desk-1', userId: { not: 'u1' }, date: { notIn: [keptRelease] } },
      'PERMANENT_ASSIGNMENT',
      'admin',
      expect.any(String)
    );
    expect(cleanup.cancelReservations).toHaveBeenCalledWith(
      client,
      { userId: 'u1', deskId: { not: 'desk-1' } },
      'PERMANENT_ASSIGNMENT',
      'admin',
      expect.any(String)
    );
  });

  it('clearing the holder drops unbooked releases and cancels nothing', async () => {
    const { service, client, cleanup } = build(deskRow({ permanentAssigneeId: 'u1' }));

    await service.setPermanentAssignee({ deskId: 'desk-1', userId: null }, 'admin');

    expect(client.deskRelease.deleteMany).toHaveBeenCalled();
    expect(cleanup.cancelReservations).not.toHaveBeenCalled();
  });
});

describe('HiveAdminService owner validation', () => {
  function hives(owner: { active: boolean } | null) {
    const client = {
      user: { findUnique: jest.fn().mockResolvedValue(owner) },
      hive: { create: jest.fn() },
    };
    const service = new HiveAdminService(
      { client } as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditLogService,
      {} as DeskCleanupService
    );
    return { service, client };
  }

  it('refuses an unknown owner with NOT_FOUND and an inactive one with VALIDATION_FAILED', async () => {
    const input = { name: 'Team', color: '#2563EB', ownerId: 'u1' };

    await expect(hives(null).service.create(input, 'admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const inactive = hives({ active: false });
    await expect(inactive.service.create(input, 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(inactive.client.hive.create).not.toHaveBeenCalled();
  });
});
