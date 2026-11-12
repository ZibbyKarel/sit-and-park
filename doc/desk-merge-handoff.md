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
| 4 Desk API | in progress: 4.0 unblocking API compile (audit payloads, `me.get`, gateway, parity list) | | |
| 5 Employee sync | pending | | |
| 6 Offices for parking | pending | | |
| 7 Web | in progress: `FloorPlan` done (17f8fdd, not browser-tested); desks day screen (7b) and my-desks (7c) running | | |
| 8 Notifications and calendar | pending | | |
| 9 E2E and docs | pending | | |

## Next step

After 4.0 is green: launch 4A (desk core: rules, directory, reserve, cancel, releases, approval), 4B (admin desks/hives/offices/zones/stats + stage 6 parking offices) and stage 5 (employee sync) in parallel. Then 7d admin web, 8, review, 9.

## Notes for whoever resumes

- Agents get a shared brief: `SCRATCH/agent-brief.md`; they never commit, the orchestrator does.
- The Prisma client is committed (`libs/garage/database/src/generated`); regenerate after schema changes.
- A JIT-provisioned user has `officeId = null` until stage 5/6 assigns the default office.
- `reset-e2e.ts` does not clean desk tables yet (stage 9).
- Seed: `desk@example.com` holds permanent desk D-013; hives Engineering (D-037..042, owner admin) and Sales (D-013..018).
