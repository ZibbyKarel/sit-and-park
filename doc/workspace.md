# Workspace – structure, scripts, boundaries

Nx 23 monorepo for Sit & Park. This document describes **how the repo is put
together**, **how the checks are run**, and **how to add a new lib so that it
gets watched by the same boundaries as everything else**.

The binding specification is `plan.md`, broken down into tasks in
`doc/implementation-plan.md`. Decisions that deviate from `plan.md` or refine
it live in `doc/decision/`.

---

## Repo structure

**This workspace hosts more than one application**, so `apps/` and `libs/` are
namespaced by which application owns what. `libs/shared/` is for libs with
more than one consuming application; `libs/<app>/` is for libs only that
application uses. The classification rule is consumer count, not code size —
see `doc/decision/0310-the-workspace-is-namespaced-to-host-two-applications.md`,
which also records why `auth` and `shared-types` sit where they do and what
debt `api-client`'s placement carries.

```
apps/
  sit-and-park/
    web/        Next.js 16 (App Router, React 19)   tags: type:app,  scope:web
    web-e2e/    Playwright e2e for web              tags: type:app,  scope:web
    api/        NestJS 11 (API + Socket.io gateway) tags: type:app,  scope:api
    api-e2e/    Jest integration tests against the API tags: type:app,  scope:api
libs/
  shared/       more than one application consumes these
    form/       react-hook-form wrapper              tags: type:util, scope:web
    i18n/       next-intl wrapper + Czech messages   tags: type:util, scope:web
    api-client/ oRPC client typed from the contract  tags: type:util, scope:web
  sit-and-park/    only the parking app consumes these
    contract/   Zod schemas + oRPC contract + realtime events
                (two entry points: @sit-and-park/contract and @sit-and-park/contract/realtime)
                                      tags: type:contract, scope:shared
    database/   Prisma 7 schema, migrations, seed + generated client
                                      tags: type:data,     scope:api
    auth/       next-auth v5 (Auth.js) wrapper
                (two entry points: @sit-and-park/auth and @sit-and-park/auth/client)
                                      tags: type:util, scope:web
    realtime-client/
                socket.io-client wrapper typed from the contract
                                      tags: type:util, scope:web
    calendar-export/
                ical-generator wrapper – the personal ICS feed
                                      tags: type:util, scope:api
    shared-types/
                domain constants + Europe/Prague date logic. The name predates
                the namespacing and is now misleading — nothing outside this
                application uses it (decision 0310).
                                      tags: type:util,     scope:shared
doc/            documentation, decisions, visual design export
prisma.config.ts  Prisma CLI configuration (schema in libs/sit-and-park/database, `.env` from the root)
```

**Nx project names are flat and unprefixed** (`web`, `api`, `contract`, …),
so `pnpm nx run web:test` still addresses the parking app's web project
regardless of where its directory sits. That is fine while there is one
application and becomes ambiguous with two; prefixing them is a separate
change, deliberately not bundled with the move (decision 0310).

**Paths built from segments do not survive a directory move by text search.**
`join(root, 'libs', 'database')` is invisible to a grep for `libs/database`.
When a project moves, grep for the string literals `'apps'` and `'libs'`
across all tracked code as well — six such sites existed at the last move,
including `prisma.config.ts` and the e2e suite's build-identity guard.

Configuration that applies to the whole workspace:

| file | what it's for |
| --- | --- |
| `nx.json` | plugins, cache, `targetDefaults`, generator defaults |
| `tsconfig.base.json` | shared `compilerOptions` + `@sit-and-park/*` path aliases |
| `eslint.config.mjs` | flat config: module boundaries, wrapper layers, `no-console` |
| `.prettierrc`, `.editorconfig` | formatting for TS/TSX/JSON/MD |
| `jest.preset.js`, `jest.config.ts` | shared Jest preset and project aggregation |

A lib can have more than one entry point: `libs/sit-and-park/contract` has
`@sit-and-park/contract/realtime` alongside `@sit-and-park/contract`, so the
Socket.io half of the contract doesn't pull in `@orpc/contract`;
`libs/sit-and-park/auth` has `@sit-and-park/auth/client`, so a browser component doesn't pull
in Auth.js's server runtime. A second entry point means a second entry in
`paths` in `tsconfig.base.json`, plus **a test that proves the isolation**
(`libs/sit-and-park/contract/src/realtime/no-orpc.spec.ts`,
`libs/sit-and-park/auth/src/lib/client-boundary.spec.ts`) — see `doc/decision/0023-*` and
`doc/decision/0046-*`.

Packages are named `@sit-and-park/<lib>` (see
`doc/decision/0005-npm-scope-lets-park.md`). The scope was derived from the
root `package.json`'s name, which Nx generators read to fill the alias in
automatically.

The root package is `@sit-and-park/source`, so a generator offers the same
`@sit-and-park/<lib>` scope the existing libs use.

---

## Scripts

Everything runs from the repo root via pnpm. **An unsuffixed script is
workspace-wide** — it covers every project of every application, which is what
CI's `verify` job needs and what "is the tree green" means here. A `:<app>`
suffix scopes a script to one application.

