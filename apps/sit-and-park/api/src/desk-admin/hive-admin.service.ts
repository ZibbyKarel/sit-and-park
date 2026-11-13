/**
 * `admin.hive.*`. Hives are global; a user is in at most one (the unique on
 * `HiveMembership.userId`). A duplicate name is left to the unique index,
 * which arrives as `CONFLICT` through `toOrpcError`.
 */

import { Injectable } from '@nestjs/common';
import type {
  AdminCreateHiveInput,
  AdminDeleteHiveInput,
  AdminDeleteHiveOutput,
  AdminHiveListOutput,
  AdminSetHiveMembershipInput,
  AdminSetHiveMembershipOutput,
  AdminUpdateHiveInput,
  Hive,
} from '@sit-and-park/contract';
import type { Hive as HiveRow, Prisma } from '@sit-and-park/database';
import { AuditLogService } from '../audit/audit-log.service';
import { DomainError } from '../common/errors/domain-error';
import { toTimestamp } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import { DeskCleanupService } from '../desks/desk-cleanup.service';
import { lockDesks } from '../desks/desk-db';
import { RESERVATION_TRANSACTION_OPTIONS } from '../reservations/transaction-options';

export function toContractHive(row: HiveRow): Hive {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ownerId: row.ownerId,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

function auditFields(row: HiveRow) {
  return { name: row.name, color: row.color, ownerId: row.ownerId };
}

@Injectable()
export class HiveAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly cleanup: DeskCleanupService
  ) {}

  async list(): Promise<AdminHiveListOutput> {
    const rows = await this.prisma.client.hive.findMany({
      orderBy: { name: 'asc' },
      include: {
        owner: { select: { name: true } },
        memberships: { select: { user: { select: { id: true, name: true } } } },
        _count: { select: { desks: true } },
      },
    });
    return {
      hives: rows.map((row) => ({
        ...toContractHive(row),
        ownerName: row.owner.name,
        members: row.memberships
          .map(({ user }) => ({ userId: user.id, name: user.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        deskCount: row._count.desks,
      })),
    };
  }

  async create(input: AdminCreateHiveInput, actorUserId: string): Promise<Hive> {
    await this.requireOwner(input.ownerId);
    const row = await this.prisma.client.hive.create({ data: input });
    await this.audit.record({
      actorUserId,
      action: 'HIVE_UPDATED',
      entityType: 'Hive',
      entityId: row.id,
      payload: { before: null, after: auditFields(row) },
    });
    return toContractHive(row);
  }

  async update(input: AdminUpdateHiveInput, actorUserId: string): Promise<Hive> {
    const { hiveId, ...changes } = input;
    const before = await this.requireHive(this.prisma.client, hiveId);
    if (changes.ownerId !== undefined) {
      await this.requireOwner(changes.ownerId);
    }
    const data: Prisma.HiveUncheckedUpdateInput = {
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.color === undefined ? {} : { color: changes.color }),
      ...(changes.ownerId === undefined ? {} : { ownerId: changes.ownerId }),
    };
    const row = await this.prisma.client.hive.update({ where: { id: hiveId }, data });
    await this.audit.record({
      actorUserId,
      action: 'HIVE_UPDATED',
      entityType: 'Hive',
      entityId: row.id,
      payload: { before: auditFields(before), after: auditFields(row) },
    });
    return toContractHive(row);
  }

  /**
   * Rejects the pending requests of the hive's desks (they were addressed to
   * its owner, who no longer decides them; reason `HIVE_DELETED`), then
   * deletes it: its desks' `hiveId` is set to null by the foreign key (they
   * become open to their office) and its memberships cascade. Reservations
   * stay — they were made with access. The hive's desks are locked first
   * (ascending, like a bulk edit), so a request filed on one of them either
   * committed before (and is rejected here) or waits and finds no hive.
   */
  async delete(input: AdminDeleteHiveInput, actorUserId: string): Promise<AdminDeleteHiveOutput> {
    await this.prisma.client.$transaction(async (tx) => {
      const before = await this.requireHive(tx, input.hiveId);
      const desks = await tx.desk.findMany({
        where: { hiveId: input.hiveId },
        select: { id: true },
      });
      await lockDesks(
        tx,
        desks.map((desk) => desk.id)
      );
      await this.cleanup.rejectPendingRequests(
        tx,
        { desk: { hiveId: input.hiveId } },
        'HIVE_DELETED',
        actorUserId
      );
      await tx.hive.delete({ where: { id: input.hiveId } });
      await this.audit.record(
        {
          actorUserId,
          action: 'HIVE_UPDATED',
          entityType: 'Hive',
          entityId: before.id,
          payload: { before: auditFields(before), after: null },
        },
        tx
      );
    }, RESERVATION_TRANSACTION_OPTIONS);
    return { hiveId: input.hiveId };
  }

  /**
   * `member: true` moves the user into this hive out of any other (an upsert
   * on the unique `userId`); `member: false` removes them from this hive only.
   * Unaudited: `HIVE_UPDATED` records the hive's own fields, not its roster.
   */
  async setMembership(input: AdminSetHiveMembershipInput): Promise<AdminSetHiveMembershipOutput> {
    await this.requireHive(this.prisma.client, input.hiveId);
    const user = await this.prisma.client.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (user === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }
    if (input.member) {
      await this.prisma.client.hiveMembership.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, hiveId: input.hiveId },
        update: { hiveId: input.hiveId },
      });
      return { userId: input.userId, hiveId: input.hiveId };
    }
    await this.prisma.client.hiveMembership.deleteMany({
      where: { userId: input.userId, hiveId: input.hiveId },
    });
    const left = await this.prisma.client.hiveMembership.findUnique({
      where: { userId: input.userId },
      select: { hiveId: true },
    });
    return { userId: input.userId, hiveId: left?.hiveId ?? null };
  }

  /** The owner must exist (`NOT_FOUND`) and be active (`VALIDATION_FAILED`). */
  private async requireOwner(ownerId: string): Promise<void> {
    const owner = await this.prisma.client.user.findUnique({
      where: { id: ownerId },
      select: { active: true },
    });
    if (owner === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such user.' });
    }
    if (!owner.active) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'A hive owner must be an active user.',
        details: { ownerId },
      });
    }
  }

  private async requireHive(client: Prisma.TransactionClient, hiveId: string): Promise<HiveRow> {
    const hive = await client.hive.findUnique({ where: { id: hiveId } });
    if (hive === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such hive.' });
    }
    return hive;
  }
}
