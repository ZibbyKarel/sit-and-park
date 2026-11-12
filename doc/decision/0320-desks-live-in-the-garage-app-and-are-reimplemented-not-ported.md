# 0320 – Desks live in the garage app and are reimplemented, not ported

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

A colleague's desk-booking app (Convex, TanStack Start, shadcn/Tailwind, Convex Auth, generated on the Macaly platform) was shared as a zip. Garage needs the same feature, under Okta, in the existing stack.

## Decision

Desks are built inside garage, reimplemented in its stack (Prisma, oRPC contract-first, `@shoptet/ui`). Taken from the source: the floor plan (`floorplan.svg`, 221 desks, 12 zones) and the business rules. Dropped: all of its code, its auth, its parking feature, its seed (stale), its dead MCP tables and its Macaly e-mail notifications. The zip is untrusted and was read, never run.

## Consequences

- Every desk feature of the source is implemented, in garage's idiom; nothing is copied verbatim.
- The rules are documented in `doc/desk-merge-plan.md` and then `doc/desks.md`, so the source is not needed again.

## If wrong

Nothing here is irreversible, but a rule misread from the source ships as garage behaviour. The open questions for the colleague in the plan are where that risk sits.
