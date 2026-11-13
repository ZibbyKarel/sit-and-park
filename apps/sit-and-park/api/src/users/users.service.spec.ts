import { AuditLogService } from '../audit/audit-log.service';
import { DEFAULT_OFFICE_ID, PrismaDouble } from '../testing/prisma-double';
import type { UserDeactivationService } from '../employee-sync/user-deactivation.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let double: PrismaDouble;
  let users: UsersService;
  let deactivate: jest.Mock;

  beforeEach(() => {
    double = new PrismaDouble();
    // Like the real one, the deactivation owns the `active` flip.
    deactivate = jest.fn(async (id: string) => {
      const row = double.users.find((candidate) => candidate.id === id);
      if (row !== undefined) {
        row.active = false;
        row.deactivatedAt ??= new Date();
      }
    });
    users = new UsersService(
      double.asPrismaService(),
      new AuditLogService(double.asPrismaService()),
      { deactivate } as unknown as UserDeactivationService
    );
  });

  describe('adminList', () => {
    beforeEach(() => {
      double.seedUser({ name: 'Alice', email: 'alice@example.test', role: 'ADMIN' });
      double.seedUser({ name: 'Bob', email: 'bob@example.test' });
      double.seedUser({ name: 'Carol', email: 'carol@example.test', active: false });
    });

    it('never exposes another person’s ICS token', async () => {
      // The token is the only credential on a personal calendar feed URL. An
      // admin has no reason to hold one, and `adminUserSchema` omits it.
      const listed = await users.adminList({});

      for (const user of listed) {
        expect(user).not.toHaveProperty('icsToken');
      }
    });

    it('filters by role and by activity', async () => {
      await expect(users.adminList({ role: 'ADMIN' })).resolves.toHaveLength(1);
      await expect(users.adminList({ active: false })).resolves.toHaveLength(1);
    });

    it('matches the search term against name or email, case-insensitively', async () => {
      await expect(users.adminList({ search: 'ALI' })).resolves.toMatchObject([{ name: 'Alice' }]);
      await expect(users.adminList({ search: 'bob@' })).resolves.toMatchObject([{ name: 'Bob' }]);
      await expect(users.adminList({ search: 'nobody' })).resolves.toEqual([]);
    });

    describe('excludingReservedOrQueuedFor', () => {
      it('excludes a user who already has a reservation that day, for any spot', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const spotB = double.seedSpot({ label: 'B1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedReservation({ parkingSpotId: spotB.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).not.toContain('Bob');
      });

      it('excludes a user already queued for this specific spot that day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedWaitlistEntry({ parkingSpotId: spotA.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).not.toContain('Bob');
      });

      it('does not exclude a user queued for a different spot that day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const spotB = double.seedSpot({ label: 'B1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedWaitlistEntry({ parkingSpotId: spotB.id, userId: bob.id, date: '2026-09-15' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).toContain('Bob');
      });

      it('does not exclude anyone for a reservation or queue entry on a different day', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const bob = double.users.find((row) => row.name === 'Bob');
        if (bob === undefined) throw new Error('seed missing Bob');
        double.seedReservation({ parkingSpotId: spotA.id, userId: bob.id, date: '2026-09-16' });

        const listed = await users.adminList({
          active: true,
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed.map((row) => row.name)).toContain('Bob');
      });

      it('applies role/active/search filtering and the exclusion together', async () => {
        const spotA = double.seedSpot({ label: 'A1' });
        const alice = double.users.find((row) => row.name === 'Alice');
        if (alice === undefined) throw new Error('seed missing Alice');
        // Alice is the seeded ADMIN; excluding her should still leave the
        // `role: 'ADMIN'` filter's result empty, not error.
        double.seedReservation({ parkingSpotId: spotA.id, userId: alice.id, date: '2026-09-15' });

        const listed = await users.adminList({
          role: 'ADMIN',
          excludingReservedOrQueuedFor: { parkingSpotId: spotA.id, date: '2026-09-15' },
        });

        expect(listed).toEqual([]);
      });

      it('leaves the list untouched when no filter is given', async () => {
        const listed = await users.adminList({ active: true });
        expect(listed.map((row) => row.name).sort()).toEqual(['Alice', 'Bob']);
      });
    });
  });

  describe('adminUpdate', () => {
    it('changes the role and records the before and the after', async () => {
      const admin = double.seedUser({ name: 'Admin', role: 'ADMIN' });
      const target = double.seedUser({ name: 'Target' });

      const result = await users.adminUpdate({ id: target.id, role: 'ADMIN' }, admin);

      expect(result.role).toBe('ADMIN');
      expect(double.auditLogs).toEqual([
        expect.objectContaining({
          actorUserId: admin.id,
          action: 'USER_UPDATED',
          entityType: 'User',
          entityId: target.id,
          payload: {
            change: 'admin-updated',
            before: {
              role: 'USER',
              active: true,
              officeId: DEFAULT_OFFICE_ID,
              manualAccount: false,
            },
            after: {
              role: 'ADMIN',
              active: true,
              officeId: DEFAULT_OFFICE_ID,
              manualAccount: false,
            },
          },
        }),
      ]);
    });

    it('offboards by deactivating, never by deleting the row', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });
      const target = double.seedUser();

      await users.adminUpdate({ id: target.id, active: false }, admin);

      expect(double.users).toHaveLength(2);
      expect(double.users.find((row) => row.id === target.id)?.active).toBe(false);
    });

    it('leaves the active flip to the shared deactivation clean-up', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });
      const target = double.seedUser();
      deactivate.mockRejectedValueOnce(new Error('clean-up failed'));

      await expect(users.adminUpdate({ id: target.id, active: false }, admin)).rejects.toThrow(
        'clean-up failed'
      );

      // Still active, so the admin's retry runs the whole deactivation again.
      expect(double.users.find((row) => row.id === target.id)?.active).toBe(true);
    });

    it('runs the shared deactivation clean-up whenever an admin sets inactive, a retry included', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });
      const target = double.seedUser();
      const inactive = double.seedUser({ active: false });

      await users.adminUpdate({ id: target.id, active: false }, admin);
      await users.adminUpdate({ id: inactive.id, active: false }, admin);
      await users.adminUpdate({ id: inactive.id, role: 'USER' }, admin);

      expect(deactivate).toHaveBeenCalledTimes(2);
      expect(deactivate).toHaveBeenNthCalledWith(1, target.id, 'ADMIN', admin.id);
      expect(deactivate).toHaveBeenNthCalledWith(2, inactive.id, 'ADMIN', admin.id);
      expect(double.users.find((row) => row.id === target.id)?.deactivatedAt).toBeInstanceOf(Date);
    });

    it('clears deactivatedAt on reactivation', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });
      const target = double.seedUser({ active: false });
      const row = double.users.find((candidate) => candidate.id === target.id);
      if (row !== undefined) {
        row.deactivatedAt = new Date();
      }

      await users.adminUpdate({ id: target.id, active: true }, admin);

      expect(double.users.find((row) => row.id === target.id)?.deactivatedAt).toBeNull();
      expect(deactivate).not.toHaveBeenCalled();
    });

    it('rejects an unknown user with NOT_FOUND', async () => {
      const admin = double.seedUser({ role: 'ADMIN' });

      await expect(
        users.adminUpdate({ id: '11111111-1111-4111-8111-111111111111', active: false }, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    describe('office and manual account', () => {
      const OTHER_OFFICE = '0190a000-0000-7000-8000-0000000000ff';

      it('moves a user to another office and flags a manual account', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const target = double.seedUser();
        double.otherOfficeIds.push(OTHER_OFFICE);

        await expect(
          users.adminUpdate({ id: target.id, officeId: OTHER_OFFICE, manualAccount: true }, admin)
        ).resolves.toMatchObject({ officeId: OTHER_OFFICE, manualAccount: true });
        expect(double.auditLogs[0]?.payload).toMatchObject({
          before: { officeId: DEFAULT_OFFICE_ID, manualAccount: false },
          after: { officeId: OTHER_OFFICE, manualAccount: true },
        });
      });

      it('drops the preferred desk on an office change, and keeps it otherwise', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const moved = double.seedUser({ preferredDeskId: 'desk-1' });
        const stays = double.seedUser({ preferredDeskId: 'desk-2' });
        double.otherOfficeIds.push(OTHER_OFFICE);

        await users.adminUpdate({ id: moved.id, officeId: OTHER_OFFICE }, admin);
        await users.adminUpdate(
          { id: stays.id, officeId: DEFAULT_OFFICE_ID, role: 'ADMIN' },
          admin
        );

        const preferred = (id: string) =>
          double.users.find((row) => row.id === id)?.preferredDeskId;
        expect(preferred(moved.id)).toBeNull();
        expect(preferred(stays.id)).toBe('desk-2');
      });

      it('clears the office with null', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const target = double.seedUser();

        await expect(
          users.adminUpdate({ id: target.id, officeId: null }, admin)
        ).resolves.toMatchObject({ officeId: null });
      });

      it('refuses an unknown office with NOT_FOUND and changes nothing', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const target = double.seedUser();

        await expect(
          users.adminUpdate({ id: target.id, officeId: OTHER_OFFICE }, admin)
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(double.users.find((row) => row.id === target.id)?.officeId).toBe(DEFAULT_OFFICE_ID);
        expect(double.auditLogs).toHaveLength(0);
      });
    });

    describe('the two ways an admin could lock everybody out', () => {
      it('refuses to demote the last active admin', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN', active: false });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(double.users[0]?.role).toBe('ADMIN');
      });

      it('refuses to deactivate the last active admin', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        const other = double.seedUser({ role: 'ADMIN' });

        // `other` acts, so this is not caught by the self-deactivation rule.
        await users.adminUpdate({ id: admin.id, active: false }, other);
        await expect(
          users.adminUpdate({ id: other.id, active: false }, { id: 'someone-else' })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('refuses an admin deactivating themselves, even with others left', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, active: false }, admin)
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      });

      it('allows demoting yourself while another active admin remains', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });
        double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).resolves.toMatchObject({ role: 'USER' });
      });

      it('writes no audit entry for a refused change', async () => {
        const admin = double.seedUser({ role: 'ADMIN' });

        await expect(
          users.adminUpdate({ id: admin.id, role: 'USER' }, admin)
        ).rejects.toBeDefined();

        expect(double.auditLogs).toHaveLength(0);
      });
    });
  });
});
