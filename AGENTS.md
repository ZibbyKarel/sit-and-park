# AGENTS.md

Guidance for AI agents (and humans) working in this repository. This file holds only what changes
how you work. How each domain works is documented in [`doc/`](doc/README.md) — one file per
domain, each describing the current state only.

## Language

Everything is written in English by default — code, identifiers, comments and documentation
(`doc/`, this file). The one deliberate exception is **UI copy**, which is written in Czech,
because this is a Czech company's internal app and the interface language is a product decision,
not a documentation one.

Czech is the source of truth: `apps/sit-and-park/web/messages/cs.json` is where copy is written,
and its keys define what exists. English is a translation that sits alongside it (`en.json`), kept
in step by the parity guard at `apps/sit-and-park/web/messages/messages.spec.ts`. New copy is
written in Czech first and then translated — never English-first, and never by replacing a Czech
string with an English one. Details: [`doc/frontend.md`](doc/frontend.md).

## What this is

A company parking-reservation app (parking **and desks**): an Nx monorepo with a Next.js web app
(`apps/sit-and-park/web`) and a NestJS API (`apps/sit-and-park/api`), contract-first with oRPC and
Zod, the `@shoptet/ui` design system, realtime over Socket.io, and outbound Slack and ICS
integrations. Apps: `api`, `web`, `api-e2e`, `web-e2e`. `pnpm install` first — several agents have
skipped it in a fresh worktree and spent the next hour on spurious `Module not found` errors in
`api:build`.

**The workspace is built to host more than one application**, though `sit-and-park` is the only
one. `apps/` and `libs/` are namespaced by owner: `apps/sit-and-park/*` and `libs/sit-and-park/*`
belong to this app, `libs/shared/*` holds the three libs a second application would also consume
(`form`, `i18n`, `api-client`). A lib's namespace is decided by **how many applications consume
it**, not by how much code it holds — so `auth` and `shared-types` sit under `sit-and-park/`
despite looking generic. One known debt: `libs/shared/api-client` still imports this app's
contract at runtime; that has to be resolved before a second contract exists.

**Nx project names are flat**: `web`, `api`, `contract` and the rest are unprefixed, so
`pnpm nx run web:test` works from anywhere. They will not stay that way — project names are
globally unique, so a second application cannot own a project called `api` either. Every project
therefore also carries an **`app:` tag** — `app:sit-and-park` or `app:shared` — and that is what a
per-application command selects on: `nx run-many -t lint -p tag:app:sit-and-park`, never
`-p api,web`. The tag survives the rename; a list of project names does not. Every script in
`package.json` is workspace-wide; `pnpm dev` serves the `app:sit-and-park` api and web.

**When you move a project, grep for the string literals `'apps'` and `'libs'` too**, not only for
slash-separated paths. `join(root, 'libs', 'database')` survives a search-and-replace of
`libs/database` untouched and then fails somewhere far away — that is how `prisma.config.ts`, the
database suites' migrations directory and the e2e build-identity guard each broke once.

## Where things are documented

Check [`doc/README.md`](doc/README.md) first, then open the one file for your domain.

| Read                                         | Before you touch                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [`doc/README.md`](doc/README.md)             | anything — overview, glossary, package map                               |
| [`doc/workspace.md`](doc/workspace.md)       | repo layout, Nx, env vars, docker, ports, CI, commands                   |
| [`doc/backend.md`](doc/backend.md)           | API modules, operations, the database schema, constraints and migrations |
| [`doc/contract.md`](doc/contract.md)         | the Zod contract, procedures, error codes, realtime event schemas        |
| [`doc/auth.md`](doc/auth.md)                 | sign-in, tokens, refresh, revocation, JWKS validation, roles             |
| [`doc/frontend.md`](doc/frontend.md)         | the web app, `@shoptet/ui`, the wrapper libs, i18n and Czech copy        |
| [`doc/parking.md`](doc/parking.md)           | reservation rules, the window, waitlist, bulk booking                    |
| [`doc/desks.md`](doc/desks.md)               | desk booking, series, approval, the floor plan                           |
| [`doc/integrations.md`](doc/integrations.md) | realtime and cell locks, Slack, the ICS feed, employee sync              |
| [`doc/admin.md`](doc/admin.md)               | the admin screens and what an admin may do                               |
| [`doc/testing.md`](doc/testing.md)           | test layers, what each covers and what has to be running                 |

## Commands

Every command below was run in this repository and exited 0, with one stated exception
(`web-e2e:e2e`, below). When you add one here, run it first — a command that was true when it was
written and is false now is worse than an absent one, because a reader trusts it.

