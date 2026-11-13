/**
 * Desk booking for the caller: the day's directory, series booking, the
 * caller's reservations, and a permanent holder's releases.
 *
 * Rules are the ones in `doc/desks.md`. Every
 * procedure here carries a `.route({ description })`: the contract is kept
 * MCP-friendly — a description per procedure, flat inputs, and no implicit
 * state beyond the caller's identity.
 */

import * as z from 'zod';
import {
  addDays,
  compareDateOnly,
  DESK_HISTORY_MONTHS,
  MAX_DESK_RELEASE_DATES,
  MAX_DESK_SERIES_DATES,
  MAX_DESK_SERIES_SPAN_DAYS,
} from '@sit-and-park/shared-types';
import {
  deskReservationSchema,
  deskSchema,
  hiveSchema,
  officeSchema,
  userSchema,
  zoneSchema,
} from '../schemas/entities';
import { deskAccessSchema, deskSkipReasonSchema, deskStatusSchema } from '../schemas/enums';
import { dateOnlySchema, idSchema } from '../schemas/primitives';
import { authed, contractErrors, noInputSchema } from './builder';

const personNameSchema = userSchema.shape.name;

/** True when `dates` has no duplicates. */
function distinct(dates: readonly string[]): boolean {
  return new Set(dates).size === dates.length;
}

/**
 * 1 to `MAX_DESK_SERIES_DATES` distinct dates, the latest at most
 * `MAX_DESK_SERIES_SPAN_DAYS` after the earliest, in any order. Structural
 * only, like `bulkBookingInputSchema`: whether a day is past is a per-day
 * reason (`PAST_DATE`), because it depends on "today".
 */
export const deskSeriesDatesSchema = z
  .array(dateOnlySchema)
  .min(1)
  .max(MAX_DESK_SERIES_DATES)
  .refine(distinct, { error: 'dates must not contain duplicates' })
  .refine(
    (dates) => {
      const sorted = [...dates].sort(compareDateOnly);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return (
        first === undefined ||
        last === undefined ||
        compareDateOnly(last, addDays(first, MAX_DESK_SERIES_SPAN_DAYS)) <= 0
      );
    },
    { error: `the last date must be at most ${MAX_DESK_SERIES_SPAN_DAYS} days after the first` }
  );

// --- directory --------------------------------------------------------------

export const deskDirectoryInputSchema = z.object({ date: dateOnlySchema });
export type DeskDirectoryInput = z.infer<typeof deskDirectoryInputSchema>;

/** One desk as the caller sees it on the requested day. */
export const directoryDeskSchema = deskSchema.extend({
  zoneName: zoneSchema.shape.name,
  hiveName: hiveSchema.shape.name.nullable(),
  hiveColor: hiveSchema.shape.color.nullable(),
  status: deskStatusSchema,
  access: deskAccessSchema,
  /** Holder of that day's reservation; visible to everybody in the office. */
  reservedByName: personNameSchema.nullable(),
  permanentAssigneeName: personNameSchema.nullable(),
  /** Permanently assigned **and** released by its holder that day. */
  releasedOn: z.boolean(),
  myReservationId: idSchema.nullable(),
  /** The caller's `PENDING` approval request for this desk and day, if any. */
  myPendingRequestId: idSchema.nullable(),
  assignedToMe: z.boolean(),
  grantedToMe: z.boolean(),
});
export type DirectoryDesk = z.infer<typeof directoryDeskSchema>;

export const deskDirectoryOutputSchema = z.object({
  date: dateOnlySchema,
  office: officeSchema.pick({
    id: true,
    name: true,
    floorPlan: true,
    floorPlanWidth: true,
    floorPlanHeight: true,
  }),
  zones: z.array(zoneSchema),
  /** Every hive (hives are global), for legends and filters. */
  hives: z.array(hiveSchema.pick({ id: true, name: true, color: true })),
  /** Every desk of the caller's office, sorted by code. */
  desks: z.array(directoryDeskSchema),
});
export type DeskDirectoryOutput = z.infer<typeof deskDirectoryOutputSchema>;

export const deskDirectoryContract = authed
  .route({
    description:
      'Every desk of the caller’s office for one day, with its status, the caller’s access and who holds it, plus the office’s floor plan, zones and all hives.',
  })
  .input(deskDirectoryInputSchema)
  .output(deskDirectoryOutputSchema)
  .errors(contractErrors('NO_OFFICE_ASSIGNED'));

// --- series -----------------------------------------------------------------

export const deskSeriesInputSchema = z.object({
  deskId: idSchema,
  dates: deskSeriesDatesSchema,
});
export type DeskSeriesInput = z.infer<typeof deskSeriesInputSchema>;

export const deskSeriesDaySchema = z.object({
  date: dateOnlySchema,
  ok: z.boolean(),
  /** `null` exactly when `ok`. */
  reason: deskSkipReasonSchema.nullable(),
});
export type DeskSeriesDay = z.infer<typeof deskSeriesDaySchema>;

export const previewDeskSeriesOutputSchema = z.object({
  /** One entry per requested date, ascending. */
  days: z.array(deskSeriesDaySchema),
});
export type PreviewDeskSeriesOutput = z.infer<typeof previewDeskSeriesOutputSchema>;

/**
 * The desk-level blockers that fail a whole series call (preview and booking
 * alike): unknown desk, no office, the caller holds a permanent desk, the desk
 * is inactive, or the caller has no direct access to it.
 */
const SERIES_BLOCKERS = [
  'NOT_FOUND',
  'NO_OFFICE_ASSIGNED',
  'PERMANENT_DESK_HOLDER',
  'DESK_NOT_AVAILABLE',
  'DESK_ACCESS_DENIED',
] as const;

