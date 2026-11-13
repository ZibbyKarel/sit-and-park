/**
 * Admin desk management: the all-offices list, single and bulk edits,
 * permanent holders, direct grants, and the day's statistics.
 *
 * Admin-only by position under `admin` in the router (`@Roles('ADMIN')`).
 */

import * as z from 'zod';
import { MAX_DESK_BULK_IDS } from '@garage/shared-types';
import { deskSchema, hiveSchema, officeSchema, userSchema, zoneSchema } from '../schemas/entities';
import { deskStatusSchema } from '../schemas/enums';
import { dateOnlySchema, idSchema } from '../schemas/primitives';
import { authed, contractErrors } from './builder';

const deskIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(MAX_DESK_BULK_IDS)
  .refine((ids) => new Set(ids).size === ids.length, {
    error: 'deskIds must not contain duplicates',
  });

/** The directory's status without the viewer-relative `RESERVED_BY_ME`. */
export const adminDeskStatusSchema = deskStatusSchema.exclude(['RESERVED_BY_ME']);
export type AdminDeskStatus = z.infer<typeof adminDeskStatusSchema>;

export const adminDeskListInputSchema = z.object({
  date: dateOnlySchema,
  /** Omitted = every office. */
  officeId: idSchema.optional(),
});
export type AdminDeskListInput = z.infer<typeof adminDeskListInputSchema>;

export const adminDeskSchema = deskSchema.extend({
  status: adminDeskStatusSchema,
  reservedByName: userSchema.shape.name.nullable(),
  permanentAssigneeName: userSchema.shape.name.nullable(),
  hiveName: hiveSchema.shape.name.nullable(),
  hiveColor: hiveSchema.shape.color.nullable(),
  zoneName: zoneSchema.shape.name,
  officeName: officeSchema.shape.name,
});
export type AdminDesk = z.infer<typeof adminDeskSchema>;

export const adminDeskListOutputSchema = z.object({
  date: dateOnlySchema,
  desks: z.array(adminDeskSchema),
});
export type AdminDeskListOutput = z.infer<typeof adminDeskListOutputSchema>;

export const adminDeskListContract = authed
  .route({
    description:
      'Admin: every desk (of one office, or of all) with its status for one day, holder, permanent assignee, hive, zone and office.',
  })
  .input(adminDeskListInputSchema)
  .output(adminDeskListOutputSchema);

/**
 * Partial update: absent = unchanged; `hiveId: null` takes the desk out of
 * its hive. Changing `officeId` needs a `zoneId` of that office
 * (`VALIDATION_FAILED` otherwise); `CONFLICT` is a code taken in the target
 * office. Deactivating or moving the desk cancels its future reservations;
 * any of active/hive/office changing rejects its pending requests.
 */
export const adminUpdateDeskInputSchema = deskSchema
  .pick({ active: true, hiveId: true, zoneId: true, officeId: true })
  .partial()
  .extend({ deskId: idSchema });
export type AdminUpdateDeskInput = z.infer<typeof adminUpdateDeskInputSchema>;

export const adminUpdateDeskContract = authed
  .route({
    description:
      'Admin: change one desk’s active flag, hive, zone or office. Cancels future reservations when the desk is deactivated or moved.',
  })
  .input(adminUpdateDeskInputSchema)
  .output(deskSchema)
  .errors(contractErrors('NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'));

export const adminBulkUpdateDesksInputSchema = z
  .object({
    deskIds: deskIdsSchema,
    active: z.boolean().optional(),
    /** `null` takes the desks out of their hive. */
    hiveId: idSchema.nullable().optional(),
  })
  .refine((value) => value.active !== undefined || value.hiveId !== undefined, {
    error: 'set at least one of active, hiveId',
  });
export type AdminBulkUpdateDesksInput = z.infer<typeof adminBulkUpdateDesksInputSchema>;

export const adminBulkUpdateDesksOutputSchema = z.object({ updated: z.int().nonnegative() });
export type AdminBulkUpdateDesksOutput = z.infer<typeof adminBulkUpdateDesksOutputSchema>;

/** One transaction, the same side effects as `admin.desk.update` per desk. */
export const adminBulkUpdateDesksContract = authed
  .route({
    description:
      'Admin: set the active flag and/or hive of up to 500 desks at once, in one transaction.',
  })
  .input(adminBulkUpdateDesksInputSchema)
  .output(adminBulkUpdateDesksOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'CONFLICT'));

