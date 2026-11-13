/**
 * Admin office and zone management. A floor plan is a bundled asset set by a
 * migration, so neither procedure here takes one.
 */

import * as z from 'zod';
import { officeSchema, zoneSchema } from '../schemas/entities';
import { idSchema } from '../schemas/primitives';
import { authed, contractErrors, noInputSchema } from './builder';

const countSchema = z.int().nonnegative();

export const adminOfficeSchema = officeSchema.extend({
  deskCount: countSchema,
  spotCount: countSchema,
  userCount: countSchema,
});
export type AdminOffice = z.infer<typeof adminOfficeSchema>;

export const adminOfficeListOutputSchema = z.object({ offices: z.array(adminOfficeSchema) });
export type AdminOfficeListOutput = z.infer<typeof adminOfficeListOutputSchema>;

export const adminOfficeListContract = authed
  .route({ description: 'Admin: every office with its desk, parking spot and user counts.' })
  .input(noInputSchema)
  .output(adminOfficeListOutputSchema);

export const adminCreateOfficeInputSchema = officeSchema.pick({ name: true, active: true });
export type AdminCreateOfficeInput = z.infer<typeof adminCreateOfficeInputSchema>;

/** `CONFLICT` is a taken name. */
export const adminCreateOfficeContract = authed
  .route({ description: 'Admin: create an office (without a floor plan).' })
  .input(adminCreateOfficeInputSchema)
  .output(officeSchema)
  .errors(contractErrors('CONFLICT'));

/** Partial update; absent = unchanged. */
export const adminUpdateOfficeInputSchema = adminCreateOfficeInputSchema
  .partial()
  .extend({ officeId: idSchema });
export type AdminUpdateOfficeInput = z.infer<typeof adminUpdateOfficeInputSchema>;

export const adminUpdateOfficeContract = authed
  .route({ description: 'Admin: rename an office or switch it on or off.' })
  .input(adminUpdateOfficeInputSchema)
  .output(officeSchema)
  .errors(contractErrors('NOT_FOUND', 'CONFLICT'));

export const adminZoneListInputSchema = z.object({ officeId: idSchema });
export type AdminZoneListInput = z.infer<typeof adminZoneListInputSchema>;

export const adminZoneListOutputSchema = z.object({ zones: z.array(zoneSchema) });
export type AdminZoneListOutput = z.infer<typeof adminZoneListOutputSchema>;

/** An unknown office honestly has no zones, so there is no `NOT_FOUND`. */
export const adminZoneListContract = authed
  .route({ description: 'Admin: the zones of one office.' })
  .input(adminZoneListInputSchema)
  .output(adminZoneListOutputSchema);

export const adminCreateZoneInputSchema = zoneSchema.pick({
  officeId: true,
  key: true,
  name: true,
});
export type AdminCreateZoneInput = z.infer<typeof adminCreateZoneInputSchema>;

/** `NOT_FOUND` is an unknown office, `CONFLICT` a key taken in it. */
export const adminCreateZoneContract = authed
  .route({ description: 'Admin: add a zone (a stable key and a name) to an office.' })
  .input(adminCreateZoneInputSchema)
  .output(zoneSchema)
  .errors(contractErrors('NOT_FOUND', 'CONFLICT'));

/** The key is the zone's identity and does not change; only the name does. */
export const adminUpdateZoneInputSchema = zoneSchema
  .pick({ name: true })
  .extend({ zoneId: idSchema });
export type AdminUpdateZoneInput = z.infer<typeof adminUpdateZoneInputSchema>;

export const adminUpdateZoneContract = authed
  .route({ description: 'Admin: rename a zone.' })
  .input(adminUpdateZoneInputSchema)
  .output(zoneSchema)
  .errors(contractErrors('NOT_FOUND'));
