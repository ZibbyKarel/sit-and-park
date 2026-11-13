/** `admin.employeeSync.*`: the sync's live/dry switch and its run log. Both `@Roles('ADMIN')`. */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Roles } from '../auth/roles.decorator';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
import { EmployeeSyncService } from './employee-sync.service';

@Controller(RPC_ROUTE_PREFIX)
export class EmployeeSyncAdminController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    sync: EmployeeSyncService,
    @InjectPinoLogger(EmployeeSyncAdminController.name) logger: PinoLogger
  ) {
    this.rpc = new RpcRouteHandler(
      {
        admin: {
          employeeSync: {
            get: implementer.admin.employeeSync.get.handler(() => sync.adminGet()),
            setLiveMode: implementer.admin.employeeSync.setLiveMode.handler(({ input, context }) =>
              sync.setLiveMode(input, context.user.id)
            ),
          },
        },
      },
      logger
    );
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'employeeSync', 'get')
  get(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @Roles('ADMIN')
  @RpcRoute('admin', 'employeeSync', 'setLiveMode')
  setLiveMode(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
