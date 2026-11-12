# 0327 – Desk and hive changes cancel or reject what they orphan

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

In the source, deactivating a desk, changing its hive or office, assigning a permanent holder or deleting a hive leaves reservations and pending requests that nobody can honour or decide.

## Decision

The same transaction that makes the change repairs its consequences:

| Change | Also does |
| --- | --- |
| Desk deactivated | Cancels future reservations, rejects pending requests |
| Desk office changed | Cancels future reservations, rejects pending requests |
| Desk hive changed | Rejects pending requests |
| Permanent holder set | Cancels other people's future reservations of the desk and the new holder's future reservations elsewhere |
| Permanent holder changed or cleared | Deletes release days nobody booked |
| Hive deleted | Rejects pending requests of its desks |

## Consequences

- Each cancellation and rejection is audited.
- Past reservations are never touched.

## If wrong

Someone loses a reservation they expected. The alternative, refusing the change while anything is orphaned, would make admin edits unusable.
