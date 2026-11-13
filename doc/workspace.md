# Workspace

How the Nx monorepo is laid out, how the checks run, how the environment is configured, how the local Docker stack and CI work. When this document and the code disagree, the code wins; fix the document.

## Layout

The workspace hosts more than one application, so `apps/` and `libs/` are namespaced by owner. `libs/shared/` holds libs that more than one application consumes; `libs/sit-and-park/` holds libs only this application uses. The rule is consumer count, never code size. `auth` and `shared-types` sit under `sit-and-park/` although they look generic, because nothing else consumes them. Known debt: `libs/shared/api-client` still imports this app's contract at runtime, which must be resolved before a second contract exists.

```
apps/sit-and-park/
  web/        Next.js 16 (App Router, React 19)       type:app   scope:web
  web-e2e/    Playwright journeys                     type:app   scope:web
  api/        NestJS 11 (oRPC + Socket.io gateway)    type:app   scope:api
  api-e2e/    Jest over real HTTP                     type:app   scope:api
libs/shared/
  form/         react-hook-form wrapper               type:util  scope:web
  i18n/         next-intl wrapper                     type:util  scope:web
  api-client/   oRPC client + TanStack Query bridge   type:util  scope:web
libs/sit-and-park/
  contract/     Zod schemas, oRPC contract, realtime events   type:contract scope:shared
  database/     Prisma 7 schema, migrations, seed, client     type:data     scope:api
  auth/         next-auth v5 wrapper                          type:util     scope:web
  realtime-client/ socket.io-client wrapper                   type:util     scope:web
  calendar-export/ ical-generator wrapper                     type:util     scope:api
  shared-types/ domain constants, Europe/Prague date logic    type:util     scope:shared  layer:foundation
prisma.config.ts   Prisma CLI config at the repo root
```

Every project also carries an `app:` tag, `app:sit-and-park` or `app:shared`.

**Nx project names are flat and unprefixed** (`web`, `api`, `contract`, ...), so `pnpm nx run web:test` works from anywhere. Names are globally unique, so a second application cannot own `api` and scaffolding it forces a rename. Select per-application work by tag, never by name: `nx run-many -t lint -p tag:app:sit-and-park`. The tag survives the rename; a list of names does not.

**Moving a project: grep for the string literals `'apps'` and `'libs'` as well as slash paths.** `join(root, 'libs', 'database')` survives a search-and-replace of `libs/database`. `prisma.config.ts`, the database suites' migrations directory and the e2e build-identity guard each broke on this once.

Workspace-wide configuration:

| File                               | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `nx.json`                          | plugins, cache, `targetDefaults`, generator defaults           |
| `tsconfig.base.json`               | strict compiler options and the `@sit-and-park/*` path aliases |
| `eslint.config.mjs`                | flat config: module boundaries, wrapper bans, `no-console`     |
| `.prettierrc`, `.editorconfig`     | formatting                                                     |
| `jest.preset.js`, `jest.config.ts` | shared Jest preset and project aggregation                     |
| `pnpm-workspace.yaml`, `.nvmrc`    | pnpm build allow-list; Node major (24)                         |

The root package is `@sit-and-park/source`, so generators derive the `@sit-and-park/<lib>` alias scope from it. `package.json` pins `packageManager` (pnpm 11) and `engines.node >=24`; `.nvmrc` is the source of truth for the exact Node version and CI, and both Dockerfiles (`node:24-alpine`) follow it.

