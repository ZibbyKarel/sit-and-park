/**
 * Desk bulk booking ("Hromadná rezervace stolů"): the same two-step flow as
 * parking's `reservation.previewBulk` / `confirmBulk`, for desks.
 *
 * 1. `desk.previewBulk` proposes a desk for every (person, day) and lists the
 *    free desks per office and day for a manual pick. It writes nothing.
 * 2. `desk.confirmBulk` takes the **explicit** list of assignments the user
 *    ended up with (proposed or picked by hand), re-checks every row inside one
 *    transaction, books the valid ones and reports the rest as skipped.
 *
 * Unlike parking, confirm does not re-run the allocator: the preview is
 * editable, so the client sends what the user chose. Only an admin may name
 * people other than themselves (`FORBIDDEN`, declared by the base builder).
 * One person never gets two desks on a day (`DeskReservation (userId, date)`).
 */

import * as z from 'zod';
import {
  MAX_BULK_BOOKING_DAYS,
  MAX_DESK_BULK_IDS,
  MAX_DESK_BULK_USERS,
} from '@sit-and-park/shared-types';
import { deskReservationSchema, deskSchema, userSchema, zoneSchema } from '../schemas/entities';
import { deskBulkSkipReasonSchema } from '../schemas/enums';
import { dateOnlySchema, idSchema, yearMonthSchema } from '../schemas/primitives';
import { authed, contractErrors } from './builder';

function distinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function oneMonth(dates: readonly string[]): boolean {
  return new Set(dates.map((date) => date.slice(0, 7))).size <= 1;
}

/** Same limits as parking's bulk modal: distinct days of one calendar month. */
const deskBulkDatesSchema = z
  .array(dateOnlySchema)
  .min(1)
  .max(MAX_BULK_BOOKING_DAYS)
  .refine(distinct, { error: 'dates must not contain duplicates' })
  .refine(oneMonth, { error: 'dates must all fall in the same calendar month' });

// --- preview ------------------------------------------------------------------

export const deskBulkPreviewInputSchema = z.object({
  dates: deskBulkDatesSchema,
  /**
   * Whom to book for; absent = the caller. Naming anybody but the caller is
   * admin only (`FORBIDDEN`).
   */
  userIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_DESK_BULK_USERS)
    .refine(distinct, { error: 'userIds must not contain duplicates' })
    .optional(),
  /**
   * Candidate pool for the allocator (desks pre-selected on the plan or in the
   * list); absent = every desk of each person's office. A person's preferred
   * desk wins only when it is in the pool.
   */
  deskIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_DESK_BULK_IDS)
    .refine(distinct, { error: 'deskIds must not contain duplicates' })
    .optional(),
});
export type DeskBulkPreviewInput = z.infer<typeof deskBulkPreviewInputSchema>;

/** The allocator found a desk: the preferred one, or the nearest in the anchor's zone. */
export const deskBulkAssignedRowSchema = z.object({
  outcome: z.literal('ASSIGNED'),
  userId: idSchema,
  date: dateOnlySchema,
  deskId: idSchema,
  deskCode: deskSchema.shape.code,
  zoneName: zoneSchema.shape.name,
  /** `true` when this is the person's `preferredDeskId`. */
  isPreferred: z.boolean(),
});

/** Bookable, but the allocator found no desk; the user picks one by hand. */
export const deskBulkUnassignedRowSchema = z.object({
  outcome: z.literal('UNASSIGNED'),
  userId: idSchema,
  date: dateOnlySchema,
});

/**
 * Why nothing can be booked for a person on a day, whatever the desk: the
 * person-level subset of {@link deskBulkSkipReasonSchema}.
 */
export const deskBulkPersonSkipReasonSchema = deskBulkSkipReasonSchema.extract([
  'PAST_DATE',
  'USER_INACTIVE',
  'NO_OFFICE_ASSIGNED',
  'PERMANENT_DESK_HOLDER',
  'ALREADY_RESERVED_OTHER_DESK',
]);
export type DeskBulkPersonSkipReason = z.infer<typeof deskBulkPersonSkipReasonSchema>;

/** Nothing can be booked for this person on this day. */
export const deskBulkUnavailableRowSchema = z.object({
  outcome: z.literal('UNAVAILABLE'),
  userId: idSchema,
  date: dateOnlySchema,
  reason: deskBulkPersonSkipReasonSchema,
});

export const deskBulkPlanRowSchema = z.discriminatedUnion('outcome', [
  deskBulkAssignedRowSchema,
  deskBulkUnassignedRowSchema,
  deskBulkUnavailableRowSchema,
]);
export type DeskBulkPlanRow = z.infer<typeof deskBulkPlanRowSchema>;

export const deskBulkPersonSchema = z.object({
  id: idSchema,
  name: userSchema.shape.name,
  officeId: idSchema.nullable(),
  preferredDeskId: idSchema.nullable(),
});
export type DeskBulkPerson = z.infer<typeof deskBulkPersonSchema>;

