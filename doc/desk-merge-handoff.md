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
| 1 Decisions and spec | pending | | |
| 2 Data model | pending | | |
| 3 Contract | pending | | |
| 4 Desk API | pending | | |
| 5 Employee sync | pending | | |
| 6 Offices for parking | pending | | |
| 7 Web | pending | | |
| 8 Notifications and calendar | pending | | |
| 9 E2E and docs | pending | | |

## Next step

Stage 2 and 3 in parallel, Stage 1 docs alongside.

## Notes for whoever resumes

(none yet)
