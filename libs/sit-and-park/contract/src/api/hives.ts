/**
 * Admin hive management. Hives are global; a user is in at most one.
 */

import * as z from 'zod';
import { hiveSchema, userSchema } from '../schemas/entities';
import { idSchema } from '../schemas/primitives';
import { authed, contractErrors, noInputSchema } from './builder';

export const adminHiveSchema = hiveSchema.extend({
  ownerName: userSchema.shape.name,
  /** Sorted by name. */
  members: z.array(z.object({ userId: idSchema, name: userSchema.shape.name })),
  deskCount: z.int().nonnegative(),
});
export type AdminHive = z.infer<typeof adminHiveSchema>;

export const adminHiveListOutputSchema = z.object({ hives: z.array(adminHiveSchema) });
export type AdminHiveListOutput = z.infer<typeof adminHiveListOutputSchema>;

export const adminHiveListContract = authed
  .route({ description: 'Admin: every hive with its owner, members and desk count.' })
  .input(noInputSchema)
  .output(adminHiveListOutputSchema);

export const adminCreateHiveInputSchema = hiveSchema.pick({
  name: true,
  color: true,
  ownerId: true,
});
export type AdminCreateHiveInput = z.infer<typeof adminCreateHiveInputSchema>;

/**
 * `NOT_FOUND` is an unknown owner, `VALIDATION_FAILED` an inactive one,
 * `CONFLICT` a taken name.
 */
export const adminCreateHiveContract = authed
  .route({ description: 'Admin: create a hive with a name, a #RRGGBB colour and an owner.' })
  .input(adminCreateHiveInputSchema)
  .output(hiveSchema)
  .errors(contractErrors('NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'));

/** Partial update; absent = unchanged. Nothing here can be cleared. */
export const adminUpdateHiveInputSchema = adminCreateHiveInputSchema
  .partial()
  .extend({ hiveId: idSchema });
export type AdminUpdateHiveInput = z.infer<typeof adminUpdateHiveInputSchema>;

export const adminUpdateHiveContract = authed
  .route({ description: 'Admin: rename a hive, change its colour or its owner.' })
  .input(adminUpdateHiveInputSchema)
  .output(hiveSchema)
  .errors(contractErrors('NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'));

export const adminDeleteHiveInputSchema = z.object({ hiveId: idSchema });
export type AdminDeleteHiveInput = z.infer<typeof adminDeleteHiveInputSchema>;

export const adminDeleteHiveOutputSchema = z.object({ hiveId: idSchema });
export type AdminDeleteHiveOutput = z.infer<typeof adminDeleteHiveOutputSchema>;

/** Its desks become hive-less, memberships go, pending requests are rejected. */
export const adminDeleteHiveContract = authed
  .route({
    description:
      'Admin: delete a hive. Its desks become open to the office, memberships are removed and pending requests rejected.',
  })
  .input(adminDeleteHiveInputSchema)
  .output(adminDeleteHiveOutputSchema)
  .errors(contractErrors('NOT_FOUND'));

export const adminSetHiveMembershipInputSchema = z.object({
  hiveId: idSchema,
  userId: idSchema,
  member: z.boolean(),
});
export type AdminSetHiveMembershipInput = z.infer<typeof adminSetHiveMembershipInputSchema>;

export const adminSetHiveMembershipOutputSchema = z.object({
  userId: idSchema,
  /** The user's hive afterwards; `null` = none. */
  hiveId: idSchema.nullable(),
});
export type AdminSetHiveMembershipOutput = z.infer<typeof adminSetHiveMembershipOutputSchema>;

export const adminSetHiveMembershipContract = authed
  .route({
    description:
      'Admin: add a user to a hive (moving them out of any other) or remove them from it.',
  })
  .input(adminSetHiveMembershipInputSchema)
  .output(adminSetHiveMembershipOutputSchema)
  .errors(contractErrors('NOT_FOUND'));
