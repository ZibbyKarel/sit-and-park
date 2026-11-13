# 0333 – An admin may change the proposed parking spot in a bulk confirm

**Date:** 2026-11-13 · **Status:** accepted · **Task:** TODO item 10 · **Partly supersedes:** `doc/decision/0019-*`

## Context

`confirmBulk` takes the same input as `previewBulk` (`{ dates }`) and the server re-allocates every day from scratch (0019). That was right while the preview was a proposal nobody could edit. An admin booking on behalf of someone needs to pick a different spot for a day than the allocator proposed, and the desk bulk modal already offered a per-day desk select.

## Decision

- `confirmBulkInputSchema` gains an optional `spotChoices: { date, parkingSpotId }[]`. Each date is unique and must be one of `dates`.
- Only an admin may send a non-empty `spotChoices`; anyone else gets `FORBIDDEN` (`assertMayChooseBulkSpots`, checked first).
- In the allocator, a day prefers the choice, then the preferred spot, then the first free spot. A choice is honoured only when that spot is still free and allocatable inside the transaction. Otherwise the day is allocated normally: no new error code and no new per-day outcome. The result shows the spot actually given, as before.
- `previewBulk` returns `freeSpots: { date, spots: { id, label }[] }[]` so the modal can offer a select per day.
- The web modal sends only the days the admin changed. For a non-admin the select is shown disabled and prefilled. Desks keep their own rules (0321); only the existing desk select is disabled for non-admins.

## What this changes in 0019

The confirm no longer receives nothing of the plan: it receives an admin's explicit spot picks. The server still never trusts the rest of the plan (statuses, positions, preferred flags); every day is re-derived from rows read in the transaction, and a stale pick silently falls back to normal allocation.

## Consequences

- Preview stays a proposal; free spots listed in it are not held.
- A stale choice is not an error, so the admin may get a different spot than picked; the confirm result shows the real one.
- Retries carry the same choices.

## If wrong

If admins need to know a pick was dropped, add an explicit per-day flag to the result rather than an error code.
