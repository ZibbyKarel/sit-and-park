# Backend

`apps/sit-and-park/api` (NestJS 11) and the database behind it (PostgreSQL 17, Prisma 7, `libs/sit-and-park/database`). Covers the HTTP and oRPC transport, the operational baseline, the module rules, and the schema. Parking domain rules are in `parking.md`, desks in `desks.md`, auth in `auth.md`, sockets and Slack in `integrations.md`. Environment variables are in `workspace.md`.

## Module map

`AppModule` (`api/src/app/app.module.ts`) imports `ConfigModule` first on purpose: `validateApiEnv` runs during its init, so a bad variable aborts the boot before anything else starts.

| Folder                | Owns                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `orpc/`               | the oRPC transport: route helper, implementer, handler, error mapping                                  |
| `auth/`               | JWKS verification, guards, JIT provisioning (`auth.md`)                                                |
| `database/`           | `PrismaService`, `DatabaseModule`                                                                      |
| `spots/`, `users/`, `me/` | parking spots, admin user management, the caller's own settings                                    |
| `reservation-window/`, `reservation-limits/` | the two singleton admin settings                                                |
| `overview/`           | `overview.day`, the one-request day screen                                                             |
| `reservations/`       | reservations, waitlist, bulk booking, after-commit event publishing (`parking.md`)                     |
| `timed-reservations/` | admin-only guest half-hour blocks                                                                      |
| `desks/`, `desk-admin/`, `employee-sync/` | desk booking, desk administration, HR sync (`desks.md`, `integrations.md`)         |
| `calendar/`           | the ICS feed, the one controller outside the contract                                                  |
| `realtime/`, `slack/`, `scheduling/` | Socket.io gateway and locks, outbound Slack, in-process job runner                      |
| `audit/`              | `AuditLogService`                                                                                      |
| `health/`, `logging/`, `shutdown/`, `common/` | operational baseline, `prisma-mapping.ts`, `office-scope.ts`, error filter, throttling |
| `testing/`            | `PrismaDouble`, `nest-test-app.ts`, the throwaway-database harness                                     |

Not here and not meant to be: Sentry, metrics, APM, alerting, Redis, BullMQ or any broker. Logging, probes and graceful shutdown are hygiene, not monitoring. Validation is Zod only; `class-validator` and `class-transformer` are not used.

## Startup and HTTP wiring

`main.ts` creates the app with `bufferLogs: true` and `bodyParser: false`, installs pino, reads `PORT`, calls `configureApp()` and listens. `configureApp()` (`api/src/configure-app.ts`) applies, in order:

1. global prefix `api`, excluding the two health routes;
2. `helmet()` with defaults;
3. CORS: the explicit `CORS_ALLOWED_ORIGINS` list with `credentials: true`, never `origin: true` or `*` (the API is cookie/bearer authenticated, so a reflected origin is a CSRF surface);
4. body parsers: one JSON parser on `EMPLOYEE_SYNC_PATH` with the larger `EMPLOYEE_SYNC_BODY_LIMIT`, registered first (body-parser skips an already-parsed body), then JSON and urlencoded at `BODY_LIMIT`. Nest's own parser is off so exactly one set exists;
5. `configureRealtime` (the Socket.io server and its CORS list);
6. `enableShutdownHooks()` before `listen()`, so a SIGTERM during startup is handled.

This lives in one function so that `main.ts` and `app/http-pipeline.spec.ts` run the same wiring. **Rule: any claim about what the API returns over the wire is verified in `http-pipeline.spec.ts`** (a real Nest server on a random port). A 413 returned as 500 and an overwritten readiness body were both invisible to tests calling a controller method directly. The filter, throttler guard and logger module are wired in `AppModule` so module-level tests get them too.

Global guards run in registration order, and the order is load-bearing: `ThrottlerGuard` (must cover unauthenticated traffic), `JwtAuthGuard` (authenticates unless `@Public()`), `RolesGuard` (reads the user the previous one set). `ContractExceptionFilter` is registered by `APP_FILTER` so it can take the pino logger.

Secrets come only from the environment.

### Env failure output

On a missing or invalid variable the process exits 1 with a Nest `ExceptionHandler` error that lists **all** bad variables, each with what is wrong, and never a value, so the text is safe to paste into a ticket. That output is not JSON: pino is installed after validation would have failed.

## oRPC transport

