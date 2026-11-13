/**
 * What the hives screen decides, as pure functions: which hive a user is in
 * today and who can be offered as a new member.
 */

import type { AdminHive, AdminUser } from '@sit-and-park/contract';

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;

/** The hive `userId` is a member of, or `null`. A user is in at most one. */
export function hiveOfUser(hives: readonly AdminHive[], userId: string): AdminHive | null {
  return hives.find((hive) => hive.members.some((member) => member.userId === userId)) ?? null;
}

/**
 * Active users who are not yet in `hive`, by name. Users of another hive are
 * included on purpose: adding one moves them, and the screen says so.
 */
export function addableUsers(users: readonly AdminUser[], hive: AdminHive): AdminUser[] {
  const inHive = new Set(hive.members.map((member) => member.userId));
  return users
    .filter((user) => user.active && !inHive.has(user.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ'));
}
