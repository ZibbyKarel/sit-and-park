/**
 * The caller-facing `desk.*` procedures, one Nest route each. None carries
 * `@Roles()`: who may cancel, decide or withdraw what is a rule about a row,
 * and lives in the services next to the row — including the admin exemptions
 * and the hive owner's inbox (`desk.pendingRequests` is not under `admin`,
 * because a hive owner need not be an admin).
 */

import { Controller } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { implementer } from '../orpc/implementer';
import { RpcRouteHandler } from '../orpc/rpc-route-handler';
import { RPC_ROUTE_PREFIX } from '../orpc/rpc-route';
import { RpcRoute } from '../orpc/rpc-route.decorator';
import { DeskRequestsService } from './desk-requests.service';
import { DesksService } from './desks.service';

@Controller(RPC_ROUTE_PREFIX)
export class DesksController {
  private readonly rpc: RpcRouteHandler;

  constructor(
    desks: DesksService,
    requests: DeskRequestsService,
    @InjectPinoLogger(DesksController.name) logger: PinoLogger
  ) {
    const desk = implementer.desk;
    this.rpc = new RpcRouteHandler(
      {
        desk: {
          directory: desk.directory.handler(({ input, context }) =>
            desks.directory(input, context.user)
          ),
          previewSeries: desk.previewSeries.handler(({ input, context }) =>
            desks.previewSeries(input, context.user)
          ),
          reserve: desk.reserve.handler(({ input, context }) => desks.reserve(input, context.user)),
          cancel: desk.cancel.handler(({ input, context }) => desks.cancel(input, context.user)),
          myReservations: desk.myReservations.handler(({ context }) =>
            desks.myReservations(context.user)
          ),
          requestApproval: desk.requestApproval.handler(({ input, context }) =>
            requests.requestApproval(input, context.user)
          ),
          cancelRequest: desk.cancelRequest.handler(({ input, context }) =>
            requests.cancelRequest(input, context.user)
          ),
          myRequests: desk.myRequests.handler(({ context }) => requests.myRequests(context.user)),
          pendingRequests: desk.pendingRequests.handler(({ context }) =>
            requests.pendingRequests(context.user)
          ),
          decideRequest: desk.decideRequest.handler(({ input, context }) =>
            requests.decideRequest(input, context.user)
          ),
          myReleases: desk.myReleases.handler(({ context }) => desks.myReleases(context.user)),
          release: desk.release.handler(({ input, context }) => desks.release(input, context.user)),
          cancelRelease: desk.cancelRelease.handler(({ input, context }) =>
            desks.cancelRelease(input, context.user)
          ),
        },
      },
      logger
    );
  }

  @RpcRoute('desk', 'directory')
  directory(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'previewSeries')
  previewSeries(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'reserve')
  reserve(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'cancel')
  cancel(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'myReservations')
  myReservations(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'requestApproval')
  requestApproval(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'cancelRequest')
  cancelRequest(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'myRequests')
  myRequests(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'pendingRequests')
  pendingRequests(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'decideRequest')
  decideRequest(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'myReleases')
  myReleases(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'release')
  release(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }

  @RpcRoute('desk', 'cancelRelease')
  cancelRelease(): Promise<void> {
    throw new Error('replaced by @RpcRoute');
  }
}
