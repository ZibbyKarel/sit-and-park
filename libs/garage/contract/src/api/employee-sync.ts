/**
 * Admin view of the HiBob employee sync. The sync itself is
 * `POST /api/employee-sync`, outside oRPC (bearer key, not a user), so it has
 * no procedure here.
 */

import * as z from 'zod';
import { EMPLOYEE_SYNC_RUN_HISTORY } from '@garage/shared-types';
import { employeeSyncRunSchema, employeeSyncSettingsSchema } from '../schemas/entities';
import { employeeSyncModeSchema } from '../schemas/enums';
import { idSchema } from '../schemas/primitives';
import { authed, noInputSchema } from './builder';

export const adminEmployeeSyncOutputSchema = employeeSyncSettingsSchema.extend({
  /** Whether the API has a key hash configured (`EMPLOYEE_SYNC_KEY_SHA256`). */
  configured: z.boolean(),
  /** The latest runs, newest first. */
  runs: z.array(employeeSyncRunSchema).max(EMPLOYEE_SYNC_RUN_HISTORY),
});
export type AdminEmployeeSyncOutput = z.infer<typeof adminEmployeeSyncOutputSchema>;

export const adminEmployeeSyncContract = authed
  .route({
    description:
      'Admin: the employee sync’s live/dry mode, whether a key is configured, and the latest 12 runs.',
  })
  .input(noInputSchema)
  .output(adminEmployeeSyncOutputSchema);

export const adminSetEmployeeSyncLiveModeInputSchema = employeeSyncSettingsSchema;
export type AdminSetEmployeeSyncLiveModeInput = z.infer<
  typeof adminSetEmployeeSyncLiveModeInputSchema
>;

/** Full replacement of the singleton. Audited. */
export const adminSetEmployeeSyncLiveModeContract = authed
  .route({
    description:
      'Admin: switch the employee sync between live (applies changes) and dry run (logs only).',
  })
  .input(adminSetEmployeeSyncLiveModeInputSchema)
  .output(employeeSyncSettingsSchema);

/*
 * ---------------------------------------------------------------------------
 * `POST /api/employee-sync` — the second endpoint outside oRPC, after the ICS
 * feed (`./ics.ts`). The caller is a Keboola flow, not a browser, so it cannot
 * speak the RPC envelope; contract-first still binds the path and the shapes.
 * See `doc/employee-sync.md`.
 * ---------------------------------------------------------------------------
 */

/** Path of the sync endpoint, including the API's global prefix. */
export const EMPLOYEE_SYNC_PATH = '/api/employee-sync';

/** Largest accepted request body. The API's global limit is far smaller. */
export const EMPLOYEE_SYNC_BODY_LIMIT = '2mb';

/**
 * One row as HiBob/Keboola sends it. Fields are optional strings on purpose:
 * a missing id or name is a **row** problem the whole-list validation reports
 * (422, `INVALID_ROWS`), not a malformed request.
 */
export const employeeSyncRowSchema = z.object({
  id: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
});
export type EmployeeSyncRow = z.infer<typeof employeeSyncRowSchema>;

export const employeeSyncRequestSchema = z.object({
  /** Who pushes the list; logged on the run. */
  source: z.string().trim().min(1).max(200).default('keboola'),
  employees: z.array(employeeSyncRowSchema),
});
export type EmployeeSyncRequest = z.infer<typeof employeeSyncRequestSchema>;

/**
 * Stable machine codes that open every `reason` string, both in the response
 * and on `EmployeeSyncRun.reason`: `"<CODE>: <English detail>"`. The admin UI
 * translates the code; the detail is for operators reading the Keboola log.
 */
export const EMPLOYEE_SYNC_REASON_CODES = [
  /** `EMPLOYEE_SYNC_KEY_SHA256` is not set (503). */
  'NOT_CONFIGURED',
  /** Missing, short or wrong bearer key (401). */
  'INVALID_KEY',
  /** The JSON parsed but is not `{ source?, employees: [...] }` (400). */
  'INVALID_PAYLOAD',
  /** `employees` is empty (422). */
  'EMPTY_LIST',
  /**
   * At least one row is invalid or duplicated, or has an id over 100, a name
   * over 200 or an e-mail over 320 characters (422).
   */
  'INVALID_ROWS',
  /** The run would deactivate more than 10 % of the active synced users (422). */
  'LIST_SHRANK',
] as const;
export type EmployeeSyncReasonCode = (typeof EMPLOYEE_SYNC_REASON_CODES)[number];

/** The code a `reason` string starts with, or `null` for an unknown one. */
export function employeeSyncReasonCode(reason: string): EmployeeSyncReasonCode | null {
  const code = reason.split(':', 1)[0];
  return EMPLOYEE_SYNC_REASON_CODES.find((known) => known === code) ?? null;
}

const countSchema = z.int().nonnegative();

/** Totals of a run; unlike the summary's lists, never capped. */
export const employeeSyncCountsSchema = z.strictObject({
  received: countSchema,
  activeBefore: countSchema,
  created: countSchema,
  renamed: countSchema,
  deactivated: countSchema,
  reactivated: countSchema,
  linked: countSchema,
  unchanged: countSchema,
  warnings: countSchema,
});
export type EmployeeSyncCounts = z.infer<typeof employeeSyncCountsSchema>;

/** 200 (applied or dry run), 422 (list rejected) and 400 (bad shape, still logged). */
export const employeeSyncResponseSchema = z.strictObject({
  ok: z.boolean(),
  mode: employeeSyncModeSchema,
  reason: employeeSyncRunSchema.shape.reason,
  runId: idSchema,
  counts: employeeSyncCountsSchema,
});
export type EmployeeSyncResponse = z.infer<typeof employeeSyncResponseSchema>;

/** 401 and 503: nothing was logged, so there is no run to point at. */
export const employeeSyncRefusalSchema = z.strictObject({
  ok: z.literal(false),
  reason: z.string().min(1),
});
export type EmployeeSyncRefusal = z.infer<typeof employeeSyncRefusalSchema>;
