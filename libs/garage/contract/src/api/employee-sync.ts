/**
 * Admin view of the HiBob employee sync. The sync itself is
 * `POST /api/employee-sync`, outside oRPC (bearer key, not a user), so it has
 * no procedure here.
 */

import * as z from 'zod';
import { EMPLOYEE_SYNC_RUN_HISTORY } from '@garage/shared-types';
import { employeeSyncRunSchema, employeeSyncSettingsSchema } from '../schemas/entities';
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
