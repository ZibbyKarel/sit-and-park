# Sit & Park: overview

Sit & Park is a company's internal app for booking **parking spots and desks**. Parking is a day grid of spots with a monthly reservation window, a per-person monthly cap, a waitlist that auto-promotes on cancellation, and bulk monthly booking. Desks are booked in series, by hive or permanent assignment, on a floor plan, with an approval flow. Around that: Okta sign-in, an admin area, realtime updates over Socket.io, outbound Slack notifications, a personal ICS calendar feed, and an HR employee sync.

It is an Nx monorepo: `apps/sit-and-park/api` (NestJS 11) and `apps/sit-and-park/web` (Next.js 16, React 19) share one Zod contract served over oRPC, with PostgreSQL 17 behind Prisma 7. The UI comes from `@shoptet/ui` (exact pin), imported directly. UI copy is Czech (`apps/sit-and-park/web/messages/cs.json`) with an English catalog kept in step; everything else, including code, comments and documents, is English.

The workspace is built to host more than one application. Only `sit-and-park` exists today.

## Doc index

Each document describes how things are **now**, is edited in place when the system changes, and carries no history (git has it). Agent working rules live in [`../AGENTS.md`](../AGENTS.md); the operational runbook is the root [`../README.md`](../README.md).

| File                             | Find here                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [README.md](./README.md)         | this page: overview, package map, glossary, doc index                                                                                  |
| [workspace.md](./workspace.md)   | layout, Nx tags and module boundaries, wrapper-lib bans, commands, env variables, Docker profiles, ports, CI jobs, production notes    |
| [backend.md](./backend.md)       | API startup and HTTP wiring, oRPC transport, error mapping, logging, probes, shutdown, throttling, module rules, schema, constraints, migrations, seed, backups |
| [contract.md](./contract.md)     | `libs/sit-and-park/contract`: schemas, procedures, errors, realtime events, how to add one                                             |
| [auth.md](./auth.md)             | Okta sign-in in web, JWKS validation in the API, JIT provisioning, refresh, roles, public routes                                        |
| [frontend.md](./frontend.md)     | route tree, providers, screen states, wrapper libs, TanStack Query layer, forms, i18n and message catalogs                              |
| [parking.md](./parking.md)       | reservations, reservation window and cap, waitlist and promotion, bulk allocator and its modal                                          |
| [desks.md](./desks.md)           | offices, zones, hives, permanent desks, series booking, approvals, floor plan, locks                                                   |
| [integrations.md](./integrations.md) | Socket.io rooms, events and cell locks; outbound Slack and scheduled jobs; ICS feed; HR employee sync                              |
| [admin.md](./admin.md)           | the `/admin` tabs and what each may change                                                                                              |
| [testing.md](./testing.md)       | the test layers, what each covers, how to run it and what must be running first                                                         |

## Package map

| Path                                | Nx project        | What it is                                                                          |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `apps/sit-and-park/api`             | `api`             | NestJS API: oRPC procedures, Socket.io gateway, Slack, ICS feed, employee sync       |
| `apps/sit-and-park/web`             | `web`             | Next.js app: screens, `@shoptet/ui` compositions in `src/ui/`, message catalogs      |
| `apps/sit-and-park/api-e2e`         | `api-e2e`         | Jest over real HTTP with real tokens                                                |
| `apps/sit-and-park/web-e2e`         | `web-e2e`         | Playwright journeys                                                                 |
| `libs/sit-and-park/contract`        | `contract`        | Zod schemas, oRPC contract, realtime event schemas (`@sit-and-park/contract`, `/realtime`) |
| `libs/sit-and-park/database`        | `database`        | Prisma schema, migrations, seed, committed generated client                         |
| `libs/sit-and-park/shared-types`    | `shared-types`    | domain constants, Europe/Prague date logic, reservation-window rule (dependency-free foundation) |
| `libs/sit-and-park/auth`            | `auth`            | next-auth v5 wrapper (`@sit-and-park/auth`, `/client`)                              |
| `libs/sit-and-park/realtime-client` | `realtime-client` | socket.io-client wrapper typed from the contract                                    |
| `libs/sit-and-park/calendar-export` | `calendar-export` | ical-generator wrapper for the ICS feed                                             |
| `libs/shared/form`                  | `form`            | react-hook-form wrapper                                                             |
| `libs/shared/i18n`                  | `i18n`            | next-intl wrapper                                                                   |
| `libs/shared/api-client`            | `api-client`      | oRPC client and contract-derived TanStack Query helpers                             |