```bash
pnpm install                 # always, in a fresh worktree, before anything else

pnpm dev            # serve,dev for this app's api and web — continuous
pnpm lint           # nx run-many -t lint
pnpm typecheck      # nx run-many -t typecheck
pnpm test           # nx run-many -t test
pnpm build          # nx run-many -t build
pnpm format:check   # nx format:check   (CI adds --all; see below)
pnpm format         # nx format:write
```

Per project and per file:

```bash
pnpm nx run web:test                      # one project
pnpm nx run web:test -- lot-view          # one file, by name pattern
pnpm nx run api:build
pnpm nx serve api                         # continuous, port 3000
pnpm nx run web:dev                       # continuous, port 4200 (pinned; see below)
pnpm nx show project api --json           # what targets a project actually has
```

Layers that need infrastructure — see [`doc/testing.md`](doc/testing.md) for what each covers:

```bash
docker compose --profile dev up -d       # PostgreSQL 17, mock OIDC issuer, adminer
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
pnpm nx run api:test-db                   # the *.db.spec.ts suites (needs DATABASE_URL)
pnpm nx run api-e2e:e2e
pnpm nx run web-e2e:e2e                   # documented in doc/testing.md, not re-measured here
```

**`pnpm test` does not run the database suites.** `apps/sit-and-park/api/jest.config.cts` excludes
`*.db.spec.ts` because they need a live PostgreSQL; they run under `api:test-db`, and in CI in
their own job. A change to `SELECT … FOR UPDATE`, to transaction isolation, or to waitlist
promotion is untested until you have run that target.

**`api:test-db` needs `DATABASE_URL` in the environment**, and in the repository root Nx supplies
it from `.env`. In a **worktree** it does not — `.env` is git-ignored and does not travel — so the
target fails before it reaches a test: `DATABASE_URL is not set. … It does not skip itself, on
purpose.` Either copy `.env` in, or pass it for the one command:

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' /path/to/main-checkout/.env | sed 's/^DATABASE_URL=//') \
  pnpm nx run api:test-db
