# 0329 – Users are deactivated, never deleted; deactivation applies to the whole app

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source hard-deletes users in one place and deactivates them in another, which loses history. Garage's guard already reads `User.active`.

## Decision

A user is never deleted. Deactivation sets `active = false` and `deactivatedAt`, and applies to the whole app, desks and parking alike: future desk and parking reservations are cancelled, waitlist entries removed and pending desk requests rejected. Owned hives and a permanent desk produce warnings in the result; they are not changed automatically. A deactivated user cannot sign in; history keeps showing the name.

## Consequences

- No hard-delete procedure exists.
- Reactivation restores access, not the cancelled reservations.
- Garage's own deactivation of a parking user now has desk side effects.

## If wrong

A legal erasure request would need a separate anonymisation step on the retained rows.