`libs/shared/*` is what more than one application consumes; `libs/sit-and-park/*` belongs to this app. Dependency direction is `app -> feature -> util -> contract -> foundation`, enforced by Nx tags (`workspace.md`). `apps/sit-and-park/web/src` is organised by feature: `app/` (routes), `lot/`, `reservations/`, `desks/`, `shell/`, `ui/`, `theme/`.

## Architecture rules

- **Contract-first.** Every FE-BE data shape is a Zod schema in `libs/sit-and-park/contract`; types are `z.infer`, never hand-duplicated; nothing exists in code before it exists in the contract. Errors are typed contract errors. Reservation dates are date-only `YYYY-MM-DD` in Europe/Prague.
- **Wrapper libs.** App code never imports `react-hook-form`, `@orpc/client`, `socket.io-client`, `next-auth`, `next-intl` or `ical-generator`; ESLint enforces it (`workspace.md`).
- **UI from `@shoptet/ui`.** Compositions it lacks live in `apps/sit-and-park/web/src/ui/`, one folder per component, domain-free, styled with colocated CSS Modules (no Tailwind, no Storybook). Server components never import `@shoptet/ui` directly.
- **Single instance.** No Redis, BullMQ or broker; seams for them exist (`LockService`, the Socket.io adapter, `ScheduledJobRunner`) and are not built.
- **No monitoring stack.** No Sentry, metrics, APM or alerting. Structured logging, probes and graceful shutdown are baseline hygiene.
- **Slack is outbound `chat.postMessage` only**: no slash commands, no interactive Block Kit.
- **Desks follow their own rules**, not parking's window, cap or waitlist; do not "align" them (`desks.md`).
- **The floor plan is a static image**; desks are React `<rect>`s from database geometry. Never fetch, parse or inject the SVG as markup (the source app did, and it was a stored-XSS hole).
- **One technology set** is fixed: oRPC, Zod v4, Auth.js v5 with Okta JWKS validation in NestJS, Prisma 7, a mock OIDC server for dev and e2e. Do not swap any without the owner's approval.
- **No test-only branches.** Dev, e2e and production run the same code; only environment values differ.

## Glossary

| Term                   | Meaning                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| spot, group            | a parking space (`ParkingSpot`, label like `E2.92`); group is `IT` or `SHARED`                                                   |
| lot, day grid          | the main parking screen: one day, every active spot                                                                              |
| reservation            | one holder (user or guest) on one spot for one day; unique per `(spot, date)` and per `(user, date)`                              |
| guest reservation      | a reservation with `guestName` and no user, created by an admin                                                                  |
| timed reservation      | an admin guest block on a half-hour grid; exclusive with a full-day reservation on the same spot-day                              |
| reservation window     | how many days before a month it opens; `lockMode` AUTO, FORCE_OPEN or FORCE_LOCKED; admins are exempt                            |
| monthly cap            | the admin-set maximum reservations one person may hold per month                                                                 |
| waitlist, promotion    | a per-spot-per-day queue; a cancellation hands the spot to the next entry in the same transaction                                |
| bulk booking           | `previewBulk` and `confirmBulk`: assign a person's chosen days of a month in one transaction                                     |
| business day           | a weekday that is not a Czech public holiday; nothing is bookable on any other day                                               |
| office                 | the site that scopes desks, zones, spots and users (`Praha`); a user with none cannot book desks                                  |
| zone, desk, hive       | a floor-plan area, a bookable desk with geometry, and a team's group of desks with an owner and members                           |
| permanent desk         | a desk assigned to one user; its holder cannot book any other desk                                                               |
| grant, release         | a standing right to book one desk; a permanent holder freeing their desk for a day                                               |
| approval request       | a request to book a desk the requester has no right to, decided by an authorised person                                          |
| employee sync          | HiBob/Keboola push to `POST /api/employee-sync` that creates, updates and deactivates users; dry-run until an admin sets live    |
| cell lock              | a courtesy editing hold on one day-by-spot cell, broadcast over Socket.io; books nothing, lapses after `REALTIME_LOCK_TTL_MS`     |
| ICS token              | the 32-byte path credential of a user's calendar feed; regenerating it invalidates the old URL                                   |
| singleton settings     | a one-row table enforced by `CHECK (id = 1)`: window, limits, employee-sync settings                                              |
| persona                | a seeded dev/e2e account (`dev-admin`, `dev-user`, ...) signed in through the mock issuer                                         |
| `DomainError`          | a typed backend failure carrying a contract error code, translated to an oRPC error                                              |
