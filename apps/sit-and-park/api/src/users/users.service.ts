/**
 * Admin user management: list, change role, offboard.
 *
 * Users are never created here — they are provisioned from the Okta token on
 * first sign-in (`apps/sit-and-park/api/src/auth/auth-user.service.ts`) — and never deleted,
 * because `Reservation`, `WaitlistEntry` and `AuditLog` all reference them with
 * `ON DELETE RESTRICT`. Offboarding is `active: false`, and a deactivated user
 * is refused at the guard with `FORBIDDEN` on their next request.
 *
 * ## The two ways an admin can lock everybody out
 *
 * Both are refused here, because neither is recoverable through the API once it
 * has happened — there is no sign-up, no role bootstrap endpoint, and no way to
 * promote anybody without already being an admin. Somebody would have to go into
 * the database by hand.
 *
 * 1. **Removing the last active admin**, by demotion or by deactivation.
 * 2. **Deactivating yourself.** Refused even when other admins remain: the
 *    intent is almost always a mis-click on the wrong row, and the cost of
 *    being wrong is losing your own session mid-task. Another admin can still
 *    do it, which is the correct shape for an offboarding anyway.
 *
 * Demoting *yourself* while another admin exists is allowed — that is a
 * deliberate step down, and rule 1 already covers the dangerous version of it.
 */

