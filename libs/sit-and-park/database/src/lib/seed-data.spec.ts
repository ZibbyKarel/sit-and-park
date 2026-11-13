/**
 * The seed cannot be run without a database, but the data it writes can be
 * checked here: that it is the exact car-park layout the brief prescribes, that
 * every row would satisfy the contract's own schemas, and that nothing in it
 * would violate a unique constraint or a foreign key.
 */

import { parkingSpotSchema, userSchema } from '@sit-and-park/contract';
import {
  DEFAULT_MONTHLY_RESERVATION_CAP,
  DEFAULT_OPEN_DAYS_BEFORE,
  DEFAULT_RESERVATION_LOCK_MODE,
  MAX_MONTHLY_RESERVATION_CAP,
  MAX_OPEN_DAYS_BEFORE,
  MIN_MONTHLY_RESERVATION_CAP,
  MIN_OPEN_DAYS_BEFORE,
} from '@sit-and-park/shared-types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFloorPlan } from './floor-plan';
import {
  SEED_DESK_GRANTS,
  SEED_HIVES,
  SEED_PARKING_SPOTS,
  SEED_PERMANENT_DESKS,
  SEED_RESERVATION_LIMIT_SETTINGS,
  SEED_RESERVATION_WINDOW_SETTINGS,
  SEED_USERS,
} from './seed-data';

/** The contract describes entities as returned; the seed supplies the writable half. */
const seedSpotSchema = parkingSpotSchema.pick({ label: true, group: true, active: true });
const seedUserSchema = userSchema.pick({
  email: true,
  name: true,
  licensePlate: true,
  role: true,
  oktaId: true,
  active: true,
});

