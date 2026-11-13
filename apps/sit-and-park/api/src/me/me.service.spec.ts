import { Prisma } from '@sit-and-park/database';
import { PrismaDouble } from '../testing/prisma-double';
import { AuditLogService } from '../audit/audit-log.service';
import { MAX_ICS_TOKEN_ATTEMPTS, MeService } from './me.service';

describe('MeService', () => {
  let double: PrismaDouble;
  let me: MeService;

  beforeEach(() => {
    double = new PrismaDouble();
    me = new MeService(double.asPrismaService(), new AuditLogService(double.asPrismaService()));
  });

  describe('getProfile', () => {
    it('includes the caller’s own ICS token — the settings screen renders the feed URL', async () => {
      const user = double.seedUser({ icsToken: 'secret-token' });

      await expect(me.getProfile(user.id)).resolves.toMatchObject({ icsToken: 'secret-token' });
    });

    it('reports no hive, no permanent desk and no ownership for a plain user', async () => {
      const user = double.seedUser({});

      await expect(me.getProfile(user.id)).resolves.toMatchObject({
        hiveId: null,
        permanentDeskId: null,
        ownsHive: false,
      });
    });

    it('derives hiveId, permanentDeskId and ownsHive from the desk tables', async () => {
      const user = double.seedUser({});
      double.hiveMemberships.push({ userId: user.id, hiveId: 'hive-1' });
      double.desks.push({ id: 'desk-1', permanentAssigneeId: user.id });
      double.hives.push({ id: 'hive-1', ownerId: user.id });

      await expect(me.getProfile(user.id)).resolves.toMatchObject({
        hiveId: 'hive-1',
        permanentDeskId: 'desk-1',
        ownsHive: true,
      });
    });
  });

  describe('updateSettings — the three-valued convention', () => {
    it('leaves a field alone when it is absent', async () => {
      const user = double.seedUser({ licensePlate: '1AB 2345' });

      const result = await me.updateSettings({}, user.id);

      expect(result.licensePlate).toBe('1AB 2345');
    });

    it('clears a field when it is explicitly null', async () => {
      const user = double.seedUser({ licensePlate: '1AB 2345' });

      const result = await me.updateSettings({ licensePlate: null }, user.id);

      expect(result.licensePlate).toBeNull();
    });

    it('sets a field when it carries a value', async () => {
      const user = double.seedUser();

      const result = await me.updateSettings({ licensePlate: '5CD 6789' }, user.id);

      expect(result.licensePlate).toBe('5CD 6789');
    });

    it('clears the preferred spot on null and sets it on an id', async () => {
      const spot = double.seedSpot({ label: 'A1' });
      const user = double.seedUser({ preferredParkingSpotId: spot.id });

      await expect(
        me.updateSettings({ preferredParkingSpotId: null }, user.id)
      ).resolves.toMatchObject({ preferredParkingSpotId: null });
      await expect(
        me.updateSettings({ preferredParkingSpotId: spot.id }, user.id)
      ).resolves.toMatchObject({ preferredParkingSpotId: spot.id });
    });

    it('rejects a preferred spot that does not exist with NOT_FOUND', async () => {
      const user = double.seedUser();

      await expect(
        me.updateSettings(
          { preferredParkingSpotId: '11111111-1111-4111-8111-111111111111' },
          user.id
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a hidden spot as the preferred spot with NOT_FOUND — bulk would never assign it', async () => {
      const spot = double.seedSpot({ label: 'A1', hidden: true });
      const user = double.seedUser();

      await expect(
        me.updateSettings({ preferredParkingSpotId: spot.id }, user.id)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a retired spot with VALIDATION_FAILED — a different situation for the user', async () => {
      const spot = double.seedSpot({ label: 'A1', active: false });
      const user = double.seedUser();

      await expect(
        me.updateSettings({ preferredParkingSpotId: spot.id }, user.id)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { parkingSpotId: spot.id } });
    });

    it('sets the preferred desk on an id, keeps it when absent and clears it on null', async () => {
      const user = double.seedUser();
      double.desks.push({ id: 'desk-1', permanentAssigneeId: null });

      await expect(
        me.updateSettings({ preferredDeskId: 'desk-1' }, user.id)
      ).resolves.toMatchObject({ preferredDeskId: 'desk-1' });
      await expect(me.updateSettings({}, user.id)).resolves.toMatchObject({
        preferredDeskId: 'desk-1',
      });
      await expect(me.updateSettings({ preferredDeskId: null }, user.id)).resolves.toMatchObject({
        preferredDeskId: null,
      });
    });

    it('rejects a preferred desk that does not exist with NOT_FOUND', async () => {
      const user = double.seedUser();

      await expect(
        me.updateSettings({ preferredDeskId: '11111111-1111-4111-8111-111111111111' }, user.id)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects an inactive desk or one of another office with VALIDATION_FAILED', async () => {
      const user = double.seedUser();
      double.desks.push(
        { id: 'desk-off', permanentAssigneeId: null, active: false },
        { id: 'desk-far', permanentAssigneeId: null, officeId: 'office-other' }
      );

      await expect(
        me.updateSettings({ preferredDeskId: 'desk-off' }, user.id)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        me.updateSettings({ preferredDeskId: 'desk-far' }, user.id)
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('writes an audit entry with the before and the after', async () => {
      const user = double.seedUser({ licensePlate: null });

      await me.updateSettings({ licensePlate: '5CD 6789' }, user.id);

      expect(double.auditLogs).toEqual([
        expect.objectContaining({
          actorUserId: user.id,
          action: 'USER_UPDATED',
          entityId: user.id,
          payload: {
            change: 'settings',
            before: { licensePlate: null, preferredParkingSpotId: null, preferredDeskId: null },
            after: {
              licensePlate: '5CD 6789',
              preferredParkingSpotId: null,
              preferredDeskId: null,
            },
          },
        }),
      ]);
    });
  });

  describe('regenerateIcsToken', () => {
    it('issues a new token and invalidates the old one', async () => {
      const user = double.seedUser({ icsToken: 'old-token' });

      const issued = await me.regenerateIcsToken(user.id);

      expect(issued).not.toBe('old-token');
      expect(double.users[0]?.icsToken).toBe(issued);
    });

    it('never puts the token into the audit log', async () => {
      const user = double.seedUser();

      const issued = await me.regenerateIcsToken(user.id);

      expect(JSON.stringify(double.auditLogs)).not.toContain(issued);
      expect(double.auditLogs[0]?.payload).toMatchObject({ change: 'ics-token-regenerated' });
    });

    it('retries past a token collision instead of surfacing an error the UI has no copy for', async () => {
      // The contract declares no error on this procedure (`doc/decision/0021-*`),
      // so a P2002 on the random token has to be resolved here rather than
      // reported. The collision is induced at the unique index — the layer that
      // would really detect it — because a 32-byte random value cannot be made
      // to collide from the outside.
      const user = double.seedUser({ icsToken: 'old-token' });
      double.icsTokenCollisions = 1;

      const issued = await me.regenerateIcsToken(user.id);

      expect(issued).not.toBe('old-token');
      expect(double.auditLogs[0]?.payload).toMatchObject({ attempt: 2 });
    });

    it('gives up after the bounded number of attempts rather than looping forever', async () => {
      const user = double.seedUser();
      double.icsTokenCollisions = MAX_ICS_TOKEN_ATTEMPTS;

      await expect(me.regenerateIcsToken(user.id)).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError
      );
      expect(double.auditLogs).toHaveLength(0);
    });
  });
});