import { Injectable } from '@nestjs/common';
import type { AdminListUsersInput, AdminUpdateUserInput, AdminUser } from '@sit-and-park/contract';
import type { Prisma } from '@sit-and-park/database';
import { AuditLogService } from '../audit/audit-log.service';
import { DomainError } from '../common/errors/domain-error';
import { toAdminUser, toDateColumn } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import { UserDeactivationService } from '../employee-sync/user-deactivation.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly deactivation: UserDeactivationService
  ) {}

  /**
   * The admin table.
   *
   * `search` matches name **or** email, case-insensitively. The contract leaves
   * "the backend decides how" open; a substring match on the two fields an admin
   * can actually see is the behaviour a search box implies, and anything cleverer
   * (prefix-only, trigram) would be a surprise rather than a feature.
   */
  async adminList(input: AdminListUsersInput): Promise<AdminUser[]> {
    const where: Prisma.UserWhereInput = {
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.search === undefined
        ? {}
        : {
            OR: [
              { name: { contains: input.search, mode: 'insensitive' } },
              { email: { contains: input.search, mode: 'insensitive' } },
            ],
          }),
    };

    const rows = await this.prisma.client.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    const excludedIds = await this.excludedForQueueTarget(input.excludingReservedOrQueuedFor);
    const filtered = excludedIds === null ? rows : rows.filter((row) => !excludedIds.has(row.id));

    return filtered.map(toAdminUser);
  }

  /**
   * Who to leave out of the admin's "add to queue" picker: everyone who
   * already holds *a* reservation this day — `Reservation(userId, date)` is
   * unique, so one is already the ceiling — and everyone already queued for
   * *this* spot this day (`WaitlistEntry(parkingSpotId, userId, date)`).
   * Mirrors, ahead of time, the refusals `WaitlistService.joinOnce` would
   * otherwise only report after submission (`RESERVATION_LIMIT_REACHED`,
   * `ALREADY_IN_WAITLIST`).
   *
   * `null` when the caller passed no target — the ordinary, unfiltered list.
   */
  private async excludedForQueueTarget(
    target: AdminListUsersInput['excludingReservedOrQueuedFor']
  ): Promise<Set<string> | null> {
    if (target === undefined) {
      return null;
    }

    const date = toDateColumn(target.date);
    const [reservations, waitlistEntries] = await Promise.all([
      this.prisma.client.reservation.findMany({ where: { date } }),
      this.prisma.client.waitlistEntry.findMany({ where: { date } }),
    ]);

    const excluded = new Set<string>();
    for (const reservation of reservations) {
      if (reservation.userId !== null) {
        excluded.add(reservation.userId);
      }
    }
    for (const entry of waitlistEntries) {
      if (entry.parkingSpotId === target.parkingSpotId) {
        excluded.add(entry.userId);
      }
    }
    return excluded;
  }

  /** Changes a user's role, activity, office and/or manual-account flag. See the two rules above. */
  async adminUpdate(input: AdminUpdateUserInput, actor: { id: string }): Promise<AdminUser> {
    const { id, ...changes } = input;

    const existing = await this.prisma.client.user.findUnique({ where: { id } });
    if (existing === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }

    if (changes.active === false && id === actor.id) {
      throw new DomainError('CONFLICT', {
        message: 'An admin cannot deactivate their own account.',
      });
    }

    const nextRole = changes.role ?? existing.role;
    const nextActive = changes.active ?? existing.active;
    const wasActiveAdmin = existing.role === 'ADMIN' && existing.active;
    const staysActiveAdmin = nextRole === 'ADMIN' && nextActive;

    if (wasActiveAdmin && !staysActiveAdmin) {
      await this.requireAnotherActiveAdmin(id);
    }

    // Changing the office touches no existing reservation, parking or desk:
    // they were valid bookings when made. It only decides what the user sees
    // and books from now on (`../common/office-scope.ts`).
    if (changes.officeId !== undefined && changes.officeId !== null) {
      const office = await this.prisma.client.office.findUnique({
        where: { id: changes.officeId },
        select: { id: true },
      });
      if (office === null) {
        throw new DomainError('NOT_FOUND', { message: 'No such office.' });
      }
    }

    // `active: false` is not written here: `deactivate` flips it in the same
    // transaction as the clean-up, so a failed clean-up leaves the user active
    // and a retry of the same request starts over.
    const data: Prisma.UserUncheckedUpdateInput = {
      ...(changes.role === undefined ? {} : { role: changes.role }),
      ...(changes.active === true ? { active: true } : {}),
      ...(changes.active === true && !existing.active ? { deactivatedAt: null } : {}),
      ...(changes.officeId === undefined ? {} : { officeId: changes.officeId }),
      ...(changes.manualAccount === undefined ? {} : { manualAccount: changes.manualAccount }),
    };
    await this.prisma.client.user.update({ where: { id }, data });

    // Offboarding has side effects beyond the flag (decision 0329): future
    // desk and parking reservations, waitlist entries and pending requests.
    // The same path the employee sync uses. Also run for a user who is
    // already inactive: it finishes a clean-up an earlier attempt left
    // incomplete, and audits nothing new.
    if (changes.active === false) {
      await this.deactivation.deactivate(id, 'ADMIN', actor.id);
    }
    const row = await this.prisma.client.user.findUnique({ where: { id } });
    if (row === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }

    // The `payload` shape is fixed per action by `../audit/audit-payloads.ts`.
    await this.audit.record({
      actorUserId: actor.id,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: row.id,
      payload: {
        change: 'admin-updated',
        before: {
          role: existing.role,
          active: existing.active,
          officeId: existing.officeId,
          manualAccount: existing.manualAccount,
        },
        after: {
          role: row.role,
          active: row.active,
          officeId: row.officeId,
          manualAccount: row.manualAccount,
        },
      },
    });

    return toAdminUser(row);
  }

  /**
   * Refuses when `excludedUserId` is the only active admin left.
   *
   * A read-then-write race here would need two admins demoting each other in the
   * same instant; the outcome would be zero admins, which the count cannot see.
   * That is accepted rather than locked: this deployment is single-instance with
   * a handful of admins, and the alternative (serialising every role change) buys
   * nothing against a scenario nobody has ever hit. Recorded in the task doc, not
   * hidden.
   *
   * **What it costs if it ever happens.** There is no way back through the API —
   * every route that could restore an admin is itself admin-only, and users are
   * provisioned from Okta as `USER`. Recovery requires **direct database
   * access**: `UPDATE "User" SET role = 'ADMIN', active = true WHERE email =
   * '…';`. Anyone weighing this trade-off later should weigh that, not just the
   * probability.
   */
  private async requireAnotherActiveAdmin(excludedUserId: string): Promise<void> {
    const remaining = await this.prisma.client.user.count({
      where: { role: 'ADMIN', active: true, id: { not: excludedUserId } },
    });

    if (remaining === 0) {
      throw new DomainError('CONFLICT', {
        message: 'The last active administrator cannot be demoted or deactivated.',
      });
    }
  }
}
