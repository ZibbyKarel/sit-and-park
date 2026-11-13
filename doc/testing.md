# Testing

Four test layers, three runners, and the last three layers need Docker or a database. This page says what each layer is for, how to run it, and what has to be up first. CI runs all of them (`.github/workflows/ci.yml`: `verify`, `database`, `e2e`, `images`; see `doc/workspace.md`).

## The layers

| Layer                  | Where                                                           | Runner                           | Needs |
| ---------------------- | --------------------------------------------------------------- | -------------------------------- | ----- |
| **Unit**               | `**/*.spec.ts(x)` in every project except the two `*-e2e` apps  | Jest, `nx run <project>:test`    | nothing |
| **Database**           | `apps/sit-and-park/api/**/*.db.spec.ts`                         | Jest, `nx run api:test-db`       | PostgreSQL, `DATABASE_URL` |
| **API end-to-end**     | `apps/sit-and-park/api-e2e/src/**/*.spec.ts`                    | Jest + axios, `nx run api-e2e:e2e` | PostgreSQL, the OIDC issuer |
| **Browser end-to-end** | `apps/sit-and-park/web-e2e/src/**/*.spec.ts`                    | Playwright, `nx run web-e2e:e2e` | PostgreSQL, the OIDC issuer |

The layers are cumulative, not redundant. Put a test in the cheapest layer that can fail for the right reason:

- **Unit:** a decision, a mapping, a rendering. No process, no socket, no database. Most of the suite lives here.
- **Database (`*.db.spec.ts`):** anything whose correctness is the database: a unique constraint, `SELECT ... FOR UPDATE`, a transaction's rollback, two concurrent writers racing, a trigger. Transactional logic is never tested against mocks, because faking protocol is how defects ship.
- **API end-to-end:** what the API does over real HTTP to a request a browser would never send: no `Authorization` header, a token from another issuer, a scheme that is not `Bearer`, the ICS feed with a wrong token. `web-e2e` always arrives with a valid session, so it structurally cannot ask these questions.
- **Browser end-to-end:** a whole user journey across both apps, the database and the socket. It is expensive and reserved for claims no lower layer can make: two people disagreeing over the same bay, a setting saved on one screen changing another, a URL that stops answering. A rule the lower layers already settle (the monthly cap arithmetic, the `FORCE_LOCKED` lockdown, decided in `monthly-reservation-cap.ts` and `reservation-policy.ts`) is not re-tested through a browser.

Also guarded by unit specs and worth knowing: the Czech/English message parity (`apps/sit-and-park/web/messages/messages.spec.ts`), the contract's procedure and error-code lists (`libs/sit-and-park/contract/src/api/router.spec.ts`), the oRPC route parity spec in the API (`orpc-route-parity.spec.ts`: every procedure has a route, every admin route a guard), and `no-orpc.spec.ts` in the realtime contract (`doc/contract.md`).

## What has to be running

```bash
docker compose --profile dev up -d     # PostgreSQL 17 (5432), mock-oauth2-server (8080), adminer (8081)
cp .env.example .env
cp .env.example apps/sit-and-park/web/.env   # Next.js reads its own directory
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
```

`.env` is git-ignored and does not travel with a git worktree: copy it in. A missing or wrong `DATABASE_URL` is the usual cause of a `P1000` from anything Prisma. In a worktree also run `pnpm install` first. `prisma migrate reset` destroys the database and is not part of any routine; if the schema is behind, `prisma migrate deploy` is the command.

| Port   | What |
| ------ | ---- |
| `3000` | the API (`PORT` in `.env`; Nx injects it into every target) |
| `4200` | the web app. `web:dev` is pinned to `--port 4200` because `CORS_ALLOWED_ORIGINS` and the OIDC redirect URI name it |
| `5432` | PostgreSQL |
| `8080` | `mock-oauth2-server` |

The API's probes are `/health/live` and `/health/ready`, not under `/api`; the oRPC transport is at `/api/rpc/...`.

## Running each layer

### Unit

```bash
pnpm test                              # nx run-many -t test, everything
pnpm nx run web:test                   # one project
pnpm nx run web:test -- lot-view       # one file, by name pattern
pnpm nx run web:test -- --coverage
```

No Docker. `api:test` excludes `*.db.spec.ts` (`apps/sit-and-park/api/jest.config.cts`), so `pnpm test` does not exercise the database suites: a change to `SELECT ... FOR UPDATE`, transaction isolation or waitlist promotion is untested until `api:test-db` has run. Jest environments by project: `node` for the API and most libs; `jsdom` for `libs/shared/form`, `libs/shared/i18n` and `libs/sit-and-park/realtime-client`; the web app uses its own `jest-environment-web.cjs` through `next/jest`.