Every contract procedure is served over oRPC's RPC protocol at `POST /api/rpc/<procedure/path>` (`admin.spot.create` is `/api/rpc/admin/spot/create`), body `{ "json": <input>, "meta": [] }`, response `{ "json": <output> }`. Nothing in the web app builds these URLs by hand; `api-client`'s `RPCLink` does. Files in `api/src/orpc/`:

| File                    | Owns                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `rpc-route.ts`          | `RPC_PATH_PREFIX` (`/api/rpc`) and `rpcRoute(...segments)`, the single definition of where a procedure lives |
| `implementer.ts`        | `implement(contract).$context<OrpcContext>()` plus the error-mapping middleware                       |
| `rpc-route-handler.ts`  | one `RPCHandler`; `handle()` throws `NotFoundException` when no procedure matches                     |
| `to-orpc-error.ts`      | `DomainError` and Prisma errors to `ORPCError` with the status from `ERROR_DEFINITIONS`               |

Each procedure gets its own Nest route, `@Post(rpcRoute('admin', 'spot', 'create'))`, because the controller method is where authorization lives (`@Roles('ADMIN')`). One route per procedure rather than a wildcard, and the RPC protocol rather than `@orpc/nest`'s `@Implement`, for that reason.

`orpc-route-parity.spec.ts` walks the contract router and asserts every procedure has a `POST` Nest route, that `admin.*` procedures carry `@Roles` `['ADMIN']` and every other procedure carries none, and that each route implements its own procedure. `NOT_YET_IMPLEMENTED` there is empty; a procedure mounted without its guard fails the spec.

The oRPC context is `{ user: AuthenticatedUser }`. **Nothing in a service reads a user id from the payload**: `me.*` takes none; admin procedures take the subject's id and get the actor's from the context. No request shape lets one user act as another.

### Errors on the way out

Services throw `DomainError`; Prisma throws its own. Translation depends on where the throw happens:

- **inside a procedure**: the implementer's middleware maps it with `toOrpcError()`; anything unmappable is rethrown as a logged 500;
- **before a procedure** (guard, body parser, throttler): `ContractExceptionFilter` handles it. On an `/api/rpc` path it wraps a contract body in `{ json: ... }` so the client can read `code`.

Both paths produce byte-identical bodies for the same contract error (`orpc-pipeline.spec.ts`). A domain error is `{"defined":false,"code":"SPOT_ALREADY_RESERVED","status":409,"message":"...","data":{}}`. Transport failures keep Nest's `{ statusCode, message }`; an unknown error is the constant `{"statusCode":500,"message":"Internal server error"}`.

Rules of the filter:

- **The stack trace is logged and never sent.** A framework 4xx is logged at `warn` with status, method, path and reason and **without** the stack (a URL scanner would otherwise write a multi-kilobyte line per probe); `DomainError` and every 5xx keep theirs.
- The health check's body is the only 5xx body passed through unchanged; every other 5xx is replaced by the constant.
- The body parser's `PayloadTooLargeError` is not an `HttpException`; the filter recognises it by `http-errors`' `expose` flag and answers `413 {"statusCode":413,"message":"request entity too large"}`.
- **`P2002` is read from the driver adapter**, not `meta.target`: Prisma 7 with `@prisma/adapter-pg` puts the violated index at `meta.driverAdapterError.cause.constraint.index`. Both are read, `target` first (`common/errors/prisma-error-mapping.ts`). That is what turns `Reservation (parkingSpotId, date)` into `SPOT_ALREADY_RESERVED` (409) instead of a vague `CONFLICT`, and it is the concurrency guarantee of booking. The shape is pinned against a real server in `database-contract.db.spec.ts`.

### Storage to contract mapping

`common/prisma-mapping.ts` is the only place a Prisma row becomes a contract object. `toTimestamp` (Date to ISO 8601), `toDateOnly` (a `@db.Date` read with **UTC** getters to `YYYY-MM-DD`), `toDateColumn` (`YYYY-MM-DD` to UTC midnight, for querying). `toDateOnly` is not `toDateOnlyInPrague`: the first reads a zoneless calendar day, the second converts an instant to its Prague day. For a `@db.Date` they agree (Prague is always ahead of UTC), but `toDateOnly` states what the value is. Projections: `toContractUser` includes `icsToken` (the caller's own profile); `toAdminUser` omits it (an admin has no business holding anyone's calendar credential); `toUserSummary` is `{ id, name, licensePlate }`, what others see on an occupied spot.

