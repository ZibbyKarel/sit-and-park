# Desk merge — handoff

Resume file for the overnight run that implements [`desk-merge-plan.md`](desk-merge-plan.md).
Read this first; it is updated after every stage.

## Where things are

- Worktree `worktrees/desk-merge`, branch `desk-merge`. Nothing is pushed or merged.
- The worktree's `.env` points at its **own database `garage_desk`** (same
  Postgres container as `garage`), so migrations here do not touch the main
  checkout's dev database. `docker compose --profile dev up -d` runs from the
  repository root.
- Scratch (session-local, may be gone):
  `/private/tmp/claude-501/-Users-zibar-Workspace-shoptet-garage/5c1a8667-61b1-422d-b6e8-29f2ad0b056e/scratchpad/`
  - `desk-src/` — the extracted source zip (untrusted; read, never run)
  - `desk-src-report.md` — full analysis of the source app (rules, messages, screens, SVG)
  - `garage-map.md` — garage's conventions and guard tests a big feature trips
  If it is gone, the zip is Slack file `F0CGZ9G0NKV`.

## Baseline (main @ af4a034, 2026-11-12)

`pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0. `api:test-db`: 12 suites / 174 tests pass.

## Stage status

| Stage | State | Commit | Verified |
| --- | --- | --- | --- |
| 1 Decisions and spec | done (records 0320-0332; `doc/desks.md` still to write, stage 9) | ca16e2f | prettier |
| 2 Data model | done | 44e00bf | migrate deploy on existing + empty DB, seed x2, `database:test` 181 pass |
| 3 Contract | done | 44e00bf | contract 549 tests, shared-types 202, `web:typecheck` green |
| 4 Desk API | done (4.0 unblock, 4A `desks/`, 4B `desk-admin/`) | 6794744, b1488a6 | api: 1026 unit, 216 db tests; lint, typecheck, build green |
| 5 Employee sync | done (`employee-sync/`, `doc/employee-sync.md`) | b1488a6 | unit + db suite + HTTP test |
| 6 Offices for parking | done (`common/office-scope.ts`) | b1488a6 | `parking-offices.db.spec.ts` |
| 7 Web | done against the contract: nav, `/desks`, `/desks/my`, admin tabs (desks, stats, hives, offices, sync) | ee8a34f, b1488a6 | web unit tests only; first live run is stage 9a |
| 8 Notifications and calendar | done (Slack DMs for approval, desk events in ICS) | b1488a6 | unit + db |
| 9 E2E and docs | in progress: 9a = live smoke + Playwright specs (running); two read-only reviews of the API running | | |

## Next step

1. Apply the findings of the two reviews (API correctness; sync/deactivation/office-scope security) and of the 9a live run.
2. Small contract gap from 7b: `desk.directory` desks lack `myPendingRequestId`, so the dialog offers "request approval" twice (server refuses the duplicate).
3. Stage 9b docs: `doc/desks.md`, `README.md`, `CLAUDE.md` counts (decision records, db suites, e2e counts), `doc/frontend.md`/`api-modules.md` rows, `graphify update .` (the worktree has no graph; run in the main checkout after merge).
4. Final full verification, final handoff, report to the user.

## Open product questions (for the user)

- The ICS calendar is still named "Parkování" although it now contains desks.
- Desks can be booked on weekends/holidays (source behaviour; parking refuses them).
- Admin desk screens are tabs of `/admin`, not separate routes.
- A user with `officeId = null` sees parking spots of every office.
- Sync pre-creates new employees with `oktaId = "hibob:<id>"`; first Okta login adopts the row by email.

## Notes for whoever resumes

- Agents get a shared brief: `SCRATCH/agent-brief.md`; they never commit, the orchestrator does.
- The Prisma client is committed (`libs/garage/database/src/generated`); regenerate after schema changes.
- A JIT-provisioned user has `officeId = null` until stage 5/6 assigns the default office.
- `reset-e2e.ts` does not clean desk tables yet (stage 9).
- Seed: `desk@example.com` holds permanent desk D-013; hives Engineering (D-037..042, owner admin) and Sales (D-013..018).
