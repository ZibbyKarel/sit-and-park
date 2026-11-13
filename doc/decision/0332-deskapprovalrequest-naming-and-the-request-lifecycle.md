# 0332 – `DeskApprovalRequest` naming and the request lifecycle

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source calls the model `approvalRequests`. Garage will have other things to approve before it has budget for a rename.

## Decision

The model is `DeskApprovalRequest`. Status is `PENDING`, `APPROVED` or `REJECTED`, with `decidedById` and `decidedAt`. A request cancelled by its author is deleted; a decided request is kept as history. A request is for one date and only for a desk in a hive the user cannot book directly; a directly bookable desk is refused with `VALIDATION_FAILED`. The hive owner or any admin decides; approval re-checks every booking rule and the requester's state, rejection is always possible.

## Consequences

- An admin sees every pending request, including hives they do not own.
- Orphaned requests are rejected, not left pending (0327).

## If wrong

Deleting cancelled requests loses their trace; a `CANCELLED` status would be an enum addition.