## Operational baseline

### Logging

`nestjs-pino`, JSON, one object per line on stdout (`logging/logger.options.ts`). Always JSON; for readable dev output pipe through `pino-pretty` (not a dependency): `pnpm nx run api:serve | pnpm exec pino-pretty`.

| Field      | Value                                               |
| ---------- | --------------------------------------------------- |
| `level`    | the level name, not a number                        |
| `message`  | message text (not pino's `msg`)                     |
| `app`      | always `"api"`                                      |
| `env`      | `NODE_ENV`                                          |
| `req.id`   | incoming `x-request-id`, else a new UUID; echoed in the response header |

- Request-line level: 5xx or thrown error `error`, 4xx `warn`, otherwise `info`.
- **Health probes are not logged**, so they carry no `x-request-id`.
- **Redaction** is a list of specific paths: `authorization`, `cookie`, `set-cookie`. A new secret-carrying header must be added by hand.
- **A credential in the URL is a separate job.** The ICS feed authenticates by a token in the path (`GET /api/calendar/<token>.ics`), and a path reaches the log through four routes: `req.url`, `req.params`, and `path` and `reason` in the filter's `Request rejected` line (Nest's 404 message is `Cannot GET <url>`). All go through `redactIcsToken` (`logging/redact-ics-token.ts`), case-insensitively because Express matches paths case-insensitively; `req.params` is dropped because it holds the logger's own catch-all copy of the URL. `calendar-logging.spec.ts` is the only spec that reads emitted log lines (it boots at `LOG_LEVEL: 'info'`; every other spec pins `fatal`), so a claim about log contents without a test there has nothing behind it.

### Health probes

Both are outside `/api`, `@Public()` and `@SkipThrottle()`.

- `GET /health/live` never touches the database and returns 200 even with Postgres down. Failure means restart.
- `GET /health/ready` runs a real `SELECT 1` (`PrismaService.ping()`) under `HEALTH_DB_TIMEOUT_MS`. Failure is **503** and means take out of rotation, not restart. The reason is deliberately coarse (`Database is unreachable` or `Database did not respond in time`) because the `pg` error carries host, database and user, and the probe is visible to more people than the logs.
- `HEALTH_DB_TIMEOUT_MS` must stay under the orchestrator's probe timeout, or the orchestrator cuts the probe off first.

### Graceful shutdown

On SIGTERM/SIGINT Nest stops accepting connections, lets in-flight requests finish, runs `onModuleDestroy` (`PrismaService` closes the pool), then `onApplicationShutdown`. A live WebSocket is not an in-flight request, so the gateway registers a closer with `GracefulShutdownService.registerCloser(name, fn)` (`shutdown/`). Closers run after HTTP stops, are each awaited and individually caught (one throwing is logged and the rest still run), and registering a name twice replaces the earlier closer. A closer must finish or fail, never hang. `ScheduleModule.forRoot()` is registered once, in `SchedulingModule`; it also stops cron timers at shutdown.

### Rate limiting

One throttler: `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` (300 per minute) via `APP_GUARD`. The strict tier is the `StrictThrottle()` decorator (`common/throttling/throttle-tiers.ts`, 20 per minute) for endpoints reachable without a session: the ICS feed and `POST /api/employee-sync`. A second named throttler is impossible, because `@nestjs/throttler` applies every registered throttler to every route. `calendar-pipeline.spec.ts` proves the strict tier fires (200, 200, 429 with the limit at 2).

Counters are in memory (fine for one instance; at scale swap `ThrottlerStorage`). **Limitation: `trust proxy` is not set**, so the limiter buckets by socket IP and behind a reverse proxy every client shares one bucket. Before deploying behind a proxy set `app.set('trust proxy', ...)` to a hop count or CIDR range, never a bare `true` (that lets a client spoof `X-Forwarded-For`).

## Module rules

### Audit log

`AuditLogService.record(entry, writer = prisma.client)` (`audit/`). **Append-only is enforced by the database**, not this class (see Database). `writer` exists so a cancellation and the promotion that follows write their audit rows inside one transaction: pass the `Prisma.TransactionClient`. `entityType` is narrowed to `AUDIT_ENTITY_TYPES` so a typo cannot split one entity's history; `payload` is `Prisma.InputJsonObject` (the column is JSONB).

