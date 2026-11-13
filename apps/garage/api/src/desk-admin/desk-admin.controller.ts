/**
 * The admin desk, hive, office and zone procedures, each on its own Nest route
 * with `@Roles('ADMIN')` (see `spots.controller.ts` for the pattern and
 * `rpc-route-handler.ts` for why the transport is mounted per procedure).
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
import { DeskAdminService } from './desk-admin.service';
import { HiveAdminService } from './hive-admin.service';
import { OfficeAdminService } from './office-admin.service';

@Controller(RPC_ROUTE_PREFIX)
export class DeskAdminController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    deskAdmin: DeskAdminService,
    hives: HiveAdminService,
    offices: OfficeAdminService,
    @InjectPinoLogger(DeskAdminController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        admin: {
          desk: {
            list: implementer.admin.desk.list.handler(({ input }) => deskAdmin.list(input)),
            update: implementer.admin.desk.update.handler(({ input, context }) =>
              deskAdmin.update(input, context.user.id)
            ),
            bulkUpdate: implementer.admin.desk.bulkUpdate.handler(({ input, context }) =>
              deskAdmin.bulkUpdate(input, context.user.id)
            ),
            setPermanentAssignee: implementer.admin.desk.setPermanentAssignee.handler(
              ({ input, context }) => deskAdmin.setPermanentAssignee(input, context.user.id)
            ),
            grants: implementer.admin.desk.grants.handler(({ input }) => deskAdmin.grants(input)),
            setGrant: implementer.admin.desk.setGrant.handler(({ input }) =>
              deskAdmin.setGrant(input)
            ),
            stats: implementer.admin.desk.stats.handler(({ input }) => deskAdmin.stats(input)),
          },
          hive: {
            list: implementer.admin.hive.list.handler(() => hives.list()),
            create: implementer.admin.hive.create.handler(({ input, context }) =>
              hives.create(input, context.user.id)
            ),
            update: implementer.admin.hive.update.handler(({ input, context }) =>
              hives.update(input, context.user.id)
            ),
            delete: implementer.admin.hive.delete.handler(({ input, context }) =>
              hives.delete(input, context.user.id)
            ),
            setMembership: implementer.admin.hive.setMembership.handler(({ input }) =>
              hives.setMembership(input)
            ),
          },
          office: {
            list: implementer.admin.office.list.handler(() => offices.listOffices()),
            create: implementer.admin.office.create.handler(({ input, context }) =>
              offices.createOffice(input, context.user.id)
            ),
            update: implementer.admin.office.update.handler(({ input, context }) =>
              offices.updateOffice(input, context.user.id)
            ),
          },
          zone: {
            list: implementer.admin.zone.list.handler(({ input }) => offices.listZones(input)),
            create: implementer.admin.zone.create.handler(({ input, context }) =>
              offices.createZone(input, context.user.id)
            ),
            update: implementer.admin.zone.update.handler(({ input, context }) =>
              offices.updateZone(input, context.user.id)
            ),
          },
        },
      },
      logger
    );
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'list')
  listDesks(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'update')
  updateDesk(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'bulkUpdate')
  bulkUpdateDesks(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'setPermanentAssignee')
  setPermanentAssignee(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'grants')
  deskGrants(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'setGrant')
  setDeskGrant(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'desk', 'stats')
  deskStats(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'hive', 'list')
  listHives(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'hive', 'create')
  createHive(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'hive', 'update')
  updateHive(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'hive', 'delete')
  deleteHive(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'hive', 'setMembership')
  setHiveMembership(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'office', 'list')
  listOffices(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'office', 'create')
  createOffice(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'office', 'update')
  updateOffice(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'zone', 'list')
  listZones(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'zone', 'create')
  createZone(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'zone', 'update')
  updateZone(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