| command | what it does |
| --- | --- |
| `pnpm dev` | `serve` + `dev` for that app's `api` and `web` – continuous |
| `pnpm lint` | ESLint across every project (`nx run-many -t lint`), **`--max-warnings=0`** |
| `pnpm typecheck` | `tsc --noEmit` against every project's tsconfigs |
| `pnpm test` | Jest unit tests (`nx run-many -t test`) |
| `pnpm build` | production build of every app |
| `pnpm affected` | `nx affected -t lint,test,build` – only what changed (for CI) |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check (fails if anything is unformatted) |

`dev` is the only script that needs scoping today, because serving
two applications' `api` and `web` at once is never what you want. It selects
`-p tag:app:sit-and-park`, **not** `-p api,web`: Nx project names are globally
unique, so a second application cannot own a project called `api` and
scaffolding it forces a rename of these. A list of project names breaks then;
the `app:` tag does not. Every project carries one — `app:sit-and-park` or
`app:shared` — and `nx show projects -p tag:app:sit-and-park` is how you ask what
it covers. Adding `dev:<second-app>` is then one line.

E2e tests aren't part of `pnpm test`; they run on demand:

```bash
pnpm nx run web-e2e:e2e      # Playwright; starts the dev server itself
pnpm nx run api-e2e:e2e      # Jest; starts api:serve itself
```

Useful individual targets:

```bash
pnpm nx run web:dev          # Next.js dev server
pnpm nx run api:serve        # NestJS in watch mode
pnpm nx run-many -t lint --skip-nx-cache   # bypass the cache
pnpm nx graph                # dependency graph
```

CI has no pipeline file yet – deliberately. The scripts above are designed so
a pipeline just has to call them (`pnpm install && pnpm affected`).

---

## TypeScript

`tsconfig.base.json` enables, workspace-wide:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `exactOptionalPropertyTypes: true`
- `forceConsistentCasingInFileNames: true`

No project may turn any of these off. When new code hits
`exactOptionalPropertyTypes`, the fix is to adjust the type
(`prop?: T | undefined`), not to disable the check.

Every project has its own `typecheck` target (`nx:run-commands` +
`tsc --noEmit`). **A new lib must add one too** – otherwise it never becomes
part of `pnpm typecheck`.

---

## Nx tags and module boundaries

Tags are written into `project.json` (`"tags": [...]`) and enforced by the
ESLint rule `@nx/enforce-module-boundaries`. Four independent dimensions are
used; **rules from every dimension must hold simultaneously** (Nx ANDs them —
see `doc/decision/0017-*`).

### The `type:` dimension – what role a lib plays

This dimension **partitions the workspace without remainder** (every project
carries exactly one `type:` tag), which is why the npm allow-list
(`allowedExternalImports`) hangs off it too.

| tag | meaning | may depend on | may use from npm |
| --- | --- | --- | --- |
| `type:app` | an application (`apps/*`) | anything; nothing may depend on an app | `*` |
| `type:feature` | domain composition | `feature`, `util`, `contract`, `data` | `tslib` |
| `type:util` | wrapper layers and helpers | `util`, `contract` | React/Next + the union of packages from `WRAPPED_LIBRARIES` |
| `type:contract` | `libs/sit-and-park/contract` – Zod + oRPC | `layer:foundation` | `zod`, `@orpc/contract`, `tslib` |
| `type:data` | data access (`libs/sit-and-park/database`) | `data`, `util`, `contract` | Prisma |

### The `layer:` dimension – the bottom of the graph

| tag | may depend on | may use from npm |
| --- | --- | --- |
| `layer:foundation` | **nothing** | **nothing** |

Only one project carries it, `libs/sit-and-park/shared-types`. It separates it from the
wrappers, which share the same `type:util` tag but sit **above** the contract,
whereas `shared-types` sits **below** it. Without this, `type:util →
type:contract` and `type:contract → type:util` would form a cycle. The
resulting layering is acyclic: `app → feature → ui → util → contract →
foundation`.

> **Watch the difference between "missing" and "empty":**
> `allowedExternalImports` **left out entirely** restricts nothing (any
> package passes), whereas `allowedExternalImports: []` bans everything. That's
> exactly why every `type:` tag has a list, even if it's just `['tslib']`.
> Details and probe evidence: `doc/decision/0017-*`.

### The `scope:` dimension – which side a lib lives on

| tag | may depend on |
| --- | --- |
| `scope:web` | `scope:web`, `scope:shared` |
| `scope:api` | `scope:api`, `scope:shared` |
| `scope:shared` | `scope:shared` |

This dimension enforces decision `0003`: `apps/sit-and-park/api` (`scope:api`) may depend
on `libs/sit-and-park/shared-types` (`scope:shared`), but **not** on `libs/shared/i18n`
(`scope:web`), so `next-intl` never reaches the backend.

### The `ds:` dimension and the `type:ui` tag – gone