Actions, from the `AuditLogAction` enum: reservation created, cancelled, cancelled by admin, created by admin; waitlist joined, joined by admin, promoted; timed reservation created and cancelled; user updated and deactivated; spot updated; reservation window updated; reservation limits updated; desk reservation created, cancelled, cancelled by admin; desk released and release cancelled; desk approval requested and decided; desk, hive, office and zone updated; employee sync applied and settings updated.

Two omissions are intentional. **The ICS token never appears in a payload**: it is the only credential on the personal feed and an append-only table nobody can redact is the worst place for it (token regeneration records `change: 'ics-token-regenerated'` only). **A no-op writes nothing**, so deactivating an already-inactive spot records nothing; auditing a non-event pollutes the one table meant to answer "what changed". Desk catalogue edits are audited with `before`/`after`; desk grants and hive memberships are not.

### Parking spots

`spots/`. Routes: `spot.list`, `admin.spot.list|create|update|deactivate`.

- A spot is **never deleted** (`Reservation` and `WaitlistEntry` reference it `RESTRICT`, `AuditLog` names it by id); retiring is `active: false`.
- Order is `group` then `label` everywhere, from one constant, so a grid does not move between reads.
- `spot.list` returns active, non-hidden spots of the caller's office (the preferred-spot picker; hidden spots are excluded even for admins because bulk booking never assigns one). The day grid reads all active spots and filters hidden ones per viewer: admins see them. `admin.spot.list` takes `includeInactive` and `group`.
- A duplicate label is left to the unique index, not pre-checked (a read-then-write would still lose the race); `P2002` arrives as `CONFLICT`.
- Retiring a spot that still has reservations is refused with `CONFLICT` and `details.reservations`; "still has" is `date >= today` in Europe/Prague (`>=`, since a reservation for today is already parked on). `update({ active: false })` is held to the same rule. `deactivate` is idempotent.
- The set of hidden spot ids is mirrored in memory at boot for the realtime gateway, which decides per recipient what to broadcast.

### Users (admin)

`users/`. Routes: `admin.user.list`, `admin.user.update`. Users are never created here (provisioned from the Okta token at first sign-in) and never deleted; offboarding is `active: false`, and a deactivated user is refused at the guard with `FORBIDDEN` on the next request. `search` is a case-insensitive substring over name or email. Deactivation goes through `UserDeactivationService` (`employee-sync/`), shared with the sync.

Two lock-outs are refused with `CONFLICT`, because nothing in the API can recover from them: removing the **last active admin** (demotion or deactivation), and **deactivating yourself**. Demoting yourself while another admin exists is allowed. The last-admin check is a count then an update, so two admins demoting each other simultaneously could leave zero; accepted. Recovery then needs the database: `UPDATE "User" SET role = 'ADMIN', active = true WHERE email = '...';`.

### Personal settings

`me/`. Routes: `me.get`, `me.updateSettings`, `me.regenerateIcsToken`. The subject is always `context.user`. `updateSettings` is three-valued per field: absent leaves it alone, `null` clears, a value sets (`licensePlate`, `preferredParkingSpotId`, via `connect` or `disconnect`). A preferred spot must exist (`NOT_FOUND`) and be active (`VALIDATION_FAILED`). `regenerateIcsToken` retries a `P2002` up to `MAX_ICS_TOKEN_ATTEMPTS` (3); the contract declares no error for it (a collision of two 32-byte values is not a state a client can act on), so an unresolved one is a logged 500. The old feed URL stops working immediately.

### Reservation window and limits

`reservation-window/` (`admin.window.get|update|months`) and `reservation-limits/` (`admin.reservationLimits.get|update`), all `@Roles('ADMIN')`.

- **Nothing here decides whether a month is open.** `monthLockState()`, `isMonthOpen()` and `reservationWindowRange()` in `@sit-and-park/shared-types` own the rule; the service loads settings, takes today in Europe/Prague, delegates and shapes the answer. Re-deriving it, even "the easy case", makes the banner and the backend disagree. `windowFrom`/`windowTo` are always the AUTO rule's range even when `lockMode` overrides.
- Both settings rows are **upserted, and a missing row reads as the documented defaults** (7 days AUTO; cap 5), so a deployment whose seed has not run answers 200 rather than 500. `update` is a replacement, not a patch.
- `ReservationLimitsModule` is **not in the enforcement path**. The cap that rejects an over-quota insert is read by `readMonthlyReservationCap(tx)` inside the writer's own transaction (`reservations/monthly-reservation-cap.ts`); the service serves the admin screen and the month summary's `cap` field.