```

`web-e2e:e2e` in a worktree needs the whole `.env` copied in, not just `DATABASE_URL`; without it
the API exits on its own env schema before a test runs. A local run is parallel and CI's is serial
(`nxE2EPreset` sets `workers: process.env.CI ? 1 : undefined`), so they are not the same suite:
`CI=true pnpm nx run web-e2e:e2e --skip-nx-cache` is the one command that reproduces what CI
actually runs. Things worth knowing before you run it yourself:

- **Free port 4200 first, and expect a loud failure if you forget.** The suite does not adopt
  whatever is listening: `reuseExistingServer` is `false` for the web server, so an occupied 4200
  stops the run with _"is already used"_. `build-identity.setup.ts` asserts that the suite built
  and started its own server.
- **A run leaves both ports free.** If 4200 is still held after one, that is a regression, not
  housekeeping.
- **A new spec file needs a day of its own.** `support/dates.ts`'s `SPEC_DAY_SLOTS` gives each spec
  file one business day of the target month, because a reservation is unique per `(spot, date)`
  _and_ per `(user, date)`: two files booking the same persona on the same day fail each other
  intermittently. Add an entry there rather than reusing one. The same file is where the suite's
  date arithmetic lives — never a literal date, which rots into a Saturday or a public holiday.
- **Exit 1 after a passing summary line is not a test failure.** Nx writes its task history to a
  SQLite database under `.nx/`, and concurrent runs from several worktrees corrupt the write. Read
  the suite's own summary line, not just `$?`.

## Things that are the way they are on purpose

- **Ports.** The API is on 3000, the web app on 4200. `web:dev` is pinned to `--port 4200` because
  the workspace-root `.env` carries `PORT=3000` (the API's) and Nx injects it into every target;
  `next dev` would otherwise read it and collide. `web:start` deliberately still honours `PORT`,
  for containers — do not "fix" it.
- **The API's probes are at `/health/live` and `/health/ready`**, not under `/api`: `configureApp()`
  passes them to `setGlobalPrefix`'s `exclude`. The web app has its own `/api/health`, which is a
  genuine Next.js route.
- **The oRPC transport is at `/api/rpc/…`**, not `/api/…`. `POST /api/rpc/me/get` → 401 (the route
  exists and the guard ran), `POST /api/me/get` → 404.
- **The floor plan is a static image and desks are drawn from database geometry.**
  `apps/sit-and-park/web/public/floorplans/praha.svg` is shown as an SVG `<image>` and desks are
  React `<rect>`s from `Desk.x/y/width/height`. Never fetch, parse or inject the SVG as markup:
  the source app did and it was a stored-XSS hole (`doc/desks.md`).
- **Desks deliberately do not use parking's reservation window, monthly cap or waitlist.** They
  follow the source app's rules (series of up to 20 dates over at most 34 days, conflicts always
  skipped and reported). Do not "align" them with parking.
- **`.env` is git-ignored and does not travel with a worktree.** Copy it in. `P1000` from anything
  Prisma means `DATABASE_URL` is missing or wrong.
- **`prisma migrate reset` destroys the database** and is not part of any routine here. If the
  schema is behind, `prisma migrate deploy` is the command.
- **`nx format:check` with no base ref checks nothing** and passes vacuously, which is why CI runs
  `nx format:check --all`.

## CI

`.github/workflows/ci.yml` — four jobs: `verify` (format, lint, typecheck, test, build), `database`
(`api:test-db` against a `postgres:17` service), `e2e` (`api-e2e:e2e` and `web-e2e:e2e` against a
`postgres:17` service and a `mock-oauth2-server` container), and `images` (both production images
build). The e2e job is what gates sign-in, sign-out durability, the cell-lock broadcast, waitlist
promotion through the UI and the ICS feed, and it is why `CI` is genuinely set for the browser
suite. Details: [`doc/workspace.md`](doc/workspace.md).

## Architecture rules

These hold for every change. Do not swap the key technology choices — oRPC, Zod v4, Auth.js v5
with Okta JWKS validation in NestJS, Prisma 7, a mock OIDC server for dev and e2e — without the
user's approval.

- **Contract-first.** All FE↔BE data shapes are defined once as Zod schemas in the single
  `libs/sit-and-park/contract` lib — shared entity schemas plus two entry points:
  `@sit-and-park/contract` (API, via oRPC) and `@sit-and-park/contract/realtime` (Socket.io
  events — Zod payload schemas, validated server-side). TS types are always derived (`z.infer`),
  never hand-duplicated. No endpoint, DTO or event may exist in code before it exists in the
  contract. Errors are typed contract errors; reservation dates are date-only (`YYYY-MM-DD`) in
  Europe/Prague.
- **UI from `@shoptet/ui`** (exact pin `0.24.0-beta`, imported directly, no wrapper lib), which is
  the visual source of truth. Compositions it lacks live in `apps/sit-and-park/web/src/ui/`, one
  folder per component, domain-free, styled with colocated CSS Modules (no Tailwind, no
  Storybook). Server components never import `@shoptet/ui` directly.
- **Mandatory wrapper layers.** App and feature code must never import react-hook-form,
  `@orpc/client`, socket.io-client, next-auth, next-intl or ical-generator directly — always through the
  corresponding `libs/*` wrapper (`doc/frontend.md`). ESLint (Nx module boundaries and
  `no-restricted-imports`, in `eslint.config.mjs`) enforces this. TanStack Query is used directly
  and is not wrapped. A one-off, non-recurring third-party import elsewhere in app code is
  acceptable only with a comment explaining why no wrapper was created — this exception does not
  apply to the wrapped libraries.
- **Validation is Zod-only.** `class-validator` and `class-transformer` are not used in NestJS.
- **No Sentry, metrics, APM or alerting.** No Slack slash commands or interactive Block Kit — the
  Slack integration is outbound `chat.postMessage` notifications only. Structured logging
  (nestjs-pino), health endpoints and graceful shutdown are baseline hygiene and are **not**
  covered by this rule.
- **Single-instance deployment** is the target: no Redis, BullMQ or message brokers. Build the
  documented abstractions (`LockService`, the Socket.io IoAdapter) and leave the upgrade paths
  described in `doc/integrations.md`.

## Working style

- **Before you call anything done**, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm build` (plus `api:test-db` and the e2e targets when you touch what they cover), and read
  the summary lines.
- **Write tests with the change**, not retroactively: Jest for units on both FE and BE, Playwright
  for the browser journeys.
- **`doc/` is a fixed set of domain files, each stating the current state.** When the code changes,
  edit the domain file in place, in the same commit. Present tense; no history, no "previously",
  no status notes.
- **Do not add decision records, plans, audits or status reports to the repo.** A decision is
  recorded by changing the rule in its domain file, with the reason in one clause. If two
  statements would contradict each other, one of them must be edited away.
- Verify before you write: a doc claim is a claim about the code — check the source. Never
  document something unimplemented as if it works.
- Code comments explain why the code is the way it is, in their own words. Do not cite documents
  by number or point at files that describe history.
- Check the index (`doc/README.md`) before opening a topic file, rather than guessing a name or
  grepping the whole directory.

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure and
cross-file relationships.

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json`
  exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for
  focused concepts. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or
  raw grep output.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source
  browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain
  do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
