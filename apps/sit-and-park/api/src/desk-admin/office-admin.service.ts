/**
 * `admin.office.*` and `admin.zone.*`. Duplicate office names and zone keys
 * (per office) are left to the unique indexes, which arrive as `CONFLICT`
 * through `toOrpcError`.
 *
 * Deactivating an office cascades to nothing: its users, desks and spots stay
 * as they are, and its users keep booking there. `active` only decides whether
 * it can be the default office of a new user or spot (the oldest active one,
 * `../common/office-scope.ts`) — the source app's rule too.
 */

import { Injectable } from '@nestjs/common';
import type {
  AdminCreateOfficeInput,
  AdminCreateZoneInput,
  AdminOfficeListOutput,
  AdminUpdateOfficeInput,
  AdminUpdateZoneInput,
  AdminZoneListInput,
  AdminZoneListOutput,
  Office,
  Zone,
} from '@sit-and-park/contract';
import type { Office as OfficeRow, Prisma, Zone as ZoneRow } from '@sit-and-park/database';
import { AuditLogService } from '../audit/audit-log.service';
import { DomainError } from '../common/errors/domain-error';
import { toTimestamp } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';

export function toContractOffice(row: OfficeRow): Office {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    // A free-text column naming a bundled plan; the output schema's enum is
    // what refuses a value nobody bundled.
    floorPlan: row.floorPlan as Office['floorPlan'],
    floorPlanWidth: row.floorPlanWidth,
    floorPlanHeight: row.floorPlanHeight,
    createdAt: toTimestamp(row.createdAt),
    updatedAt: toTimestamp(row.updatedAt),
  };
}

export function toContractZone(row: ZoneRow): Zone {
  return { id: row.id, officeId: row.officeId, key: row.key, name: row.name };
}

@Injectable()
export class OfficeAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService
  ) {}

  async listOffices(): Promise<AdminOfficeListOutput> {
    const rows = await this.prisma.client.office.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { desks: true, parkingSpots: true, users: true } } },
    });
    return {
      offices: rows.map((row) => ({
        ...toContractOffice(row),
        deskCount: row._count.desks,
        spotCount: row._count.parkingSpots,
        userCount: row._count.users,
      })),
    };
  }

  async createOffice(input: AdminCreateOfficeInput, actorUserId: string): Promise<Office> {
    const row = await this.prisma.client.office.create({ data: input });
    await this.recordOffice(null, row, actorUserId);
    return toContractOffice(row);
  }

  async updateOffice(input: AdminUpdateOfficeInput, actorUserId: string): Promise<Office> {
    const { officeId, ...changes } = input;
    const before = await this.prisma.client.office.findUnique({ where: { id: officeId } });
    if (before === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such office.' });
    }
    const data: Prisma.OfficeUpdateInput = {
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.active === undefined ? {} : { active: changes.active }),
    };
    const row = await this.prisma.client.office.update({ where: { id: officeId }, data });
    await this.recordOffice(before, row, actorUserId);
    return toContractOffice(row);
  }

  async listZones(input: AdminZoneListInput): Promise<AdminZoneListOutput> {
    const rows = await this.prisma.client.zone.findMany({
      where: { officeId: input.officeId },
      orderBy: { name: 'asc' },
    });
    return { zones: rows.map(toContractZone) };
  }

  async createZone(input: AdminCreateZoneInput, actorUserId: string): Promise<Zone> {
    const office = await this.prisma.client.office.findUnique({
      where: { id: input.officeId },
      select: { id: true },
    });
    if (office === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such office.' });
    }
    const row = await this.prisma.client.zone.create({ data: input });
    await this.recordZone(null, row, actorUserId);
    return toContractZone(row);
  }

  async updateZone(input: AdminUpdateZoneInput, actorUserId: string): Promise<Zone> {
    const before = await this.prisma.client.zone.findUnique({ where: { id: input.zoneId } });
    if (before === null) {
      throw new DomainError('NOT_FOUND', { message: 'No such zone.' });
    }
    const row = await this.prisma.client.zone.update({
      where: { id: input.zoneId },
      data: { name: input.name },
    });
    await this.recordZone(before, row, actorUserId);
    return toContractZone(row);
  }

  private async recordOffice(
    before: OfficeRow | null,
    after: OfficeRow,
    actorUserId: string
  ): Promise<void> {
    const fields = (row: OfficeRow) => ({ name: row.name, active: row.active });
    await this.audit.record({
      actorUserId,
      action: 'OFFICE_UPDATED',
      entityType: 'Office',
      entityId: after.id,
      payload: { before: before === null ? null : fields(before), after: fields(after) },
    });
  }

  private async recordZone(
    before: ZoneRow | null,
    after: ZoneRow,
    actorUserId: string
  ): Promise<void> {
    const fields = (row: ZoneRow) => ({ key: row.key, name: row.name, officeId: row.officeId });
    await this.audit.record({
      actorUserId,
      action: 'ZONE_UPDATED',
      entityType: 'Zone',
      entityId: after.id,
      payload: { before: before === null ? null : fields(before), after: fields(after) },
    });
  }
}