export const previewDeskSeriesContract = authed
  .route({
    description:
      'Read-only plan for booking one desk on 1–20 dates: which days would be booked and why the others would be skipped. Writes nothing.',
  })
  .input(deskSeriesInputSchema)
  .output(previewDeskSeriesOutputSchema)
  .errors(contractErrors(...SERIES_BLOCKERS));

export const reserveDeskOutputSchema = z.object({
  reserved: z.array(deskReservationSchema),
  skipped: z.array(z.object({ date: dateOnlySchema, reason: deskSkipReasonSchema })),
});
export type ReserveDeskOutput = z.infer<typeof reserveDeskOutputSchema>;

/**
 * Skip semantics: free days are booked, the rest reported in `skipped`.
 * `NO_FREE_DAY` when nothing could be booked. The two uniqueness codes and
 * `CONFLICT` are a lost race between the plan and the insert.
 */
export const reserveDeskContract = authed
  .route({
    description:
      'Book one desk for the caller on 1–20 dates (the last at most 34 days after the first). Free days are booked; the others are returned as skipped with a reason.',
  })
  .input(deskSeriesInputSchema)
  .output(reserveDeskOutputSchema)
  .errors(
    contractErrors(
      ...SERIES_BLOCKERS,
      'NO_FREE_DAY',
      'DESK_ALREADY_RESERVED',
      'DESK_RESERVATION_LIMIT_REACHED',
      'CONFLICT'
    )
  );

// --- cancel and list --------------------------------------------------------

export const cancelDeskReservationInputSchema = z.object({ reservationId: idSchema });
export type CancelDeskReservationInput = z.infer<typeof cancelDeskReservationInputSchema>;

export const cancelDeskReservationOutputSchema = z.object({
  reservationId: idSchema,
  /** Echoed so the client can invalidate exactly the affected day. */
  date: dateOnlySchema,
  deskId: idSchema,
});
export type CancelDeskReservationOutput = z.infer<typeof cancelDeskReservationOutputSchema>;

/**
 * The holder cancels today's and future reservations; `PAST_DATE` for an
 * earlier one unless the caller is an admin, who may cancel any. Somebody
 * else's reservation is `FORBIDDEN` for a non-admin.
 */
export const cancelDeskReservationContract = authed
  .route({
    description:
      'Cancel one desk reservation. The holder may cancel today’s and future ones; an admin may cancel any, past ones included.',
  })
  .input(cancelDeskReservationInputSchema)
  .output(cancelDeskReservationOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'PAST_DATE'));

export const myDeskReservationSchema = deskReservationSchema.extend({
  deskCode: deskSchema.shape.code,
  zoneName: zoneSchema.shape.name,
  hiveName: hiveSchema.shape.name.nullable(),
});
export type MyDeskReservation = z.infer<typeof myDeskReservationSchema>;

export const myDeskReservationsOutputSchema = z.object({
  /** From `DESK_HISTORY_MONTHS` months before today on, ascending by date. */
  reservations: z.array(myDeskReservationSchema),
});
export type MyDeskReservationsOutput = z.infer<typeof myDeskReservationsOutputSchema>;

export const myDeskReservationsContract = authed
  .route({
    description: `The caller’s desk reservations by date: every future one and the past ones of the last ${DESK_HISTORY_MONTHS} months.`,
  })
  .input(noInputSchema)
  .output(myDeskReservationsOutputSchema);

// --- releases (permanent holder) --------------------------------------------

export const myDeskReleasesOutputSchema = z
  .object({
    deskId: idSchema,
    code: deskSchema.shape.code,
    /** Today and later, ascending. */
    releases: z.array(
      z.object({
        id: idSchema,
        date: dateOnlySchema,
        /** Who booked the released day, if anybody. */
        reservedByName: personNameSchema.nullable(),
      })
    ),
  })
  .nullable();
export type MyDeskReleasesOutput = z.infer<typeof myDeskReleasesOutputSchema>;

export const myDeskReleasesContract = authed
  .route({
    description:
      'The caller’s permanent desk and its upcoming released days, or null when the caller holds no permanent desk.',
  })
  .input(noInputSchema)
  .output(myDeskReleasesOutputSchema);

export const releaseDeskInputSchema = z.object({
  dates: z
    .array(dateOnlySchema)
    .min(1)
    .max(MAX_DESK_RELEASE_DATES)
    .refine(distinct, { error: 'dates must not contain duplicates' }),
});
export type ReleaseDeskInput = z.infer<typeof releaseDeskInputSchema>;

export const releaseDeskOutputSchema = z.object({
  /** Newly released days; days already released are skipped silently. */
  added: z.int().nonnegative(),
});
export type ReleaseDeskOutput = z.infer<typeof releaseDeskOutputSchema>;

export const releaseDeskContract = authed
  .route({
    description:
      'Release the caller’s permanent desk on 1–60 dates (today or later) so others may book it.',
  })
  .input(releaseDeskInputSchema)
  .output(releaseDeskOutputSchema)
  .errors(contractErrors('NO_PERMANENT_DESK', 'PAST_DATE'));

export const cancelDeskReleaseInputSchema = z.object({ releaseId: idSchema });
export type CancelDeskReleaseInput = z.infer<typeof cancelDeskReleaseInputSchema>;

export const cancelDeskReleaseOutputSchema = z.object({ releaseId: idSchema });
export type CancelDeskReleaseOutput = z.infer<typeof cancelDeskReleaseOutputSchema>;

/** Somebody else's release is `FORBIDDEN`. */
export const cancelDeskReleaseContract = authed
  .route({
    description:
      'Withdraw one released day of the caller’s permanent desk, unless somebody booked it.',
  })
  .input(cancelDeskReleaseInputSchema)
  .output(cancelDeskReleaseOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'DESK_RELEASE_ALREADY_RESERVED'));