export const adminSetPermanentAssigneeInputSchema = z.object({
  deskId: idSchema,
  /** `null` clears the holder. */
  userId: idSchema.nullable(),
});
export type AdminSetPermanentAssigneeInput = z.infer<typeof adminSetPermanentAssigneeInputSchema>;

/**
 * `CONFLICT` is a user who already holds another permanent desk (unique).
 * `VALIDATION_FAILED` an inactive user or one of another office. Changing or
 * clearing the holder deletes release days nobody booked, cancels other
 * people's future reservations of the desk and the new holder's elsewhere.
 */
export const adminSetPermanentAssigneeContract = authed
  .route({
    description: 'Admin: make a user the permanent holder of a desk, or clear the holder (null).',
  })
  .input(adminSetPermanentAssigneeInputSchema)
  .output(deskSchema)
  .errors(contractErrors('NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'));

export const adminDeskGrantsInputSchema = z.object({ deskId: idSchema });
export type AdminDeskGrantsInput = z.infer<typeof adminDeskGrantsInputSchema>;

export const adminDeskGrantsOutputSchema = z.object({
  grants: z.array(
    z.object({ userId: idSchema, name: userSchema.shape.name, email: userSchema.shape.email })
  ),
});
export type AdminDeskGrantsOutput = z.infer<typeof adminDeskGrantsOutputSchema>;

export const adminDeskGrantsContract = authed
  .route({ description: 'Admin: the users with a direct grant on one desk.' })
  .input(adminDeskGrantsInputSchema)
  .output(adminDeskGrantsOutputSchema)
  .errors(contractErrors('NOT_FOUND'));

export const adminSetDeskGrantInputSchema = z.object({
  deskIds: deskIdsSchema,
  userId: idSchema,
  granted: z.boolean(),
});
export type AdminSetDeskGrantInput = z.infer<typeof adminSetDeskGrantInputSchema>;

export const adminSetDeskGrantOutputSchema = z.object({
  /** Grants actually created or removed; already-in-state desks do not count. */
  updated: z.int().nonnegative(),
});
export type AdminSetDeskGrantOutput = z.infer<typeof adminSetDeskGrantOutputSchema>;

export const adminSetDeskGrantContract = authed
  .route({
    description:
      'Admin: give (granted: true) or take away a user’s direct booking right on up to 500 desks. Idempotent.',
  })
  .input(adminSetDeskGrantInputSchema)
  .output(adminSetDeskGrantOutputSchema)
  .errors(contractErrors('NOT_FOUND'));

export const adminDeskStatsInputSchema = z.object({
  date: dateOnlySchema,
  /** Omitted = every office. */
  officeId: idSchema.optional(),
});
export type AdminDeskStatsInput = z.infer<typeof adminDeskStatsInputSchema>;

const countSchema = z.int().nonnegative();

/**
 * Statistics for one day. "Bookable" = active and not permanently assigned,
 * or permanently assigned and released that day. `reservedOnDate` counts
 * reservations on bookable desks only, so `occupancyPercent`
 * (`round(reserved / bookable * 100)`, `0` with no bookable desk) never
 * exceeds 100.
 */
export const adminDeskStatsOutputSchema = z.object({
  date: dateOnlySchema,
  totalDesks: countSchema,
  activeDesks: countSchema,
  inactiveDesks: countSchema,
  permanentAssignments: countSchema,
  bookableOnDate: countSchema,
  reservedOnDate: countSchema,
  freeOnDate: countSchema,
  occupancyPercent: z.int().min(0).max(100),
  hiveCount: countSchema,
  pendingApprovals: countSchema,
  byZone: z.array(
    z.object({
      zoneId: idSchema,
      zoneName: zoneSchema.shape.name,
      officeId: idSchema,
      desks: countSchema,
      free: countSchema,
      reserved: countSchema,
      /** Inactive, or permanently assigned and not released. */
      unavailable: countSchema,
    })
  ),
  byOffice: z.array(
    z.object({
      officeId: idSchema,
      officeName: officeSchema.shape.name,
      desks: countSchema,
      reservedOnDate: countSchema,
    })
  ),
});
export type AdminDeskStatsOutput = z.infer<typeof adminDeskStatsOutputSchema>;

/** `NOT_FOUND` is an unknown `officeId`. */
export const adminDeskStatsContract = authed
  .route({
    description:
      'Admin: desk counts, occupancy and pending approvals for one day, overall and per zone and office.',
  })
  .input(adminDeskStatsInputSchema)
  .output(adminDeskStatsOutputSchema)
  .errors(contractErrors('NOT_FOUND'));
