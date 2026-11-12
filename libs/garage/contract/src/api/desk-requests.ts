/**
 * Approval requests: booking a hive desk the caller has no direct access to,
 * for one date. The hive owner or any admin decides.
 */

import * as z from 'zod';
import { DESK_HISTORY_MONTHS } from '@garage/shared-types';
import {
  deskApprovalRequestSchema,
  deskReservationSchema,
  deskSchema,
  hiveSchema,
  userSchema,
  zoneSchema,
} from '../schemas/entities';
import { dateOnlySchema, idSchema } from '../schemas/primitives';
import { authed, contractErrors, noInputSchema } from './builder';

export const requestDeskApprovalInputSchema = z.object({
  deskId: idSchema,
  date: dateOnlySchema,
});
export type RequestDeskApprovalInput = z.infer<typeof requestDeskApprovalInputSchema>;

/**
 * `VALIDATION_FAILED` is a desk that cannot be requested: no hive, another
 * office, or one the caller may book directly. `DESK_NOT_AVAILABLE` is an
 * inactive desk, or a permanent one not released that day.
 */
export const requestDeskApprovalContract = authed
  .route({
    description:
      'Ask the hive owner (or an admin) to let the caller book a hive desk for one date. Only for a hive desk of the caller’s office the caller cannot book directly.',
  })
  .input(requestDeskApprovalInputSchema)
  .output(deskApprovalRequestSchema)
  .errors(
    contractErrors(
      'NOT_FOUND',
      'PAST_DATE',
      'NO_OFFICE_ASSIGNED',
      'PERMANENT_DESK_HOLDER',
      'DESK_NOT_AVAILABLE',
      'DESK_RESERVATION_LIMIT_REACHED',
      'DESK_ALREADY_RESERVED',
      'DESK_REQUEST_ALREADY_PENDING',
      'VALIDATION_FAILED'
    )
  );

export const cancelDeskRequestInputSchema = z.object({ requestId: idSchema });
export type CancelDeskRequestInput = z.infer<typeof cancelDeskRequestInputSchema>;

export const cancelDeskRequestOutputSchema = z.object({ requestId: idSchema });
export type CancelDeskRequestOutput = z.infer<typeof cancelDeskRequestOutputSchema>;

/** Deletes the request. Somebody else's is `FORBIDDEN`. */
export const cancelDeskRequestContract = authed
  .route({ description: 'Withdraw one of the caller’s pending approval requests.' })
  .input(cancelDeskRequestInputSchema)
  .output(cancelDeskRequestOutputSchema)
  .errors(contractErrors('NOT_FOUND', 'DESK_REQUEST_ALREADY_DECIDED'));

export const myDeskRequestSchema = deskApprovalRequestSchema.extend({
  deskCode: deskSchema.shape.code,
  zoneName: zoneSchema.shape.name,
});
export type MyDeskRequest = z.infer<typeof myDeskRequestSchema>;

export const myDeskRequestsOutputSchema = z.object({
  /** The caller's requests dated from `DESK_HISTORY_MONTHS` months before today on, newest date first. */
  requests: z.array(myDeskRequestSchema),
});
export type MyDeskRequestsOutput = z.infer<typeof myDeskRequestsOutputSchema>;

export const myDeskRequestsContract = authed
  .route({
    description: `The approval requests the caller filed, in any status: every future one and the past ones of the last ${DESK_HISTORY_MONTHS} months.`,
  })
  .input(noInputSchema)
  .output(myDeskRequestsOutputSchema);

export const pendingDeskRequestSchema = deskApprovalRequestSchema.extend({
  deskCode: deskSchema.shape.code,
  zoneName: zoneSchema.shape.name,
  hiveId: idSchema,
  hiveName: hiveSchema.shape.name,
  requesterName: userSchema.shape.name,
});
export type PendingDeskRequest = z.infer<typeof pendingDeskRequestSchema>;

export const pendingDeskRequestsOutputSchema = z.object({
  requests: z.array(pendingDeskRequestSchema),
});
export type PendingDeskRequestsOutput = z.infer<typeof pendingDeskRequestsOutputSchema>;

/** An admin sees every pending request; a hive owner those of their hives. */
export const pendingDeskRequestsContract = authed
  .route({
    description:
      'The caller’s inbox: pending approval requests the caller may decide (as owner of the desk’s hive, or as an admin).',
  })
  .input(noInputSchema)
  .output(pendingDeskRequestsOutputSchema);

export const decideDeskRequestInputSchema = z.object({
  requestId: idSchema,
  approve: z.boolean(),
});
export type DecideDeskRequestInput = z.infer<typeof decideDeskRequestInputSchema>;

export const decideDeskRequestOutputSchema = z.object({
  request: deskApprovalRequestSchema,
  /** The reservation an approval created; `null` for a rejection. */
  reservation: deskReservationSchema.nullable(),
});
export type DecideDeskRequestOutput = z.infer<typeof decideDeskRequestOutputSchema>;

/**
 * Rejection always succeeds on a pending request. Approval re-checks every
 * booking rule for the requester; `VALIDATION_FAILED` is a requester who is no
 * longer active or in the desk's office, or a desk no longer in a hive.
 * A caller who neither owns the desk's hive nor is an admin gets `FORBIDDEN`.
 */
export const decideDeskRequestContract = authed
  .route({
    description:
      'Approve or reject one pending approval request. Approval books the desk for the requester after re-checking every booking rule.',
  })
  .input(decideDeskRequestInputSchema)
  .output(decideDeskRequestOutputSchema)
  .errors(
    contractErrors(
      'NOT_FOUND',
      'DESK_REQUEST_ALREADY_DECIDED',
      'PAST_DATE',
      'PERMANENT_DESK_HOLDER',
      'DESK_NOT_AVAILABLE',
      'DESK_RESERVATION_LIMIT_REACHED',
      'DESK_ALREADY_RESERVED',
      'VALIDATION_FAILED',
      'CONFLICT'
    )
  );
