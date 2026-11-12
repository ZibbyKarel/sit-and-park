# 0330 – Employee sync: endpoint outside oRPC, key hash from the environment, dry-run default, shrink protection, manual accounts

**Date:** 2026-11-12 · **Status:** accepted · **Task:** desk merge (`doc/desk-merge-plan.md`)

## Context

The source accepts an employee list over `POST /api/employee-sync`, authenticated by a SHA-256 secret hash stored in the database, with a live-mode switch and a run log. The caller is an external system, not a browser.

## Decision

- `POST /api/employee-sync` is a plain Nest route outside oRPC: `@Public()`, a strict throttle and a bearer key.
- Only the key's SHA-256 is known to the server, via `EMPLOYEE_SYNC_KEY_SHA256`; unset means 503. No secret is stored in the database.
- The whole list is validated before anything is written. An empty list, or one below 90 % of the active synced users, is rejected.
- Dry-run unless `EmployeeSyncSettings.liveMode`; every run, accepted or rejected, is logged in `EmployeeSyncRun`.
- Users outside `@team.blue` or with `manualAccount` are never touched.

## Consequences

- Deactivation follows 0329; the response and log carry the same summary.
- Rotating the key is an environment change and a restart.

## If wrong

A bad feed that stays above 90 % still deactivates people in live mode; the dry-run log is the check, and reactivation is a manual step.