### Day overview

`overview/`, route `overview.day`, any authenticated user. One request paints the whole screen (grid, queue badges, the caller's position, the window banner), so the grid cannot render against a window fetched a second earlier. Four reads run in parallel: active spots, window settings, the day's reservations with holder summary, and the day's whole waitlist ordered by `createdAt` then `id`, counted in memory (count, caller-queued and position come from the same rows, and position is the row order promotion uses).

Two booleans, from two private halves:

```
canReserveMonth = role === 'ADMIN' || isMonthOpen(date, openDaysBefore, lockMode, today)
isReservableDay = date >= today && isBusinessDay(date)
canReserve      = canReserveMonth && isReservableDay
```

Admins are exempt from the window but a past day, weekend or Czech holiday is bookable by nobody. `canReserve: false` beside `canReserveMonth: true` is ordinary. **The frontend must not re-derive either from `window`** (the admin exemption is not in the payload), and a month-scoped screen must use `canReserveMonth`, not `canReserve`. Whether the caller already holds a reservation that day is deliberately not folded in; the screen reads `viewerReservationId`.

### Reservations, timed blocks, desks, calendar

`reservations/` serves `reservation.*`, `waitlist.*` and the bulk pair, open to any authenticated user because "may I cancel this?" is a fact about a row and lives in the service; only `admin.reservation.month` is `@Roles('ADMIN')`. Structure: `ReservationPolicy` (pure day eligibility), `ReservationsService`, `WaitlistPromotionService` (takes a `Prisma.TransactionClient`, never `PrismaService`), `WaitlistService`, `BulkReservationService` plus the pure `bulk-allocator.ts`, and `DomainEventPublisher`, the after-commit seam bound to `CompositeDomainEventPublisher` (Socket.io, then Slack, each in its own `try`; nothing that can block on the network runs inside a transaction). Reservation transactions use `RESERVATION_TRANSACTION_OPTIONS` (`maxWait` 5 s, `timeout` 15 s, above Prisma's 5 s default). Rules in `parking.md`.

`timed-reservations/` serves the two admin-only `admin.timedReservation.*` procedures and reuses `ReservationPolicy` and the publisher. `desks/`, `desk-admin/` and `employee-sync/` are in `desks.md` and `integrations.md`. `calendar/` serves `GET /api/calendar/:icsToken.ics`, the only route outside the contract: `@Public()` and `@StrictThrottle()`, every unservable token a `404` with a constant body (including a deactivated user's valid token, so a 401 cannot be used to enumerate), headers set inside the handler after the lookup, `DTSTAMP` equal to the reservation's `createdAt` so Express can `ETag` it and answer `304` (`integrations.md`).

`common/office-scope.ts` (`parkingOfficeOf`, `seesParkingOffice`, `defaultOfficeId`): parking spots are listed and booked within the user's office; a user with no office sees every office; `AuthUserService` gives a new user the oldest active office.

## Backend testing seams

Unit specs sit beside each service and run against `testing/prisma-double.ts`, an in-memory stand-in for `PrismaService` that copies every row it returns, raises a real `PrismaClientKnownRequestError` for unique violations, and **throws on any query shape it does not model** so an untested access pattern fails loudly instead of returning `[]`. It sorts only when `orderBy` is passed. The reservations module is the deliberate exception: its correctness is `FOR UPDATE`, isolation and the exact `P2002` shape, which a double cannot model, so everything there except `ReservationPolicy` is tested under `api:test-db` (`testing.md`). The `*.db.spec.ts` suites run in their own throwaway database per run (created by `testing/database/global-setup.ts`; the role in `DATABASE_URL` needs `CREATEDB`) and refuse to skip when `DATABASE_URL` is absent.

## Database

PostgreSQL 17 and Prisma 7. Everything lives in `libs/sit-and-park/database` (`type:data`, `scope:api`); the CLI config is `prisma.config.ts` at the repo root, because that is where the CLI looks and where `.env` lives. Prisma 7 does not load `.env` itself, hence `import 'dotenv/config'` as that file's first line. The contract (`libs/sit-and-park/contract/src/schemas/entities.ts`) is the source of truth for data shape; the Prisma schema mirrors it field for field, and `schema-contract-parity.spec.ts` guards it.

| Path (under `libs/sit-and-park/database/`)    | Purpose                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `prisma/schema.prisma`                        | the model                                                                |
| `prisma/migrations/`                          | SQL migrations and `migration_lock.toml`                                 |
| `src/generated/prisma/`                       | generated client, committed, never hand-edited                           |
| `src/lib/create-prisma-client.ts`             | the single place the client (driver adapter `@prisma/adapter-pg`) is made |
| `src/lib/seed-data.ts`, `src/scripts/seed.ts` | seed as plain data and the idempotent writer                             |
| `src/lib/floor-plan.ts`, `src/scripts/generate-floor-plan-sql.ts` | desk geometry and zones from the floor-plan SVG, and the Praha migration built from them |
| `src/scripts/reset-e2e.ts`                    | clears the e2e target month and widens the window (`database:reset-e2e`) |

The generated client is committed so lint, typecheck, test and build need no database and no generate step. Targets: `database:prisma-generate` (cached), `database:check-schema`, `database:reset-e2e`.

### Models

Identifiers are **UUID v7** (`@default(uuid(7))`, `UUID` column), generated by the Prisma Client, so a manual SQL insert supplies its own id. Entity ids are UUIDs because they travel in URLs and realtime payloads. Singleton tables use `id INTEGER = 1`, because that id is never exposed.

- Parking: `User`, `ParkingSpot` (`group` IT or SHARED, `active`, `hidden` for admins only, `evCharger` informational), `Reservation` (holder is a user **or** a guest; `guestName`, optional `licensePlate` override), `TimedReservation` (guest block on a half-hour grid, `startMinute`/`endMinute`), `WaitlistEntry`.
- Admin and audit: `AuditLog`, `ReservationWindowSettings` (`openDaysBefore` 1..31, `lockMode` AUTO, FORCE_OPEN or FORCE_LOCKED), `ReservationLimitSettings` (`monthlyReservationCap` 1..31).
- Desks and sync: `Office`, `Zone`, `Hive`, `HiveMembership`, `Desk`, `DeskGrant`, `DeskReservation`, `DeskRelease`, `DeskApprovalRequest`, `EmployeeSyncRun`, `EmployeeSyncSettings`.

`User` also carries `oktaId` (provisioning key), `icsToken`, `preferredParkingSpotId`, `preferredDeskId`, `officeId` (nullable: a just-provisioned account has none), `hibobId`, `manualAccount` and `deactivatedAt`. `Office` scopes desks, zones, spots and users; its `floorPlan` names a plan bundled with the web app (`apps/sit-and-park/web/public/floorplans/<name>.svg`), never a URL. `ParkingSpot.officeId` is required.

### Constraints the logic stands on

These are business rules enforced by the database; no application code is careful enough without them.

| Constraint                                                                       | Guarantees                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Reservation (parkingSpotId, date)` unique                                       | one reservation per spot per day; `P2002` maps to `SPOT_ALREADY_RESERVED`                                    |
| `Reservation (userId, date)` unique                                              | one per user per day; guest rows (`userId` null) are exempt, so one guest name can take every bay in a day   |
| `Reservation_holder_check`                                                       | `("userId" IS NULL) <> ("guestName" IS NULL)`: exactly one holder                                            |
| `WaitlistEntry (parkingSpotId, userId, date)` unique                             | cannot join the same queue twice                                                                             |
| `User.email`, `oktaId`, `icsToken` unique                                        | sign-in and the feed each resolve to one user (emails compared lower-cased)                                  |
| `ParkingSpot.label` unique                                                       | natural key, and what the seed upserts on                                                                    |
| `*Settings` `CHECK (id = 1)` and range checks                                    | singletons; ranges mirror the contract's min/max constants                                                   |
| `AuditLog_append_only` and `AuditLog_append_only_truncate` triggers              | `UPDATE`, `DELETE` and `TRUNCATE` raise `restrict_violation`                                                 |
| `TimedReservation_range_check`                                                   | half-open `[startMinute, endMinute)`, within one day, multiples of 30                                        |
| `timed_reservation_reject_conflict`, `reservation_reject_timed_conflict` triggers | a spot-day is one full-day `Reservation` **or** non-overlapping `TimedReservation` blocks, never both; raised as `unique_violation` (`TimedReservation_spot_day_conflict`, `Reservation_timed_reservation_conflict`), mapped to `SPOT_ALREADY_RESERVED` |
| Desk uniques                                                                     | `DeskReservation (deskId, date)` and `(userId, date)`, `DeskRelease (deskId, date)`, `HiveMembership.userId`, `Desk.permanentAssigneeId`, `DeskGrant (deskId, userId)`, `Zone (officeId, key)`, `Desk (officeId, code)` |
| `DeskApprovalRequest_pending_key`                                                | unique `(deskId, userId, date) WHERE status = 'PENDING'`; hand-written, Prisma does not know it            |
| `Hive_color_check`                                                               | `#RRGGBB`                                                                                                    |

The two spot-day triggers are serialised by a transaction-scoped advisory lock per `(parkingSpotId, date)` (`lock_spot_day`) so the exclusivity check under READ COMMITTED sees a consistent picture. The `Reservation` trigger is `AFTER`, not `BEFORE`: a reservation writer meets the `(parkingSpotId, date)` unique index first and only then the lock, so a create racing a promotion loses with `SPOT_ALREADY_RESERVED` instead of deadlocking.

Foreign keys are explicit: `User.preferredParkingSpotId` and `preferredDeskId` and `Desk.hiveId` are `SET NULL` (a preference is not a commitment; removing a hive frees its desks); `HiveMembership` and `DeskGrant` cascade with their parent; everything else is `RESTRICT`, so a user or spot with history is deactivated, never deleted. Beyond the unique indexes there are indexes for the day overview (`Reservation(date)`, `WaitlistEntry(date)`, `WaitlistEntry(parkingSpotId, date, createdAt, id)` for "who is next"), the audit screen, and every FK that `SET NULL` would otherwise scan.

### Why DATE, singletons, hard delete

**`date` columns are `DATE`.** A reservation day is a calendar day in Europe/Prague, not an instant; a timestamp would shift with zone. Contract `z.iso.date()`, Postgres `DATE`, Prisma `Date` at UTC midnight; the conversion happens only in the service layer (`prisma-mapping.ts`). `schema-contract-parity.spec.ts` asserts storage is `Date` and the contract is `string`.

**Singleton settings** (`ReservationWindowSettings`, `ReservationLimitSettings`, `EmployeeSyncSettings`) hold exactly one row: primary key plus `CHECK ("id" = 1)` makes a second row impossible for any writer (the app, `psql`, Adminer, a future migration); "the app only writes one row" is a habit, not enforcement. The row is inserted by the **migration** (`INSERT ... ON CONFLICT DO NOTHING`), because the table must never be empty and `db seed` does not run in production; the seed upserts it anyway. The window and the cap are separate tables because they never shared an identity (and the window model's name is stored as a literal in the append-only audit log, so it cannot be renamed).

**Hard delete plus `AuditLog`, not soft delete.** Cancelling deletes the row and writes an audit record. Soft delete would leave "cancelled" rows blocking the `(spot, date)` unique index (a partial index would work but every query must then remember it), force a filter on every read, and cover only deletion while the audit log must also answer "what changed" for actions that delete nothing. Users and spots are never deleted at all; hard delete applies only to short-lived, date-bounded reservations and waitlist entries. Because the audit log is the only record a reservation existed, it is append-only in the database. There are two triggers because `TRUNCATE` does not fire row-level triggers. The cost: a typo in a payload cannot be fixed, only superseded.

### Where storage differs from the contract

| Field                                            | Contract                          | Storage                                     | Why                                                                     |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `AuditLog.payload`                               | `Record<string, unknown>`         | `JSONB`                                     | shape depends on `action`; JSON `null` is allowed though column is `NOT NULL` |
| `EmployeeSyncRun.summary`                        | strict object                     | `JSONB`                                     | nested lists read whole, never queried into                            |
| every `date` column                              | `YYYY-MM-DD`                      | `DATE`                                      | see above                                                               |
| `TimedReservation.startTime`/`endTime`           | `HH:MM`                           | `startMinute`/`endMinute` `SMALLINT`        | range arithmetic and triggers are simpler on integers; `timeOfDayToMinutes` and `minutesToTimeOfDay` in `shared-types` convert at the boundary |
| `createdAt`, `updatedAt`                         | ISO 8601 string                   | `TIMESTAMPTZ(3)`                            | contract is transport-neutral                                           |
| singleton `id`, `updatedAt`                      | absent                            | `INTEGER`, `TIMESTAMPTZ(3)`                 | singletons are not addressed through the API                            |
| defaults (`role`, `active`, ...)                 | none                              | `DEFAULT`                                   | a safeguard; values do not change                                        |

### Migrations

Run everything from the repo root; `prisma.config.ts` resolves the library paths.

| Command                                      | Does                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| `pnpm exec prisma validate` / `format`       | check / format the schema (no DB)                          |
| `pnpm exec prisma generate`                  | regenerate the client (no DB)                              |
| `pnpm exec prisma migrate dev --name <name>` | author and apply a migration (dev)                         |
| `pnpm exec prisma migrate deploy`            | apply pending migrations; the only production verb         |
| `pnpm exec prisma migrate status`            | applied versus missing                                     |
| `pnpm exec prisma db seed`                   | run the seed                                               |
| `pnpm exec prisma studio`                    | data browser (dev)                                         |

**`prisma migrate reset` destroys the database** and is part of no routine; if the schema is behind, `migrate deploy` is the command.

**Hand-written SQL and `migrate dev`.** Checks, triggers, partial indexes and singleton inserts are not derivable from `schema.prisma`, so `migrate dev` sees them as drift and proposes dropping them. For every schema change: `prisma migrate dev --create-only --name <name>`, open the generated `migration.sql`, delete any `DROP CONSTRAINT`, `DROP TRIGGER` or `DROP INDEX` of those objects (including `DeskApprovalRequest_pending_key`), then `prisma migrate dev`. CI's `database:check-schema` catches a schema the migrations do not reproduce and a stale generated client. A value added with `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction, so enum additions get a migration of their own.

Migrations create the data a fresh database needs: office `Praha`, its 12 zones and 221 desks with geometry, and `officeId` on every user and spot. The Praha migration is **generated** from the floor-plan SVG (desk geometry is the axis-aligned box of `rect#desk_body_N` after all transforms); `floor-plan.spec.ts` checks it against each desk's label and that the committed migration is byte-for-byte the generator's output. A changed plan means a **new** migration, since an applied one's checksum is recorded. Its ids are `gen_random_uuid()` (v4); `uuid(7)` is a Prisma Client function, not SQL. A migration lower-cases `User.email` where unambiguous.

### Seed

Development fixture, idempotent (every write an upsert on a natural key, nothing deleted), never run against production. Creates 9 parking spots (`E2.92`-`E2.95` IT; `E2.96`, `E2.65`, `E2.66`, `E2.61`, `E2.62` SHARED), users `admin@example.com` (ADMIN), `user@example.com`, `user2@example.com`, `inactive@example.com` (deactivated) and `desk@example.com` (permanent holder of `D-013`, deliberately not an e2e persona), window settings (7 days, AUTO), cap 5, hives `Engineering` and `Sales`, a direct grant of `D-042` to `user@example.com`, and sync `liveMode = false`, all in `Praha`. Reservations and waitlist entries are not seeded (date-bound). The seeded `oktaId` values (`dev-admin`, `dev-user`, `dev-user-2`, `dev-inactive`, `dev-desk-holder`) are what a developer types into the mock issuer's form to land on that account; the API matches by email, supplied as an optional claim (`testing.md`).

### Backups

Single instance, no managed backup: the backup is `pg_dump`.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=sit-and-park-$(date +%F).dump
# from a container with no local pg_dump; single quotes so the CONTAINER expands the variables
docker compose --env-file .env.docker exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > sit-and-park-$(date +%F).dump
```

Expanded by your shell instead, the variables are empty and `pg_dump` fails as the container's own user (`role "root" does not exist`), leaving a zero-byte dump. Restore a full dump into an empty database with `pg_restore --dbname="$DATABASE_URL" --clean --if-exists <file>`. To restore data only, into a database where `migrate deploy` has already run:

- Delete the rows migrations inserted first (`ReservationWindowSettings`, `ReservationLimitSettings`, `EmployeeSyncSettings`, then `Desk`, `Zone`, `Office`), because `--data-only` goes through `COPY` with no `ON CONFLICT`: `pg_restore` reports the conflict, carries on and exits 0, silently keeping the migration's defaults.
- Do not use `--clean` with `--data-only`: it `TRUNCATE`s tables and the `AuditLog_append_only_truncate` trigger refuses. Restore into the empty table, or disable that trigger for the duration and re-enable it. The row-level trigger does not block `INSERT`/`COPY`.
- `_prisma_migrations` is part of a full dump, so migration history comes back with it.