ESM-only packages (`@orpc/*`, `@nestjs/config`, `@nestjs/passport`, `jose`, `next-intl`) are transpiled through `buildTransformIgnorePatterns` in the root `jest.preset.js`; a plain `/node_modules/(?!pkg/)` pattern never matches pnpm's nested `.pnpm/<name>@<version>/node_modules/<name>` layout. The web app overwrites Next's resolved `transformIgnorePatterns` because the array is a union that Next's own entry already makes match everything but `geist`.

### Database

```bash
pnpm nx run api:test-db
```

This runs the `*.db.spec.ts` suites under `apps/sit-and-park/api/jest.database.config.cts` with `--runInBand` (`maxWorkers: 1`, 20 s test timeout). It needs PostgreSQL up and `DATABASE_URL` set. In the repository root Nx supplies `DATABASE_URL` from `.env`; in a worktree `.env` is not there, so copy it in or pass the one variable:

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' /path/to/main-checkout/.env | sed 's/^DATABASE_URL=//') pnpm nx run api:test-db
```

The target does not skip itself: without `DATABASE_URL` it fails before reaching a test, which is what makes an unreachable Postgres fail CI instead of silently passing.

**The suites never touch the seeded dev database.** `globalSetup` (`src/testing/database/global-setup.ts`) creates a throwaway database named `sit_and_park_dbspec_<id>`, applies the committed migrations to it as plain SQL (the real files, so a schema change that would break production breaks this suite), and repoints `DATABASE_URL` at it; `globalTeardown` drops it. Concurrency tests must really commit, or there is no race, and the residue of committing cannot be cleaned (the `AuditLog` table rejects `DELETE` by trigger and fixture users are pinned by `ON DELETE RESTRICT`), hence a whole database rather than a rollback. A run killed mid-way leaves its database behind; the next run drops leftovers with the prefix that are old enough that no live run could be using them.

Areas covered: reservations, waitlist and promotion, bulk allocation and its deadlock ordering, the monthly cap, timed reservations, desks (series, unique indexes and locks under races, permanent desks and releases, approval requests, bulk), desk admin cascades, employee sync (live and dry run, shrink protection, clean-up on deactivation, the email lower-casing migration), parking scoped to the user's office, Slack delivery, calendar, and the database contract itself.

`nx run database:check-schema` (CI's `database` job) guards `schema.prisma`: it runs `prisma migrate status`, `prisma migrate diff ... --exit-code`, `prisma generate` and `git diff --exit-code` on the generated client, because the parity specs compare artefacts derived from the schema and would otherwise pass against a stale generation.

### API end-to-end

```bash
pnpm nx run api-e2e:e2e
```

Runs `jest --runInBand` in `apps/sit-and-park/api-e2e` after `api:build` and `api:serve` (Nx starts the API and waits for the port). There is deliberately no `--passWithNoTests`: a suite that only asserts refusals cannot be trusted to notice its own files stopping matching. The specs mint real tokens from the mock issuer (`src/support/oidc-token.ts`). The `globalTeardown` calls `killPort(3000)`, so:

- an `api:serve` you already have running is taken down when this target finishes;
- if another Nx invocation holds the `api:serve` lock, the run sits at "Waiting for api:serve in another nx process" and eventually fails in `globalSetup` with an `AggregateError` from `waitForPortOpen`. Stop the other one; if its Nx wrapper died untidily, `pnpm nx reset` clears the lock.

To run against an API you are already serving, run Jest directly (same teardown caveat): `cd apps/sit-and-park/api-e2e && pnpm exec jest --runInBand`.

### Browser end-to-end

```bash
pnpm nx run web-e2e:e2e                              # the whole suite
pnpm nx run web-e2e:e2e -- src/cell-lock.spec.ts     # one spec
pnpm nx run web-e2e:e2e -- --headed --debug
CI=true pnpm nx run web-e2e:e2e --skip-nx-cache      # what CI runs
```

In a worktree the whole `.env` must be copied in, not just `DATABASE_URL`, or the API exits on its own env schema before a test runs. `nxE2EPreset` sets `workers: process.env.CI ? 1 : undefined`, so a local run is parallel and CI's is serial; the second command reproduces CI. Everything the suite needs it arranges:

1. **`globalSetup`** (`src/support/global-setup.ts`) throws without `DATABASE_URL`, then runs `prisma db seed` and `libs/sit-and-park/database/src/scripts/reset-e2e.ts` as subprocesses (the module boundary keeps `scope:web` out of `libs/sit-and-park/database`). The reset clears next month's reservations and queue entries and sets the reservation window to `AUTO` at 31 days (`MAX_OPEN_DAYS_BEFORE`), so the month the suite books into is genuinely open. It leaves that setting behind; `pnpm exec prisma db seed` puts it back to 7 days.
2. **The servers come from two places.** The API is started by Nx: `@nx/playwright` turns the `webServer` command naming `api:serve` into a task dependency, and Playwright adopts it (`reuseExistingServer: true`). Nothing set in `playwright.config.mts` reaches that process. The web app is started by Playwright as `pnpm exec next start --port 4200` in `apps/sit-and-park/web`, the built app, not `next dev` (`StrictMode` mounts effects twice and gives each page a second socket). The web build is an explicit `dependsOn` of `web-e2e:e2e`. `reuseExistingServer` is `false` for the web server, so an occupied 4200 stops the run with "is already used" instead of testing whatever is there.
3. **The `setup` project** signs three personas in through the real OIDC redirect (`support/auth.setup.ts`, `support/oidc-login.ts`) and caches their sessions in `apps/sit-and-park/web-e2e/.auth/` (git-ignored, rewritten each run). `build-identity.setup.ts` fails the run when the app answering on the base URL is not the build the workspace just produced (it compares `.next/BUILD_ID` with the served one).

Config facts (`apps/sit-and-park/web-e2e/playwright.config.mts`): Chromium only; `retries: 0` on purpose (a scenario that only passes on the second attempt is a bug report); `forbidOnly` in CI; locale `cs-CZ`, timezone `Europe/Prague`; `fullyParallel` from the preset, so tests inside one file run concurrently in separate workers.

**Exit 1 after a passing summary line is not a test failure.** Nx writes task history to a SQLite database under `.nx/`, and concurrent runs from several worktrees corrupt that write. Read the suite's own summary, not just `$?`.

**A run leaves ports 3000 and 4200 free.** If 4200 is still held afterwards, that is a regression in the teardown, not housekeeping. Before a run:

```bash
lsof -ti tcp:3000 tcp:4200 | xargs kill -9
```

### Personas

Defined in `src/support/personas.ts`; the role is a database column and nothing in the token grants it. The mock issuer mints no `email`, so the login types the claims into its "Optional claims JSON" field (`doc/auth.md`).

| key        | email               | seeded as      | role  |
| ---------- | ------------------- | -------------- | ----- |
| `admin`    | `admin@example.com` | Dev Admin      | ADMIN |
| `user`     | `user@example.com`  | Dev User       | USER  |
| `user-two` | `user2@example.com` | Dev User Two   | USER  |

The seed also creates a `Dev Inactive` user, which the admin-users spec is allowed to mutate.

## Writing a browser spec

- **Take a day slot.** `support/dates.ts`'s `SPEC_DAY_SLOTS` gives each spec file one business day of the e2e target month (next month). A reservation is unique per `(spot, date)` and per `(user, date)`, so two files booking the same persona on the same day fail each other intermittently. Add an entry rather than reusing one. The slots are finite (the shortest target month has about nineteen business days); `e2eDayForSlot` throws when a slot runs past the month rather than wrapping onto a day another file owns, so the answer then is a second target month. Never write a literal date: it rots into a Saturday or a public holiday and every write is refused for a reason that has nothing to do with the test. Date arithmetic lives in `support/dates.ts`.
- **Global state is shared.** The reservation-window row is a singleton and the spot and user rosters are one set of rows for the whole run. A spec may touch them only in ways no other file can notice: `admin-window.spec.ts` moves between `AUTO` and `FORCE_OPEN` and never to `FORCE_LOCKED` or a lower `openDaysBefore`; `admin-users.spec.ts` mutates only `Dev Inactive`; `admin-spots.spec.ts` creates its own bay. Restore what you change in `afterAll` and tolerate a leftover on the way in, since a killed run skips teardown.
- **Tests within a file run concurrently**, so a test that mutates shared state needs its own bay (see `SPOTS` in `cell-lock.spec.ts`). A cell lock is acquired per user, so two tests on one bay renew and drop each other's hold.
- **Assert your own day, not "the feed" or "the list".** An assertion that reads global state and expects only its own writes races every other spec. Scope to the date, the row, the spot you own.
- **Address the UI as a person does:** role plus the Czech accessible name, read from `apps/sit-and-park/web/messages/cs.json`. There are no `data-testid` hooks and none are to be added.
- **Never wait on a clock.** Every wait is on a condition (`waitForURL`, `toPass`, retrying assertions); `waitForTimeout` passes on an idle laptop and fails on a busy one. The first visit to a route against a dev server compiles on demand, so `lot-page.ts` exports `FIRST_ROUTE_VISIT_TIMEOUT_MS` (30 s); reuse it.

### Journeys

| Spec | What it proves |
| ---- | -------------- |
| `login`, `identity` | an unauthenticated visitor is bounced to `/login`; the button starts a real authorization-code flow; the session is one the API accepts; sign-out re-protects the app, including that a session cookie kept from before sign-out is refused afterwards; each persona is the seeded person with the right role |
| `reservation`, `reservation-detail` | reserve a free bay, see own name and plate, survive a reload, cancel it; the detail view |
| `waitlist-promotion`, `waitlist-queue` | one books, another queues and sees a position, the first cancels and the bay is handed over with nobody clicking; queue behaviour |
| `cell-lock` | two users on one day: one opens a bay dialog and the other's tile hatches over live and stops being clickable; closing releases it; the holder never sees their own hold |
| `realtime-connection` | one document, one socket.io connection, asserted in the built app |
| `admin-reservation`, `admin-bulk-reservation` | an admin acts on someone else's bay and books in bulk on their behalf; a user gets no admin affordance |
| `admin-spots`, `admin-users`, `admin-window` | the admin tabs |
| `settings-profile`, `locale` | profile settings and the Czech/English switch |
| `ics-feed` | the calendar URL from the settings modal is fetched by a context that never signed in and contains the reservation; a wrong token is a 404 like any other; cancelling removes the event |
| `desks`, `desk-series`, `desk-approval`, `desk-release`, `desk-admin` | desk booking, series, approval requests, releases and desk admin, with the page object `support/desk-page.ts` |

## When it goes wrong

- **A stale server.** `reuseExistingServer` was once permissive and a `next start` left behind served the previous build, so a mutation of application source stayed green. It is now enforced by the web server's `reuseExistingServer: false` and the build-identity check. Nothing in a suite's output says it tested the wrong server, so kill 3000 and 4200 before believing a surprising result. The API is different: Nx starts it, so an API left running keeps the environment it was started with.
- **Everything 401s with `The token does not identify a provisionable user.`** The token has no `email` claim. The e2e login types one in; when signing in by hand type `{"email":"user@example.com","name":"Dev User"}` into the "Optional claims JSON" box.
- **Everything 401s with a bare `Unauthorized`.** The API cached a JWKS key the issuer no longer has. `mock-oauth2-server` re-mints its keys on container start, so after `docker compose restart mock-oauth2-server` restart the API.
- **Several unrelated specs fail with `Skupina IT` missing, or a bay never shows its holder.** Look for `"statusCode":429` on `/api/rpc/overview/day` in the API log. A run issues about 200 requests from one address and the default throttle is 300 per rolling minute (strict tier 20), so back-to-back runs can trip it. Nx starts the API, so an `env` block in the Playwright config cannot raise the limits. Start the API yourself first, and Playwright adopts it:

  ```bash
  lsof -ti tcp:3000 | xargs kill -9
  THROTTLE_LIMIT=10000 THROTTLE_STRICT_LIMIT=1000 pnpm nx run api:serve
  ```

  Or wait a minute between runs.
- **`cell-lock.spec.ts` fails because a tile reads `Volné`.** Something released the hold while the dialog was open. In order of likelihood: a test in that file shares a bay with another (use one bay per test); you are running against a dev server, whose `StrictMode` gives each page a second socket in the same room (let the suite start `next start`); another tab or a reloaded page of the same persona, because acquisition is per user and the connection that opened second can still release the hold (`doc/integrations.md`). Count `DOC` lines, not `OPEN` lines, in the realtime trace.
- **The sign-out test fails on its second `toHaveURL` with the app root.** A regression, not a known flake. Sign-out revokes the session server-side (`doc/auth.md`), and the deterministic spec "a session cookie kept from before sign-out is refused afterwards" is the one to look at first.
- **`auth.setup.ts` times out on `sign in as <persona>`.** The setup project signs three personas in concurrently against one mock issuer and the whole sign-in must fit in Playwright's 30 s test timeout. Try `--workers=1` on the setup project to see whether concurrency is the cause.
- **`P1000` from Prisma.** `DATABASE_URL` is missing or wrong (the git-ignored `.env`).

Diagnostics, both off by default: `E2E_TRACE_REALTIME=1` prints every `day:*` and `cell:*` packet each page sends or receives with a label for the page (worker and ordinal), plus every WebSocket it opens (`OPEN`), each document it loads (`LOAD`), and one `DOC <id> #<n>` line per socket a document constructed (a `DOC <id> #2` is a real duplicate connection; two `OPEN`s under one page are usually two page loads). The handshake token is not printed. `E2E_AUTH_LOG_DIR=/some/dir` makes `support/auth-network-log.ts` write the cookie names and a one-way digest of each value in order, never a token.

## Writing any test

- **Write it with the code it covers**, not afterwards. Jest for units on the API and the web, Playwright for journeys.
- **Break the thing it names and watch it go red.** A test that would still pass with its subject deleted reports coverage that does not exist. A guarantee asserted in three places and exercised by none (a redaction nobody reads the log of, a retry nobody removes) is the defect class to look for.
- **A flake is a bug.** Isolate it, run it twenty times, find the cause. Do not add a retry.
- **Reach for the cheapest layer** that can fail for the right reason. A rule belongs in a unit test; only a journey belongs in Playwright.
