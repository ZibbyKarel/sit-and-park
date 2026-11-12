# 0322 – A hive owner is `Hive.ownerId`, not a role

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

In the source a hive owner is a user referenced by `hives.ownerId`; the admin flag is the only role. Garage has roles `USER` and `ADMIN`.

## Decision

Roles stay `USER` and `ADMIN`. A hive owner is whoever `Hive.ownerId` points to. The owner's only power is deciding approval requests for desks of that hive; an admin decides any request.

## Consequences

- No role migration, no new guard: owner checks are a comparison of the caller with `Hive.ownerId`.
- Deleting or deactivating the owner leaves a hive nobody but an admin can serve; deactivation reports it as a warning (0329).
- One owner per hive until the colleague answers whether more are wanted.

## If wrong

Several owners per hive would need a join table replacing `ownerId`, a migration and a contract change.