`ds:tokens` / `ds:primitives` / `ds:compounds` and later the `type:ui` tag
belonged to the in-house design system, which is deleted
(`doc/decision/0318-ui-comes-from-shoptet-ui-and-the-in-house-design-system-is-deleted.md`).
UI comes from `@shoptet/ui`, imported by the app, so no lib carries a UI tag.
The npm surface stays on the `type:` dimension (`doc/decision/0017-*`).

---

## Wrapper layers (`no-restricted-imports`)

Application and library code must not import these packages directly. The
only allowed place is the wrapper lib that owns them:

| forbidden package | use instead | only allowed directory |
| --- | --- | --- |
| `react-hook-form` | `@sit-and-park/form` | `libs/shared/form` (done) |
| `@tanstack/react-query` | `@sit-and-park/query` | `libs/query` (done) |
| `@orpc/client` | `@sit-and-park/api-client` | `libs/shared/api-client` (done) |
| `socket.io-client` | `@sit-and-park/realtime-client` | `libs/sit-and-park/realtime-client` (done) |
| `next-auth` | `@sit-and-park/auth` / `@sit-and-park/auth/client` | `libs/sit-and-park/auth` (done) |
| `ical-generator` | `@sit-and-park/calendar-export` | `libs/sit-and-park/calendar-export` (done) |
| `next-intl` | `@sit-and-park/i18n` | `libs/shared/i18n` |

The list lives in `eslint.config.mjs` in a single map, `WRAPPED_LIBRARIES`;
the global ban and the per-wrapper exceptions are both generated from it, so
they can't drift apart. The error message always states which wrapper lib the
developer should use instead.

`no-console: error` also applies in `apps/sit-and-park/api/**` and `libs/**` – the backend
logs through `nestjs-pino`. Console is allowed only in `tools/**`,
`scripts/**`, `**/scripts/**`, and in configuration files.

`libs/sit-and-park/shared-types` is handled specially: it has its own
`no-restricted-imports` block that additionally bans **`zod`** there. The Nx
`type:util` dimension can't express this – the wrapper libs, which must
depend on third parties, share the same tag. Without this block, nothing
would stop `apps/sit-and-park/api` from pulling in Zod through `shared-types` (see
`doc/decision/0003-*`).

> **Trap when editing `eslint.config.mjs`:** Nx runs `eslint .` with **cwd set
> to the project's directory**, not the repo root. A config object whose
> `files` are root-relative paths (`apps/**`, `libs/shared/form/**`) must therefore
> set `basePath: workspaceRoot` – otherwise the glob is matched against a
> project-relative path, never matches, and the rule **silently does
> nothing**. After every change to a path-scoped rule, verify it with a
> temporary file, not just by lint passing.

---

## How to add a new lib

1. **Generate it.** The `@sit-and-park/<name>` alias is added to
   `tsconfig.base.json` automatically.

   ```bash
   # a pure TypeScript lib (contract, util, backend service)
   pnpm nx g @nx/js:lib libs/sit-and-park/shared-types --name=shared-types \
     --unitTestRunner=jest --bundler=none --linter=eslint --useProjectJson

   # a React lib (frontend wrappers)
   pnpm nx g @nx/react:lib libs/shared/form --name=form \
     --unitTestRunner=jest --bundler=none --linter=eslint --useProjectJson
   ```

2. **Set the tags** in `libs/<name>/project.json`. Planned split:

   | lib | tags |
   | --- | --- |
   | `libs/sit-and-park/contract` | `type:contract`, `scope:shared` |
   | `libs/sit-and-park/shared-types` | `type:util`, `scope:shared`, `layer:foundation` |
   | `libs/shared/form`, `libs/query`, `libs/shared/api-client`, `libs/sit-and-park/realtime-client`, `libs/sit-and-park/auth`, `libs/shared/i18n` | `type:util`, `scope:web` |
   | `libs/sit-and-park/calendar-export` | `type:util`, `scope:api` |
   | `libs/sit-and-park/database` | `type:data`, `scope:api` |

   A project with no tags is restricted by nothing – **an untagged lib is a
   hole in the boundaries.** When a lib needs an npm package that isn't in the
   `NPM_ALLOWLIST` for its `type:` tag, lint fails naming it; add it there in
   one line, so the change is visible in review.

3. **Add a `typecheck` target** to `project.json`:

   ```json
   "typecheck": {
     "executor": "nx:run-commands",
     "options": { "command": "tsc --noEmit -p libs/<name>/tsconfig.lib.json" }
   }
   ```

4. **Verify**: `pnpm lint && pnpm typecheck && pnpm test`.

> **Lint fails on warnings too.** `nx.json` adds `--max-warnings=0` to every
> `lint` target. Without it, `nx run-many` exits 0 even if ESLint printed
> warnings, and the summary line "Successfully ran targets" hides them —
> exactly how Task 4 let a warning slip into main. Global constraint 11 wants
> clean output, so let the build enforce it, not a reviewer's attention.

---

## Formatting notes

`pnpm format` runs over the source code, not over `doc/` – hand-written
documents and the design export are in `.prettierignore`, so Prettier doesn't
reflow tables and text that aren't its to format.
