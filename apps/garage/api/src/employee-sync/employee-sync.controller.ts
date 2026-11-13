/**
 * `POST /api/employee-sync` — the HiBob employee list, pushed by Keboola.
 *
 * Outside oRPC, like the ICS feed (`calendar/calendar.controller.ts`): the
 * caller is a data pipeline with a bearer key, not a signed-in browser, so
 * `@Public()` opts out of the Okta guard and the key check below replaces it.
 * `@StrictThrottle()` because it is reachable by anyone. The path and the
 * request/response shapes come from `@garage/contract`; the body limit for this
 * path alone is raised in `configure-app.ts`. See `doc/employee-sync.md`.
 *
 * Neither the key nor the `Authorization` header is logged
 * (`logging/logger.options.ts` redacts the header).
 */

import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { EmployeeSyncRefusal, EmployeeSyncResponse } from '@garage/contract';
import { EMPLOYEE_SYNC_PATH } from '@garage/contract';
import { Public } from '../auth/public.decorator';
import { StrictThrottle } from '../common/throttling/throttle-tiers';
import { GLOBAL_PREFIX } from '../configure-app';
import { isValidEmployeeSyncKey } from './employee-sync-key';
import { EmployeeSyncService } from './employee-sync.service';

/** {@link EMPLOYEE_SYNC_PATH} without the global prefix `configureApp` adds back. */
export const EMPLOYEE_SYNC_ROUTE = EMPLOYEE_SYNC_PATH.slice(`/${GLOBAL_PREFIX}/`.length);

@Public()
@StrictThrottle()
@Controller(EMPLOYEE_SYNC_ROUTE)
export class EmployeeSyncController {
  constructor(private readonly sync: EmployeeSyncService) {}

  @Post()
  @HttpCode(200)
  async push(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response
  ): Promise<EmployeeSyncResponse | EmployeeSyncRefusal> {
    const hash = this.sync.keyHash();
    if (hash === undefined) {
      response.status(503);
      return {
        ok: false,
        reason: 'NOT_CONFIGURED: The employee sync is not configured on this server.',
      };
    }
    if (!isValidEmployeeSyncKey(authorization, hash)) {
      response.status(401);
      return { ok: false, reason: 'INVALID_KEY: Missing or invalid bearer key.' };
    }
    const result = await this.sync.run(body);
    response.status(result.status);
    return result.body;
  }
}
