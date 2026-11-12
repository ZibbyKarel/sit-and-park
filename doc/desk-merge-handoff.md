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
| 9 E2E and docs | done: five desk Playwright specs, desk cleanup in `reset-e2e.ts`, docs, a web review and its fixes | b594bb7 and the commit after it | see below |

## Final verification (2026-11-13, about 01:00)

`pnpm lint`, `typecheck`, `test`, `build` and `nx format:check --all` exit 0.
`api:test-db` 16 suites / 233 tests. `api-e2e:e2e` 2 suites / 11 tests.
`CI=true web-e2e:e2e` 61 passed (52.4 s). Ports 3000 and 4200 free afterwards.

## What is left

Nothing in the plan is unimplemented. Known gaps, none of them blocking:

- `graphify update .` has not run (the worktree has no graph); run it in the
  main checkout after the merge.
- `@shoptet/ui`'s `useScreenHasMinWidth` reads `window` at module load, so the
  web server logs `ReferenceError: window is not defined` during SSR (React
  #419 in the browser). It predates this branch (parking pages do it too).
- Floor plan: the default view now covers the viewport's shorter axis, so on a
  desktop about half of the plan is visible and the rest is panned to. On a
  phone the top navigation wraps into a column.
- The modal close button of `@shoptet/ui` has no accessible name; the stats
  progress bar shows a full grey track at 0 %.
- Review leftovers recorded in `doc/open-items.md`: realtime desk events are
  not office-scoped, a deactivated user's open socket is not dropped, the sync
  endpoint parses up to 2 MB before checking the bearer key.

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
- Seed: `desk@example.com` holds permanent desk D-013; hives Engineering (D-037..042, owner admin) and Sales (D-013..018).
