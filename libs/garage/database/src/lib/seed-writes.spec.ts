import { SEED_USERS, type SeedUser } from './seed-data';
import { seedUserUpsertArgs } from './seed-writes';

function seedUser(email: string): SeedUser {
  const user = SEED_USERS.find((candidate) => candidate.email === email);
  if (user === undefined) {
    throw new Error(`The seed no longer contains ${email}.`);
  }
  return user;
}

const OFFICE_ID = 'office-id';
const ADMIN = seedUser('admin@example.com');
const INACTIVE = seedUser('inactive@example.com');

describe('seedUserUpsertArgs', () => {
  it('upserts on the email, which is the natural key', () => {
    expect(seedUserUpsertArgs(ADMIN, null, OFFICE_ID).where).toEqual({ email: ADMIN.email });
  });

  it('never writes icsToken in the update branch — a revoked feed URL stays revoked', () => {
    for (const user of SEED_USERS) {
      const { update } = seedUserUpsertArgs(user, null, OFFICE_ID);
      expect(Object.keys(update)).not.toContain('icsToken');
    }
  });

  it('does write one in the create branch, because the column is NOT NULL and unique', () => {
    for (const user of SEED_USERS) {
      const { create } = seedUserUpsertArgs(user, null, OFFICE_ID);
      expect(create.icsToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('mints a different token for every account and every run', () => {
    const tokens = SEED_USERS.flatMap((user) => [
      seedUserUpsertArgs(user, null, OFFICE_ID).create.icsToken,
      seedUserUpsertArgs(user, null, OFFICE_ID).create.icsToken,
    ]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('still asserts role and active on every run — web-e2e depends on it', () => {
    expect(seedUserUpsertArgs(INACTIVE, null, OFFICE_ID).update).toMatchObject({
      role: INACTIVE.role,
      active: false,
    });
  });

  it('carries the resolved preferred spot into both branches', () => {
    const args = seedUserUpsertArgs(ADMIN, 'spot-id', OFFICE_ID);
    expect(args.update.preferredParkingSpotId).toBe('spot-id');
    expect(args.create.preferredParkingSpotId).toBe('spot-id');
  });

  it('puts every seeded account in the given office, on every run', () => {
    const args = seedUserUpsertArgs(ADMIN, null, OFFICE_ID);
    expect(args.update.officeId).toBe(OFFICE_ID);
    expect(args.create.officeId).toBe(OFFICE_ID);
  });
});
