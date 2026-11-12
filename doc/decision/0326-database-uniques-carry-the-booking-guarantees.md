# 0326 – Database uniques carry the booking guarantees

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source enforces uniqueness only in code, which held because Convex mutations are serialisable. Postgres is not.

## Decision

Constraints in the database carry the rules: unique (`deskId`, `date`) and (`userId`, `date`) on reservations; unique `HiveMembership.userId`; unique `Desk.permanentAssigneeId`; a hand-written partial unique index on `DeskApprovalRequest` (`deskId`, `userId`, `date`) where `status = 'PENDING'`; unique (`deskId`, `date`) on releases. Transactions additionally lock the desk row (`SELECT … FOR UPDATE`).

## Consequences

- A race loses with a unique violation that the service maps to a typed error, never to a duplicate row.
- The partial index is SQL Prisma cannot express, so it lives in a hand-written migration.
- Concurrency is covered by the database suites, not by `pnpm test`.

## If wrong

Dropping a unique silently re-opens the double booking; the constraints are the cheapest part of the model to keep.