describe('seeded parking spots', () => {
  it('is exactly the real office layout', () => {
    expect(SEED_PARKING_SPOTS.map((spot) => spot.label)).toEqual([
      'E2.92',
      'E2.93',
      'E2.94',
      'E2.95',
      'E2.96',
      'E2.65',
      'E2.66',
      'E2.61',
      'E2.62',
    ]);
  });

  it('assigns E2.92–E2.95 to IT and the rest to SHARED', () => {
    const byGroup = (group: string): string[] =>
      SEED_PARKING_SPOTS.filter((spot) => spot.group === group).map((spot) => spot.label);

    expect(byGroup('IT')).toEqual(['E2.92', 'E2.93', 'E2.94', 'E2.95']);
    expect(byGroup('SHARED')).toEqual(['E2.96', 'E2.65', 'E2.66', 'E2.61', 'E2.62']);
  });

  it('every spot satisfies the contract schema', () => {
    for (const spot of SEED_PARKING_SPOTS) {
      expect(() => seedSpotSchema.parse(spot)).not.toThrow();
    }
  });

  it('labels are unique, as the ParkingSpot_label_key index requires', () => {
    const labels = SEED_PARKING_SPOTS.map((spot) => spot.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('seeded users', () => {
  it('every user satisfies the contract schema', () => {
    for (const user of SEED_USERS) {
      expect(() => seedUserSchema.parse(user)).not.toThrow();
    }
  });

  it.each([
    ['email', (): string[] => SEED_USERS.map((user) => user.email)],
    ['oktaId', (): string[] => SEED_USERS.map((user) => user.oktaId)],
  ])('%s is unique across the seed', (_field, values) => {
    const list = values();
    expect(new Set(list).size).toBe(list.length);
  });

  it('every preferred spot exists in the seeded layout', () => {
    const labels = new Set(SEED_PARKING_SPOTS.map((spot) => spot.label));
    for (const user of SEED_USERS) {
      if (user.preferredParkingSpotLabel !== null) {
        expect(labels).toContain(user.preferredParkingSpotLabel);
      }
    }
  });

  it('covers the roles and states dev needs: an admin, an active user, an inactive user', () => {
    expect(SEED_USERS.some((user) => user.role === 'ADMIN' && user.active)).toBe(true);
    expect(SEED_USERS.some((user) => user.role === 'USER' && user.active)).toBe(true);
    expect(SEED_USERS.some((user) => !user.active)).toBe(true);
  });

  it('uses obviously-fake example.com identities', () => {
    for (const user of SEED_USERS) {
      expect(user.email.endsWith('@example.com')).toBe(true);
    }
  });
});

/**
 * The Critical the final review found, and the assertion that keeps it fixed.
 *
 * This file used to check only that the four `icsToken` values were *unique* —
 * which four sequential committed literals are. Uniqueness was never the
 * property at stake: unguessability was. `calendar.controller.ts` is
 * `@Public()` because the token in the path is the whole credential, so any
 * token in the repository is a published one.
 *
 * The source text is read rather than only the exported objects, because the
 * defect is a *committed literal*, and a literal is a fact about the file. An
 * object-only assertion would pass again the moment somebody re-added the field
 * under another name.
 */
describe('no ICS feed token is committed to the repository', () => {
  const source = readFileSync(join(__dirname, 'seed-data.ts'), 'utf8');

  it('declares no icsToken on a seeded account', () => {
    for (const user of SEED_USERS) {
      expect(Object.keys(user)).not.toContain('icsToken');
    }
    expect(source).not.toMatch(/^\s*icsToken\s*[:?]/m);
  });

  it('contains nothing shaped like a feed token', () => {
    // Anything long enough to be a 32-byte secret in any of the encodings this
    // project has used: base64url (43 chars), hex (64), or a UUID.
    const secretShaped = [
      /['"][A-Za-z0-9_-]{32,}['"]/,
      /['"][0-9a-fA-F]{32,}['"]/,
      /['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/i,
    ];
    for (const pattern of secretShaped) {
      expect(source).not.toMatch(pattern);
    }
  });
});

describe('seeded reservation window settings', () => {
  it('is the documented default: 7 days, AUTO', () => {
    expect(SEED_RESERVATION_WINDOW_SETTINGS).toEqual({
      openDaysBefore: DEFAULT_OPEN_DAYS_BEFORE,
      lockMode: DEFAULT_RESERVATION_LOCK_MODE,
    });
    expect(DEFAULT_OPEN_DAYS_BEFORE).toBe(7);
    expect(DEFAULT_RESERVATION_LOCK_MODE).toBe('AUTO');
  });

  it('sits inside the range the CHECK constraint allows', () => {
    expect(SEED_RESERVATION_WINDOW_SETTINGS.openDaysBefore).toBeGreaterThanOrEqual(
      MIN_OPEN_DAYS_BEFORE
    );
    expect(SEED_RESERVATION_WINDOW_SETTINGS.openDaysBefore).toBeLessThanOrEqual(
      MAX_OPEN_DAYS_BEFORE
    );
  });
});

describe('seeded reservation limit settings', () => {
  it('is the documented default cap', () => {
    expect(SEED_RESERVATION_LIMIT_SETTINGS).toEqual({
      monthlyReservationCap: DEFAULT_MONTHLY_RESERVATION_CAP,
    });
    expect(DEFAULT_MONTHLY_RESERVATION_CAP).toBe(5);
  });

  it('sits inside the range the CHECK constraint allows', () => {
    expect(SEED_RESERVATION_LIMIT_SETTINGS.monthlyReservationCap).toBeGreaterThanOrEqual(
      MIN_MONTHLY_RESERVATION_CAP
    );
    expect(SEED_RESERVATION_LIMIT_SETTINGS.monthlyReservationCap).toBeLessThanOrEqual(
      MAX_MONTHLY_RESERVATION_CAP
    );
  });
});

describe('seeded hives, permanent desks and grants', () => {
  const plan = parseFloorPlan(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'apps',
        'sit-and-park',
        'web',
        'public',
        'floorplans',
        'praha.svg'
      ),
      'utf8'
    )
  );
  const zoneOf = new Map(plan.desks.map((desk) => [desk.code, desk.zoneKey]));
  const emails = new Set(SEED_USERS.map((user) => user.email));
  /** `apps/sit-and-park/web-e2e/src/support/personas.ts`. */
  const E2E_PERSONA_EMAILS = ['admin@example.com', 'user@example.com', 'user2@example.com'];

  it('every hive desk exists and lies in the zone the hive names', () => {
    for (const hive of SEED_HIVES) {
      for (const code of hive.deskCodes) {
        expect([code, zoneOf.get(code)]).toEqual([code, hive.zoneKey]);
      }
    }
  });

  it('no desk is in two hives', () => {
    const codes = SEED_HIVES.flatMap((hive) => hive.deskCodes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('a user is in at most one hive, as HiveMembership_userId_key requires', () => {
    const members = SEED_HIVES.flatMap((hive) => hive.memberEmails);
    expect(new Set(members).size).toBe(members.length);
  });

  it('every owner, member, holder and grantee is a seeded user', () => {
    const referenced = [
      ...SEED_HIVES.flatMap((hive) => [hive.ownerEmail, ...hive.memberEmails]),
      ...SEED_PERMANENT_DESKS.map((desk) => desk.userEmail),
      ...SEED_DESK_GRANTS.map((grant) => grant.userEmail),
    ];
    for (const email of referenced) {
      expect(emails).toContain(email);
    }
  });

  it('colours are #RRGGBB, as Hive_color_check requires', () => {
    for (const hive of SEED_HIVES) {
      expect(hive.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('no e2e persona holds a permanent desk — it could book no other desk', () => {
    for (const { userEmail } of SEED_PERMANENT_DESKS) {
      expect(E2E_PERSONA_EMAILS).not.toContain(userEmail);
    }
    const holders = SEED_PERMANENT_DESKS.map((desk) => desk.userEmail);
    expect(new Set(holders).size).toBe(holders.length);
  });

  it('every permanent and granted desk exists on the plan', () => {
    for (const { deskCode } of [...SEED_PERMANENT_DESKS, ...SEED_DESK_GRANTS]) {
      expect(zoneOf.has(deskCode)).toBe(true);
    }
  });
});
