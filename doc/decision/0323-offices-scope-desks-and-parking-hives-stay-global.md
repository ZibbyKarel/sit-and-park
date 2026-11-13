# 0323 – Offices scope desks and parking; an admin does not bypass the office for booking; hives stay global

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source scopes desks to an office and says that a desk of another office is never directly accessible, admin included. Hives are not office-scoped. Garage has one implicit office.

## Decision

`Office` is a table; `User.officeId` and `ParkingSpot.officeId` (required, backfilled) and `Desk.officeId` reference it. A user sees and books desks and spots of their own office only. An admin does not bypass this for booking, but administers every office. Hives are global: a hive may own desks of several offices and its members are not tied to one.

## Consequences

- One office, `Praha`, is created by the migration; existing users and spots are backfilled to it.
- Parking gains an office filter (a later stage); the booking rules are otherwise unchanged.
- Changing a desk's office orphans its future reservations and pending requests, which the same transaction cancels or rejects (0327).

## If wrong

Making hives office-scoped later is a migration of `Hive` and `HiveMembership`; dropping the admin restriction is one condition in the shared access function.
