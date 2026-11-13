import type { AdminHive, AdminUser } from '@sit-and-park/contract';
import { addableUsers, hiveOfUser, HEX_COLOR } from './hives-view';

const T = '2026-01-01T00:00:00.000Z';

function hive(id: string, memberIds: string[]): AdminHive {
  return {
    id,
    name: `Hive ${id}`,
    color: '#3366FF',
    ownerId: 'o',
    ownerName: 'Owner',
    createdAt: T,
    updatedAt: T,
    deskCount: 0,
    members: memberIds.map((userId) => ({ userId, name: userId })),
  };
}

function user(id: string, name: string, active = true): AdminUser {
  return {
    id,
    name,
    active,
    email: `${id}@firma.cz`,
    licensePlate: null,
    role: 'USER',
    oktaId: id,
    preferredParkingSpotId: null,
    officeId: null,
    hibobId: null,
    manualAccount: false,
    deactivatedAt: null,
    createdAt: T,
    updatedAt: T,
  };
}

describe('hiveOfUser', () => {
  it('finds the hive a user belongs to, or null', () => {
    const hives = [hive('a', ['u1']), hive('b', ['u2'])];

    expect(hiveOfUser(hives, 'u2')?.id).toBe('b');
    expect(hiveOfUser(hives, 'u3')).toBeNull();
  });
});

describe('addableUsers', () => {
  it('lists active non-members by name, including members of other hives', () => {
    const a = hive('a', ['u1']);
    const users = [
      user('u2', 'Žofie'),
      user('u1', 'Adam'),
      user('u3', 'Bára'),
      user('u4', 'X', false),
    ];

    expect(addableUsers(users, a).map((u) => u.id)).toEqual(['u3', 'u2']);
  });
});

describe('HEX_COLOR', () => {
  it('accepts only #RRGGBB', () => {
    expect(HEX_COLOR.test('#3366ff')).toBe(true);
    expect(HEX_COLOR.test('#36f')).toBe(false);
    expect(HEX_COLOR.test('3366ff')).toBe(false);
  });
});
