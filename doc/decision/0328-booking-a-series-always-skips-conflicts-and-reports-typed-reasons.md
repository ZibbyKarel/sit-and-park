# 0328 – Booking a series always skips conflicts and reports typed reasons

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source has a strict all-or-nothing booking and a skip mode, with different wording for the same failures and Czech free text as the reason.

## Decision

Booking always uses skip semantics. Free days are booked; the others are returned with a reason code from a closed enum. A preview procedure returns the same plan. Shape errors (count, duplicates, span) and desk-level blockers (inactive, no access, caller holds a permanent desk) fail the whole call with a typed error. If no day is free the call fails. Past days are skipped with a reason, not failed.

## Consequences

- One code path serves preview, booking and approval; there is no strict variant to drift.
- Reasons are enums and the copy lives in i18n (Czech first).
- A client that wants all-or-nothing checks `skipped` itself.

## If wrong

A reason enum value renamed later is a contract change; a missing one is added alongside the others.