export const deskBulkFreeDeskSchema = z.object({
  id: idSchema,
  code: deskSchema.shape.code,
  zoneName: zoneSchema.shape.name,
});
export type DeskBulkFreeDesk = z.infer<typeof deskBulkFreeDeskSchema>;

/**
 * Free desks of one office on one day, for the manual pick. For an admin every
 * free active desk of the office (an admin may override hive access by hand);
 * for anybody else only the ones they can book directly. Not limited to the
 * pool, and not minus the plan: the client drops desks the plan already uses
 * that day.
 */
export const deskBulkFreeDaySchema = z.object({
  officeId: idSchema,
  date: dateOnlySchema,
  /** Sorted by code. */
  desks: z.array(deskBulkFreeDeskSchema),
});
export type DeskBulkFreeDay = z.infer<typeof deskBulkFreeDaySchema>;

export const deskBulkPreviewOutputSchema = z.object({
  month: yearMonthSchema,
  /** In allocation order: people with a preferred desk first, then the rest. */
  people: z.array(deskBulkPersonSchema),
  /** One row per (person, requested day): person order, then date ascending. */
  rows: z.array(deskBulkPlanRowSchema),
  /** One entry per (office of a person, requested day), date ascending. */
  freeDesks: z.array(deskBulkFreeDaySchema),
});
export type DeskBulkPreviewOutput = z.infer<typeof deskBulkPreviewOutputSchema>;

export const deskBulkPreviewContract = authed
  .route({
    description:
      'Read-only desk schedule for one or more people on up to 31 days of one month: each person’s preferred desk if free and in the pool, else the nearest free desk in the anchor’s zone (the anchor is the preferred desk only when it is in the pool and directly bookable, otherwise the pool desk free on most days), else unassigned; plus the free desks per office and day for a manual pick. Writes nothing. Naming other people is admin only.',
  })
  .input(deskBulkPreviewInputSchema)
  .output(deskBulkPreviewOutputSchema)
  .errors(contractErrors('NOT_FOUND'));

// --- confirm ------------------------------------------------------------------

export const deskBulkAssignmentSchema = z.object({
  userId: idSchema,
  date: dateOnlySchema,
  deskId: idSchema,
});
export type DeskBulkAssignment = z.infer<typeof deskBulkAssignmentSchema>;

export const deskBulkConfirmInputSchema = z.object({
  assignments: z
    .array(deskBulkAssignmentSchema)
    .min(1)
    .max(MAX_BULK_BOOKING_DAYS * MAX_DESK_BULK_USERS)
    .refine((rows) => distinct(rows.map((row) => `${row.userId}|${row.date}`)), {
      error: 'one person may get at most one desk per day',
    })
    .refine((rows) => distinct(rows.map((row) => `${row.deskId}|${row.date}`)), {
      error: 'one desk may be assigned at most once per day',
    })
    .refine((rows) => new Set(rows.map((row) => row.date)).size <= MAX_BULK_BOOKING_DAYS, {
      error: `at most ${MAX_BULK_BOOKING_DAYS} distinct dates`,
    })
    .refine((rows) => oneMonth(rows.map((row) => row.date)), {
      error: 'dates must all fall in the same calendar month',
    })
    .refine((rows) => new Set(rows.map((row) => row.userId)).size <= MAX_DESK_BULK_USERS, {
      error: `at most ${MAX_DESK_BULK_USERS} people`,
    }),
});
export type DeskBulkConfirmInput = z.infer<typeof deskBulkConfirmInputSchema>;

export const deskBulkSkippedRowSchema = deskBulkAssignmentSchema.extend({
  reason: deskBulkSkipReasonSchema,
});
export type DeskBulkSkippedRow = z.infer<typeof deskBulkSkippedRowSchema>;

export const deskBulkConfirmOutputSchema = z.object({
  /** Ascending by date, then user id. */
  reserved: z.array(deskReservationSchema),
  /** Rows not booked, in input order. */
  skipped: z.array(deskBulkSkippedRowSchema),
});
export type DeskBulkConfirmOutput = z.infer<typeof deskBulkConfirmOutputSchema>;

/**
 * Every row is re-checked under the desk and user locks; a row that is no
 * longer bookable (desk taken meanwhile, person booked elsewhere, past day, …)
 * is skipped with a reason, never an error. `NOT_FOUND` is an unknown user or
 * desk id; `CONFLICT` a lost race on a unique index (nothing is written; retry).
 */
export const deskBulkConfirmContract = authed
  .route({
    description:
      'Book an explicit list of (person, day, desk) assignments in one transaction. Rows that are no longer bookable are returned as skipped with a reason. Naming other people is admin only; an admin may also book a hive desk the person has no direct access to.',
  })
  .input(deskBulkConfirmInputSchema)
  .output(deskBulkConfirmOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'CONFLICT'));