A lib may have several entry points, each a `paths` entry in `tsconfig.base.json`: `@sit-and-park/contract` and `@sit-and-park/contract/realtime` (so the Socket.io half does not pull in `@orpc/contract`), `@sit-and-park/auth` and `@sit-and-park/auth/client` (so a browser component does not pull in Auth.js's server runtime). A second entry point needs **a test that proves the isolation** (`contract/src/realtime/no-orpc.spec.ts`, `auth/src/lib/client-boundary.spec.ts`).

## Commands

Run `pnpm install` first, always, in a fresh worktree. Skipping it produces spurious `Module not found` errors in `api:build`. Every `package.json` script is workspace-wide; `dev` is the one scoped script.

| Command             | Does                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`          | `serve` + `dev` for the `app:sit-and-park` api and web, continuous                        |
| `pnpm lint`         | ESLint on every project, `--max-warnings=0` (set in `nx.json`)                            |
| `pnpm typecheck`    | `tsc --noEmit` per project (`typecheck` targets)                                          |
| `pnpm test`         | Jest unit suites; excludes `*.db.spec.ts` and e2e                                         |
| `pnpm build`        | production build of every app                                                             |
| `pnpm affected`     | `nx affected -t lint,test,build`                                                          |
| `pnpm format`       | `nx format:write`                                                                         |
| `pnpm format:check` | `nx format:check`; without a base ref it checks nothing, so CI runs `nx format:check --all` |

```bash
pnpm nx run web:test -- lot-view     # one file, by name pattern
pnpm nx run api:build
pnpm nx serve api                    # port 3000, continuous
pnpm nx run web:dev                  # port 4200, continuous
pnpm nx show project api --json      # targets a project really has
pnpm nx run-many -t lint --skip-nx-cache
```

Layers needing infrastructure (what each covers is in `testing.md`):

```bash
docker compose --profile dev up -d
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
pnpm nx run api:test-db        # *.db.spec.ts against real PostgreSQL
pnpm nx run api-e2e:e2e
pnpm nx run web-e2e:e2e
pnpm nx run database:check-schema   # schema vs migrations vs committed client; needs DB
```

`pnpm test` does not run the database suites. A change to `SELECT ... FOR UPDATE`, transaction isolation or waitlist promotion is untested until `api:test-db` has run.

**Nx task history lives in a SQLite file under `.nx/`.** Concurrent runs from several worktrees can corrupt the write and exit 1 after a passing summary line. Read the suite's own summary, not just `$?`.

### Worktrees

`.env` is git-ignored and does not travel with a worktree. Copy it in; for `api:test-db` alone, pass `DATABASE_URL` for the one command. `P1000` from anything Prisma means `DATABASE_URL` is missing or wrong. The browser suite in a worktree needs the whole `.env`, not just `DATABASE_URL`, or the API exits on its own env schema.

## TypeScript

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes` and `forceConsistentCasingInFileNames`. No project turns any off; under `exactOptionalPropertyTypes` change the type (`prop?: T | undefined`), not the check. Every project has its own `typecheck` target; a lib without one is never covered by `pnpm typecheck`.

## Tags and module boundaries

Tags live in `project.json` and are enforced by `@nx/enforce-module-boundaries`. Dimensions are ANDed: every constraint matching a project's tags must hold at once.

**`type:`** (each project has exactly one; the npm allow-list hangs off it):

| Tag             | May depend on                         | npm                                                      |
| --------------- | ------------------------------------- | -------------------------------------------------------- |
| `type:app`      | anything; nothing depends on an app   | any                                                      |
| `type:feature`  | feature, util, contract, data         | `tslib`                                                  |
| `type:util`     | util, contract                        | React/Next, `WRAPPED_LIBRARIES`, wrapper companions      |
| `type:contract` | `layer:foundation`                    | `zod`, `@orpc/contract`, `tslib`                         |
| `type:data`     | data, util, contract                  | Prisma                                                   |

**`layer:foundation`** is carried only by `shared-types`: depends on nothing, imports nothing from npm. It sits below the contract, while wrappers sit above it, which keeps `util -> contract -> foundation` acyclic. Layering: `app -> feature -> util -> contract -> foundation`.

**`scope:`** is direction only: `scope:web` and `scope:api` may use themselves and `scope:shared`; `scope:shared` only `scope:shared`. This keeps `next-intl` out of the backend.

Trap: an `allowedExternalImports` that is **absent** restricts nothing; `[]` bans everything. That is why every `type:` tag has a list, even `['tslib']`. A project with no tags is restricted by nothing, so an untagged lib is a hole.

The UI comes from `@shoptet/ui`, imported by the app, so no lib carries a UI tag.

### Wrapper libs

App and lib code must not import these packages; only the owner may. The map is `WRAPPED_LIBRARIES` in `eslint.config.mjs`; the global ban and every per-wrapper exemption are generated from it, and the message names the wrapper to use.

| Forbidden package  | Use                             | Owner directory                       |
| ------------------ | ------------------------------- | ------------------------------------- |
| `react-hook-form`  | `@sit-and-park/form`            | `libs/shared/form`                    |
| `@orpc/client`     | `@sit-and-park/api-client`      | `libs/shared/api-client`              |
| `socket.io-client` | `@sit-and-park/realtime-client` | `libs/sit-and-park/realtime-client`   |
| `next-auth`        | `@sit-and-park/auth`            | `libs/sit-and-park/auth`              |
| `ical-generator`   | `@sit-and-park/calendar-export` | `libs/sit-and-park/calendar-export`   |
| `next-intl`        | `@sit-and-park/i18n`            | `libs/shared/i18n`                    |

`@tanstack/react-query` is not wrapped; the web app uses it directly through the contract-derived helpers from `api-client` (`frontend.md`). `@hookform/resolvers` and `@orpc/tanstack-query` are allow-listed companions, not wrapped. The ban also covers `require()` and dynamic `import()`, via selector rules, because `no-restricted-imports` alone misses both.

Other lint rules: `no-console` is an error in `apps/sit-and-park/api/**` and `libs/**` (the backend logs through `nestjs-pino`); allowed in `tools/`, `scripts/` and config files. `shared-types` additionally bans `zod`, which the tag dimensions cannot express. Typed rules (`no-floating-promises`, `no-misused-promises`) run with `projectService` on the api and libs, and the `lint` target's inputs include `^default` so a dependency's signature change invalidates a dependent's cached lint.

Trap when editing `eslint.config.mjs`: Nx runs `eslint .` with cwd at the project directory. A config block with root-relative `files` must set `basePath: workspaceRoot` or it never matches and the rule silently does nothing. Verify a path-scoped rule with a temporary offending file, not just by lint passing.

### Adding a lib

1. Generate it (`pnpm nx g @nx/js:lib libs/<owner>/<name> --name=<name> --unitTestRunner=jest --bundler=none --linter=eslint --useProjectJson`, or `@nx/react:lib` for React); the alias is added to `tsconfig.base.json`.
2. Tag it in `project.json`: one `type:`, one `scope:`, one `app:`. If it needs an npm package outside its `type:` allow-list (`NPM_ALLOWLIST` in `eslint.config.mjs`), lint names it; add one line so the change is visible in review.
3. Add a `typecheck` target (`nx:run-commands`, `tsc --noEmit -p libs/<owner>/<name>/tsconfig.lib.json`).
4. Run `pnpm lint && pnpm typecheck && pnpm test`.

`doc/` is in `.prettierignore`, so `pnpm format` does not reflow documents.

## Ports and routes

- API `3000`, web `4200`. `web:dev` is pinned to `next dev --port 4200` because the root `.env` carries `PORT=3000` (the API's) and Nx injects it into every target. 4200 is also what `CORS_ALLOWED_ORIGINS` and the mock issuer's redirect URI name. `web:start` deliberately still honours `PORT`, for containers; do not "fix" it.
- `web:build` and `web:start` pin `NODE_ENV=production`, because the injected `.env` carries `development` and would mix React builds.
- Health probes are at `/health/live` and `/health/ready`, outside the `/api` prefix. The web app has its own `/api/health`, a genuine Next.js route that reports readiness of the pair.
- oRPC is at `POST /api/rpc/<procedure/path>`, not `/api/...`.
- Mock issuer `8080`, adminer `8081`, PostgreSQL `5432`.

## Environment

Both apps validate their environment at startup with a Zod schema and **crash immediately**, naming every bad variable (never its value). The schemas are the source of truth: `apps/sit-and-park/api/src/env.ts` (runs in `ConfigModule.forRoot({ validate })`, before `listen`) and `apps/sit-and-park/web/src/env.ts` (runs from `instrumentation.ts`; `instrumentation-node.ts` calls `process.exit(1)` because Next would otherwise keep serving 500s).

**Dev, e2e and production run the same code.** Only values differ: in dev/e2e `AUTH_OKTA_ISSUER` points at `mock-oauth2-server`, in production at a real Okta authorization server. There is no test-only branch for auth, Slack or anything else; `SLACK_ENABLED=false` is the only thing keeping a laptop from posting to a workspace.

### API variables

Required:

| Variable               | Shape                                              | Meaning                                                                          |
| ---------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development` \| `test` \| `production`            |                                                                                  |
| `PORT`                 | 1-65535                                            | HTTP port                                                                        |
| `DATABASE_URL`         | URL                                                | Postgres connection string                                                       |
| `AUTH_OKTA_ISSUER`     | URL                                                | OIDC issuer; JWKS is discovered from `${issuer}/.well-known/openid-configuration` |
| `AUTH_OKTA_AUDIENCE`   | non-empty                                          | expected `aud` claim                                                             |
| `CORS_ALLOWED_ORIGINS` | comma-separated absolute URLs                      | explicit allow-list, no wildcard                                                 |
| `LOG_LEVEL`            | `fatal` `error` `warn` `info` `debug` `trace`      | `nestjs-pino` level                                                              |

Optional, with defaults (`ENV_DEFAULTS` in `env.ts`; the defaults are the production values):

| Variable                    | Default    | Meaning                                                                                     |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `THROTTLE_TTL_MS`           | `60000`    | global rate-limit window                                                                    |
| `THROTTLE_LIMIT`            | `300`      | requests per window per route                                                               |
| `THROTTLE_STRICT_TTL_MS`    | `60000`    | window of the `StrictThrottle()` tier                                                       |
| `THROTTLE_STRICT_LIMIT`     | `20`       | requests per strict window                                                                  |
| `BODY_LIMIT`                | `100kb`    | max body; **must carry a unit**, a bare `100` means bytes and is rejected                   |
| `HEALTH_DB_TIMEOUT_MS`      | `3000`     | how long `/health/ready` waits for `SELECT 1`                                               |
| `REALTIME_LOCK_TTL_MS`      | `30000`    | cell-lock lifetime; `realtime-client`'s renewal budget is sized against it (`integrations.md`) |
| `SLACK_ENABLED`             | `false`    | exactly `true` or `false`, not coerced (`z.coerce.boolean()` reads `no` as true)            |
| `SLACK_BOT_TOKEN`           | none       | required when `SLACK_ENABLED=true`                                                          |
| `SLACK_CHANNEL_ID`          | none       | required when `SLACK_ENABLED=true`                                                          |
| `SLACK_REQUEST_TIMEOUT_MS`  | `5000`     | per-attempt timeout                                                                         |
| `SLACK_RETRY_ATTEMPTS`      | `3`        | total attempts, first included                                                              |
| `SLACK_RETRY_BASE_DELAY_MS` | `500`      | first backoff delay, doubles                                                                |
| `SLACK_DAILY_SUMMARY_AT`    | `08:00`    | `HH:MM` in Europe/Prague                                                                    |
| `EMPLOYEE_SYNC_KEY_SHA256`  | none       | 64 hex chars; unset means `POST /api/employee-sync` answers 503                             |

Times are in milliseconds (the `_MS` suffix exists because `@nestjs/throttler` changed units between majors). `SLACK_DAILY_SUMMARY_AT` has no suffix because it is a time of day, not a duration. The schema may only gain keys; no existing key is loosened. Optional keys are optional so an existing `.env` keeps working.

### Web variables

| Variable                  | Shape            | Meaning                                              |
| ------------------------- | ---------------- | ---------------------------------------------------- |
| `NODE_ENV`                | as above         | set by Next                                          |
| `NEXT_PUBLIC_API_URL`     | URL              | API base including `/api`                            |
| `AUTH_SECRET`             | at least 32 chars | Auth.js session cookie key                          |
| `AUTH_OKTA_ISSUER`        | URL              | same issuer as the API; the refresh endpoint is discovered from it |
| `AUTH_OKTA_CLIENT_ID`     | non-empty        | OAuth2 client id                                     |
| `AUTH_OKTA_CLIENT_SECRET` | non-empty        | OAuth2 client secret                                 |

`AUTH_URL` (the origin a browser reaches the web app on) is Auth.js's, not in `webEnvSchema`. It is required in a container: without it a successful sign-in redirects to the address the server bound (`http://0.0.0.0:3000`). Compose-only variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` configure the `postgres` container and must be kept equal by hand to the credentials inside `DATABASE_URL`.

Dev audience: `AUTH_OKTA_AUDIENCE=default`, because the mock issuer with no `JSON_CONFIG` mints `aud: ["default"]`; production sets the Custom Authorization Server's audience, typically `api://default`. Using `api://default` against the mock lets sign-in succeed and 401s every API call.

### Where the `.env` files live

`.env.example` is committed and produces two untracked copies, because the two apps read different directories:

- root `.env`: read by `docker compose` and by the API (Nest's `ConfigModule` reads relative to `process.cwd()`, the repo root under Nx);
- `apps/sit-and-park/web/.env`: read by Next.js, which resolves env files relative to its own directory.

```bash
cp .env.example .env
cp .env.example apps/sit-and-park/web/.env
```

Neither is committed. No secret appears anywhere in the repository, and example values are obviously fake (`example.com` addresses).

## Docker

Every compose service carries a profile, so a bare `docker compose up` starts nothing. That is deliberate: the mock issuer signs a token for any subject, and a default that starts it is one that eventually starts in production. The database is also a choice.

| Running                                   | Command                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| apps on the host (everyday dev, e2e)      | `docker compose --profile dev up -d`                                                     |
| everything in containers, mock issuer     | `docker compose --env-file .env.docker --profile dev --profile app up -d --build`        |
| containers + local DB, real Okta          | `docker compose --env-file .env.docker --profile db --profile app up -d --build`         |
| containers only, managed DB and real Okta | `docker compose --env-file .env.docker --profile app up -d --build`                      |

- `postgres` (PostgreSQL 17) answers to `dev` and `db`; `mock-oauth2-server` and `adminer` only to `dev`. Nothing in `app` depends on the mock issuer, and `postgres` is a `required: false` dependency so `--profile app` alone starts with `DATABASE_URL` pointing at a managed database.
- `app` builds the two production images and a one-shot `migrate` job (`--target migrator` of the API Dockerfile, running `prisma migrate deploy`). A serving process never rewrites its own schema. Order: postgres healthy, `migrate` exits 0, `api` healthy on `/health/ready`, then `web`.
- Application containers get variables **by name** (bare list entries, no `env_file`), so an unset optional key is absent rather than empty, and nothing foreign leaks in. `${VAR:?}` cannot be used: Compose interpolates every service regardless of profile and would break `--profile dev`. A missing required value is caught by the app's own schema at boot.
- `.env.docker` (from `.env.docker.example`) differs from `.env` because inside the network the API is `sit-and-park-api:3000` and Postgres `postgres:5432`.
- **While the mock issuer is in use, add `127.0.0.1 sit-and-park-api sit-and-park-oidc` to `/etc/hosts`.** The mock builds every URL it publishes, including `iss`, from the request's Host header, so the issuer URL must be one name that resolves to the container from inside the network and to the published port from the browser. A different name on either side lets sign-in succeed while every API call 401s on `iss`.
- Web publishes `4200` on the host (3000 in the container); both images have a `HEALTHCHECK`; `api` has `stop_grace_period: 30s` and `init: true`.

Verify without starting anything: `docker compose --profile dev config`. Check the mock issuer: `curl -s http://localhost:8080/default/.well-known/openid-configuration`.

### Production notes

Two Okta settings nothing in the repo can enforce:

- Point `AUTH_OKTA_ISSUER` at a **Custom** Authorization Server (`https://<tenant>.okta.com/oauth2/default`), not the Org one; with an Org server sign-in works and every API and Socket.io call 401s for lack of an agreeable audience.
- Leave **refresh-token rotation off**. Concurrent refreshes are coalesced in-process only, so with rotation two tabs can invalidate each other's token.

Single instance is the target. The seams for scaling exist and none is built: the Socket.io adapter (`configureRealtime` in `api/src/realtime/realtime-io.adapter.ts`, add `@socket.io/redis-adapter`), `LockService` (back with Redis `SET NX PX`), and `ScheduledJobRunner` (N instances would post N daily summaries). Until then run one instance. Rate-limit counters are in memory too.

## CI

`.github/workflows/ci.yml` runs four parallel jobs on push to `main`, on pull requests and on manual dispatch. Permissions are `contents: read`; a new push cancels the in-flight run except on `main`. Every command is one a developer runs locally; the workflow adds no CI-only application behaviour.

| Job        | Runs                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`   | `pnpm install --frozen-lockfile`, `nx format:check --all`, `nx run-many -t lint,typecheck,test,build`. No Docker, no database.            |
| `database` | `api:test-db` against a `postgres:17` service, then `prisma migrate deploy` and `database:check-schema`.                                  |
| `e2e`      | Postgres 17 service and a `mock-oauth2-server` service; `migrate deploy`, `db seed`, wait for the issuer's discovery document, `api-e2e:e2e`, then `web-e2e:e2e`. Playwright report uploaded on failure. |
| `images`   | api, migrator and web images build (`push: false`), exercising the `.dockerignore` that keeps `.env` out of the context.                  |

- `database` exists because `*.db.spec.ts` is excluded from `api:test`; without it a green build says nothing about row locks, isolation and promotion.
- `api:test-db` needs no migrate step (it creates a throwaway database per run), but `check-schema` compares against the job's own database, so `migrate deploy` must precede it. `check-schema` catches a schema the migrations do not reproduce and a generated client that is behind; it needs a live database, which is why it is not in `verify`.
- `e2e` is the only place sign-in through a real OIDC redirect, sign-out durability, the cell-lock broadcast, waitlist promotion through the UI and the ICS feed run end to end. `LOG_LEVEL=warn` there, and the credentials are a throwaway container's, deliberately not `secrets.` references.
- Browser tests run Chromium only, because several concurrent sessions share one database.
