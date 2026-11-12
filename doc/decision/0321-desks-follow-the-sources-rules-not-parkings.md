# 0321 – Desks follow the source's rules, not parking's reservation window, quota or waitlist

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

Parking has a rolling reservation window, a monthly cap and a waitlist. The desk source has none of them: a series spans at most 34 days from its first date, there is no horizon relative to today, and a taken desk is simply taken.

## Decision

Desk booking follows the source. A series is 1–20 distinct dates, the last at most 34 days after the first, today allowed. There is no reservation window, no quota and no waitlist for desks. The parking window settings do not apply to desks.

## Consequences

- Desk and parking share no booking code beyond the generic infrastructure (audit, realtime, Slack, ICS).
- A person can book a desk 34 days ahead while parking would refuse the same date.

## If wrong

A window or quota for desks later needs a setting and a rule per desk office; adding one is additive. Adding a waitlist is the expensive one, because the unique-per-(desk, date) model assumes none.
