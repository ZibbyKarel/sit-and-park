# Contract

`libs/sit-and-park/contract` is the single source of truth for every data shape that crosses the frontend/backend boundary. No endpoint, DTO or realtime event may exist in code before it exists here. Validation is Zod-only; `class-validator` and `class-transformer` are not used.

## Two libs

| lib                              | tags                                            | what it is                                                    | must not contain                                           |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `libs/sit-and-park/shared-types` | `type:util`, `scope:shared`, `layer:foundation` | domain constants and pure date-only logic for `Europe/Prague` | Zod, next-intl, any runtime dependency                     |
| `libs/sit-and-park/contract`     | `type:contract`, `scope:shared`                 | Zod schemas, the oRPC contract, the realtime events           | anything from npm besides `zod`, `@orpc/contract`, `tslib` |

`shared-types` is imported by the API and by `libs/shared/i18n` (which re-exports its barrel to the browser), so it stays free of Zod and frontend libraries. The contract may use `@orpc/contract` but never `@orpc/client` or `@orpc/server`; ESLint enforces this so the contract cannot reach for transport. The dependency runs one way: `contract` to `shared-types`.

## Layout of `libs/sit-and-park/contract/src`

```
index.ts            entry point @sit-and-park/contract (schemas + api)
schemas/            shared by both entry points: primitives, enums (Zod wrappers over
                    shared-types tuples), entities, reservation-window, reservation-limits, errors
api/                oRPC procedures, one file per domain
  builder.ts        `authed`, `contractErrors()`, `noInputSchema` (not re-exported)
  errors.ts         ERROR_DEFINITIONS (HTTP status + default message per code)
  router.ts         `contract` (the whole router), `Contract`, `ContractClient`
  ics.ts            ICS feed URL helpers (the feed itself is outside oRPC)
realtime/           entry point @sit-and-park/contract/realtime
  events.ts, commands.ts, event-maps.ts, rooms.ts, socket-path.ts
__fixtures__/       test fixtures, excluded from tsconfig.lib.json
```

`schemas/` is shared by both branches, so it also holds the projections both need: `userSummarySchema` (how a user looks to another user: `id`, `name`, `licensePlate`) and `publicReservationSchema`. `src/realtime` never imports from `src/api`.

`builder.ts` is deliberately not exported from the package: a procedure defined outside the contract lib is exactly what contract-first forbids, and an exported builder invites it.

`router.ts` exports `Contract` and `ContractClient` (`ContractRouterClient<Contract>` already applied). `libs/shared/api-client` types its client as `ContractClient`, so `@orpc/contract` stays allow-listed for the `type:contract` tag alone.

## Rules

- **Types are derived.** Every type is `z.infer` of its schema, never hand-written beside it. Where a schema has `.default()`, `z.infer` is the output shape and `z.input` the pre-validation shape; `reservationWindowSettingsSchema` and `reservationLimitSettingsSchema` export both.
- **Enum values live in `shared-types`** as `as const` tuples (`PARKING_GROUPS`, `USER_ROLES`, ...). The contract wraps them with `z.enum(...)`; `enums.spec.ts` checks the two sides have not drifted.
- **Schemas validate shape, not database-dependent rules.** Anything needing a lookup (the reservation window, a deactivated spot, the monthly cap, business-day eligibility) is a service-layer check.
- **Errors are typed contract errors** (below). A procedure with no declared errors is almost certainly wrong, and so is one that declares a code whose trigger nobody can name.
- **Every procedure has an input schema**, even one with no arguments: those use `noInputSchema` (`z.strictObject({}).optional()`). It accepts `undefined` (an RPC call) and `{}` (an argument-less OpenAPI GET) but rejects any key, so an accidental payload is not silently discarded.
- **Every desk procedure carries a `.route({ description })`**, asserted in `router.spec.ts`, so the contract can be exposed as tools later.
- **The router grouping is an authorization boundary.** Everything under `admin.` requires `role: 'ADMIN'`; everything else needs an active user.

## Dates and time

| what                | schema                                 | note                                                 |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| the reservation day | `dateOnlySchema` (`z.iso.date()`)      | `YYYY-MM-DD`, a `DATE` in Postgres, never a timestamp |
| a month             | `yearMonthSchema`                      | `YYYY-MM`, sorts lexicographically                   |
| a timestamp         | `timestampSchema` (`z.iso.datetime()`) | an ISO UTC string, not a `Date`                      |
| a half-hour time    | `halfHourTimeSchema`                   | `HH:MM` on the half-hour grid                        |
| an id               | `idSchema` (`z.uuid()`)                | the UUID version is deliberately unconstrained       |

All reservation dates are calendar days in Europe/Prague. `DateOnly` is an unbranded string. `dateOnlySchema` validates format and calendar validity (`2026-04-31` fails) and nothing else: not "in the past", not "inside the open window". Those are service checks.

`shared-types` provides the date logic: date-only arithmetic (`addDays`, `addMonths`, `differenceInDays`, `compareDateOnly`, `startOfMonth`, `toYearMonth`, `isWeekend`, `daysInMonth`, ...), Europe/Prague helpers (`todayInPrague`, `toDateOnlyInPrague`, ...), and Czech public holidays (`isCzechPublicHoliday`, `isBusinessDay`; Easter is computed, not tabulated). Arithmetic is calendar-based and the timezone is resolved at a single boundary. Only a deliberately narrow set of holiday symbols is exported, because this barrel reaches the browser bundle.

### Reservation window

`monthLockState()` / `isMonthOpen()` in `shared-types` are pure and descriptive: they report a state and enforce nothing.

```
FORCE_OPEN   -> OPEN
FORCE_LOCKED -> LOCKED
AUTO         -> OPEN once today >= first of month - openDaysBefore, else NOT_YET_OPEN
```

Under `AUTO` a month never closes; `LOCKED` is only an admin's `FORCE_LOCKED`. `isMonthlyCapInForce()` says the per-user monthly cap applies only under `AUTO`, while today lies inside the month's window (`reservationWindowRange`). Callers skip these checks where the lock does not apply: waitlist promotion is a system action, admins are not limited by the window, and cancelling or leaving a queue is always allowed.

## Error contract

Every failure that is not a transport problem is one of `ERROR_CODES`, a closed enum, wrapped in `errorShapeSchema`: `{ code, message, details? }`. The frontend branches on `code`; `message` is a developer-facing fallback for logs; Czech UI copy is keyed by code in `libs/shared/i18n`. `details` and oRPC's `data` are the same field.

`ERROR_DEFINITIONS` maps each code to an HTTP status and default message and is `satisfies Record<ErrorCode, ...>`, so a code without a definition does not compile. Statuses: `FORBIDDEN` and `DESK_ACCESS_DENIED` 403; `NOT_FOUND` 404; `VALIDATION_FAILED` 400; `PAST_DATE`, `OUT_OF_HORIZON`, `CANNOT_WAITLIST_OWN_SPOT` 422; `RESERVATIONS_LOCKED` 423; the remaining codes 409.

Codes: `SPOT_ALREADY_RESERVED`, `RESERVATION_LIMIT_REACHED` (already a reservation that day), `MONTHLY_RESERVATION_LIMIT_REACHED`, `PAST_DATE`, `OUT_OF_HORIZON`, `NOT_FOUND`, `FORBIDDEN`, `ALREADY_IN_WAITLIST`, `CANNOT_WAITLIST_OWN_SPOT`, `SPOT_NOT_OCCUPIED`, `VALIDATION_FAILED`, `CONFLICT`, `RESERVATIONS_LOCKED`, and the desk codes `DESK_ALREADY_RESERVED`, `DESK_RESERVATION_LIMIT_REACHED`, `DESK_NOT_AVAILABLE`, `DESK_ACCESS_DENIED`, `PERMANENT_DESK_HOLDER`, `NO_OFFICE_ASSIGNED`, `NO_PERMANENT_DESK`, `DESK_RELEASE_ALREADY_RESERVED`, `DESK_REQUEST_ALREADY_PENDING`, `DESK_REQUEST_ALREADY_DECIDED`, `NO_FREE_DAY`.

- `OUT_OF_HORIZON` (month is `NOT_YET_OPEN`) and `RESERVATIONS_LOCKED` (month is `LOCKED`, i.e. admin `FORCE_LOCKED`) are distinct because they tell the user different things. Both come from the service layer on top of `monthLockState()`, never from a schema.
- `SPOT_ALREADY_RESERVED` is an occupied spot; `CONFLICT` is the narrower case of a lost race that a unique constraint turned into an error instead of a double booking.
- `VALIDATION_FAILED` means "structurally fine but violates a domain rule that needs a lookup": a deactivated spot, a non-business day, a spot `group` outside the lot's allowed set, a role change that is not allowed, an inactive or out-of-office desk. A bad format is caught by the schema and returned as oRPC's own error.
- A procedure declares only codes it can return. The input range limits (`MAX_MONTH_WINDOW_SPAN`, `MAX_BULK_BOOKING_DAYS`, the desk series limits) live in the schema, so clients learn them from it and `admin.window.months` and `overview.day` declare no `VALIDATION_FAILED`.
- Transport and authentication failures are not contract errors: see `doc/auth.md` for the 401/403 split. `libs/shared/api-client` reads failures with `toContractError()`, which parses `error.code` through `errorCodeSchema` (it deliberately does not use oRPC's `isDefinedError`, because the API's filter marks every domain error `defined: false`).

## How procedures are built

```ts
authed.input(...).output(...).errors(contractErrors('NOT_FOUND', 'CONFLICT'))
```

`authed` is `oc.errors(contractErrors('FORBIDDEN'))`. Every procedure therefore declares `FORBIDDEN` (a deactivated user, `active: false`, is rejected before any handler runs), and the tables below omit it. `contractErrors()` returns a `Pick` of the definitions, so the client sees exactly the codes a procedure can produce.

## Procedures

Inputs and outputs are the schemas in `api/*.ts`; the tables give shape, caller and the declared errors beyond `FORBIDDEN`.

### Day overview and reservations

| procedure                  | input                     | output / notes                                                                                                 | errors |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| `overview.day`             | `{ date }`                | `{ date, window, canReserve, canReserveMonth, spots[], viewerReservationId }`                                  | none   |
| `reservation.create`       | `{ parkingSpotId, date, holder? }` | `Reservation`; `holder` (admin only) is `{ kind: 'USER', userId, licensePlate }` or `{ kind: 'GUEST', name, licensePlate }`, omitted means the caller                                                                                                  | `NOT_FOUND`, `SPOT_ALREADY_RESERVED`, `RESERVATION_LIMIT_REACHED`, `MONTHLY_RESERVATION_LIMIT_REACHED`, `PAST_DATE`, `OUT_OF_HORIZON`, `RESERVATIONS_LOCKED`, `VALIDATION_FAILED`, `CONFLICT` |
| `reservation.cancel`       | `{ reservationId }`       | `{ reservationId, date, parkingSpotId, promoted }`                                                             | `NOT_FOUND`, `CONFLICT` |
| `reservation.myMonth`      | `{ month }`               | `{ month, reservedDates[], count, cap \| null, reservations[], waitlist[] }`, caller-scoped                    | none   |
| `reservation.myReservations` | none                    | `{ reservations[] }`: future plus the last `DESK_HISTORY_MONTHS` (12) months, each with `parkingSpotLabel`      | none   |
| `admin.reservation.month`  | `{ userId, month }`       | `{ month, reservedDates[], count, cap \| null }` (admin route)                                                  | none   |

`overview.day` is everything the lot screen needs in one query, including the window state, so the client cannot render a day against a stale window. Three fields must not be confused:

- `window` is the `MonthWindowOverview` of the month `date` falls in. `lockMode !== 'AUTO'` means an admin overrode the state, and `windowFrom`/`windowTo` are then only hypothetical.
- `canReserve` is whether this user may reserve this day. It already accounts for window, admin exemption, the past and business days. The frontend never derives it from `window`.
- `canReserveMonth` is whether this user may reserve anywhere in that month (window and admin exemption only). `canReserve: false` with `canReserveMonth: true` is every weekend and holiday of an open month. Month-level screens (the bulk modal) read this one.

Other users are only ever sent as `userSummarySchema`; `email`, `oktaId` and `icsToken` never reach another browser. Each spot row carries `waitlistCount`, the viewer's own waitlist entry and position, and `timedReservations[]` (guest half-hour blocks, non-empty only while `reservation` is `null`).

`reservation.cancel` declares no window error: a regular user may cancel their own reservation at any time, including a locked month. Someone else's reservation gives `FORBIDDEN`; an admin may cancel any. `promoted: true` means the freed spot went straight to the first waitlist entry (a system action, so it is not blocked by a lock).

`cap` is the monthly cap in force, not the count of existing reservations. It comes from the `ReservationLimitSettings` singleton and rides with the count so the client's `cap - count` cannot disagree across two round trips. It is `null` when no cap applies to that month today (outside the `AUTO` window, or under either override); the client then does not bound the selection.

### Waitlist

| procedure        | input                     | output                                     | errors |
| ---------------- | ------------------------- | ------------------------------------------ | ------ |
| `waitlist.join`  | `{ parkingSpotId, date, holderId? }` (`holderId` admin only) | `{ entry, position }`                      | `NOT_FOUND`, `ALREADY_IN_WAITLIST`, `CANNOT_WAITLIST_OWN_SPOT`, `SPOT_NOT_OCCUPIED`, `RESERVATION_LIMIT_REACHED`, `PAST_DATE`, `OUT_OF_HORIZON`, `RESERVATIONS_LOCKED`, `VALIDATION_FAILED`, `CONFLICT` |
| `waitlist.leave` | `{ waitlistEntryId }`     | `{ waitlistEntryId, parkingSpotId, date }` | `NOT_FOUND`, `CONFLICT` |

Joining is a write and is blocked by the window; leaving is exempt from it (like cancelling, it moves others up). `RESERVATION_LIMIT_REACHED` on join is deliberate: a promotion would give the user a second reservation on a day they already hold, so they are refused up front. A promotion is not a procedure: it happens on the backend on cancellation and is reported as a realtime event.

### Bulk reservation (parking)

| procedure                 | input         | output                                               | errors |
| ------------------------- | ------------- | ---------------------------------------------------- | ------ |
| `reservation.previewBulk` | `{ dates[], holderId? }` | `{ month, preferredParkingSpotId, days[], freeSpots[], summary }` | `PAST_DATE`, `OUT_OF_HORIZON`, `RESERVATIONS_LOCKED`, `VALIDATION_FAILED`, `NOT_FOUND` |
| `reservation.confirmBulk` | `{ dates[], holderId?, spotChoices?[{ date, parkingSpotId }] }` | `{ month, preferredParkingSpotId, days[], summary }`, days carrying the ids of the written rows | the above plus `MONTHLY_RESERVATION_LIMIT_REACHED`, `CONFLICT` |

`previewBulk` writes nothing (no reservation, waitlist entry or audit row) but declares the same window errors as `confirmBulk`. The input validates structure only: non-empty, at most `MAX_BULK_BOOKING_DAYS` (31), no duplicates, one month. A past day or a closed window fails the whole request (`PAST_DATE`, `OUT_OF_HORIZON`, `RESERVATIONS_LOCKED`, naming the earliest offending day); weekends, holidays, full days and days already booked are per-day results inside a successful response, not errors. A day is a union on `outcome`: `SPOT_ASSIGNED` (spot, label, `isPreferredSpot`), `QUEUED` (spot, label, `waitlistPosition`) or `UNAVAILABLE` (`reason`: `ALREADY_HAS_RESERVATION`, `NOT_A_BUSINESS_DAY`, `NO_SPOTS_AVAILABLE`). In `confirmBulk`, `SPOT_ASSIGNED` also carries `reservationId` and `QUEUED` carries `waitlistEntryId`. The client computes the preview-versus-outcome diff by pairing arrays on `date`; the server does not know the preview. Business rules are in `doc/parking.md`.

### Spots, users, settings

| procedure               | input                                                                | output        | errors |
| ----------------------- | -------------------------------------------------------------------- | ------------- | ------ |
| `spot.list`             | none                                                                 | `{ spots[] }` (active, non-hidden; for the picker) | none |
| `admin.spot.list`       | `{ includeInactive = false, group? }`                                | `{ spots[] }` | none |
| `admin.spot.create`     | `{ label, group, evCharger?, officeId? }`                            | `ParkingSpot` | `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED` |
| `admin.spot.update`     | `{ id, label?, group?, active?, hidden?, evCharger?, officeId? }`               | `ParkingSpot` | `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED` |
| `admin.spot.deactivate` | `{ id }`                                                             | `ParkingSpot` | `NOT_FOUND`, `CONFLICT` |
| `admin.user.list`       | `{ role?, active?, search?, excludingReservedOrQueuedFor? }`                                        | `{ users[] }` | none |
| `admin.user.update`     | `{ id, role?, active?, officeId?, manualAccount? }`                  | `AdminUser`   | `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED` |
| `me.get`                | none                                                                 | `MyProfile`: the user including `icsToken`, plus `hiveId`, `permanentDeskId`, `ownsHive` | none |
| `me.updateSettings`     | `{ licensePlate?, preferredParkingSpotId?, preferredDeskId? }`       | `MyProfile`   | `NOT_FOUND`, `VALIDATION_FAILED` |
| `me.regenerateIcsToken` | none                                                                 | `{ icsToken }` | none |

Spot `CONFLICT`: a duplicate `label` (unique across the lot) on create/update, or future reservations on deactivate. Deactivation is a soft delete (foreign keys from reservations and the audit log). Users are never created through the API (provisioned from the token on first login, see `doc/auth.md`) or deleted (offboarding is `active: false`). `adminUserSchema` is `userSchema.omit({ icsToken: true })`, so a new entity field shows up in the admin view by default while the token never does. `admin.user.update` `CONFLICT` guards against lock-out: demoting or deactivating the last active admin, and deactivating yourself.

`me.updateSettings` is a partial update with three states per field: absent (unchanged), `null` (clear), a value (set). `preferredParkingSpotId` is the first choice of bulk reservation only and has no effect on a single-day reservation. `preferredDeskId` likewise feeds `desk.previewBulk` only; `NOT_FOUND` for an unknown desk, `VALIDATION_FAILED` for an inactive one or one outside the caller's office.

`me.regenerateIcsToken` declares no `CONFLICT`: the only collision is a unique-constraint hit on a fresh random token, which the handler retries internally.

### ICS feed

The feed is outside oRPC: calendar clients cannot send headers, so it is a plain `GET` authenticated by an unguessable token in the path. The contract owns the URL shape so API and web cannot drift:

```ts
ICS_FEED_BASE_PATH; // '/api/calendar'  (includes the API's global prefix)
buildIcsFeedPath(token); // '/api/calendar/<token>.ics'
buildIcsFeedUrl(base, token); // trims trailing slashes, percent-encodes the token; empty base or token throws
```

`me.regenerateIcsToken` returns only the token; the client builds the URL from its own origin. Regenerating invalidates the old address immediately, which the UI must say.

### Reservation window and limits (admin)

| procedure                        | input                            | output                      | errors |
| -------------------------------- | -------------------------------- | --------------------------- | ------ |
| `admin.window.get`               | none                             | `ReservationWindowSettings` | none |
| `admin.window.update`            | `{ openDaysBefore?, lockMode? }` | `ReservationWindowSettings` | `VALIDATION_FAILED`, `CONFLICT` |
| `admin.window.months`            | `{ from, to }` (`YYYY-MM`)       | `{ months[], settings }`    | none |
| `admin.reservationLimits.get`    | none                             | `ReservationLimitSettings`  | none |
| `admin.reservationLimits.update` | `{ monthlyReservationCap? }`     | `ReservationLimitSettings`  | `VALIDATION_FAILED`, `CONFLICT` |

Both updates are replacements, not patches: the input is the settings schema itself, so an omitted field falls back to its default (`openDaysBefore` 7, `lockMode` `AUTO`, `monthlyReservationCap` 5), not to the stored value. Always send every field. `openDaysBefore` is bounded by `MIN/MAX_OPEN_DAYS_BEFORE` (1 to 31), the cap by `MIN/MAX_MONTHLY_RESERVATION_CAP` (1 to 31). `admin.window.months` returns months ascending with the settings they were derived under; `from <= to` is checked in the schema and the span is bounded by `MAX_MONTH_WINDOW_SPAN` (24). Regular users get window state from `overview.day` and the cap from `reservation.myMonth`.

### Timed reservations (admin)

| procedure                       | input                                                                  | output                                        | errors |
| ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | ------ |
| `admin.timedReservation.create` | `{ parkingSpotId, date, startTime, endTime, guestName, licensePlate }` | `TimedReservation`                            | `NOT_FOUND`, `SPOT_ALREADY_RESERVED`, `PAST_DATE`, `VALIDATION_FAILED`, `CONFLICT` |
| `admin.timedReservation.cancel` | `{ timedReservationId }`                                               | `{ timedReservationId, date, parkingSpotId }` | `NOT_FOUND` |

A guest block is half-open on the half-hour grid (`10:00`-`11:00` and `11:00`-`12:00` do not overlap) and is a separate row from `Reservation`, so the waitlist, promotion, bulk allocator, cap, ICS feed and Slack never learn a second meaning for a reservation row. `SPOT_ALREADY_RESERVED` covers both a full-day reservation that day and an overlapping block; a database trigger enforces both. `PAST_DATE` and `VALIDATION_FAILED` (non-business day) come from the same policy guard as `reservation.create`; admins are exempt from the window, so `OUT_OF_HORIZON` and `RESERVATIONS_LOCKED` are not declared. A spot with guest blocks has no waitlist.

### Desks

Rules are in `doc/desks.md`. All procedures declare `FORBIDDEN` via `authed`; the lists below give the other codes. `admin.*` is admin-only by router position.

| procedure                         | input                                                                | errors |
| --------------------------------- | -------------------------------------------------------------------- | ------ |
| `desk.directory`                  | `{ date }`; office, zones, hives, desks with status, own reservation and pending request | `NO_OFFICE_ASSIGNED` |
| `desk.previewSeries`              | `{ deskId, dates[1..20] }`, span at most 34 days; per-day `{ ok, reason }` | `NOT_FOUND`, `NO_OFFICE_ASSIGNED`, `PERMANENT_DESK_HOLDER`, `DESK_NOT_AVAILABLE`, `DESK_ACCESS_DENIED` |
| `desk.reserve`                    | as `previewSeries`; `{ reserved[], skipped[{ date, reason }] }`      | the above plus `NO_FREE_DAY`, `DESK_ALREADY_RESERVED`, `DESK_RESERVATION_LIMIT_REACHED`, `CONFLICT` |
| `desk.previewBulk`                | `{ dates[1..31] (one month), userIds?[1..50], deskIds?[1..500] }`; rows `ASSIGNED`, `UNASSIGNED` or `UNAVAILABLE`, plus free desks | `NOT_FOUND` |
| `desk.confirmBulk`                | `{ assignments[{ userId, date, deskId }] }`, unique per person+day and desk+day | `NOT_FOUND`, `CONFLICT` |
| `desk.cancel`                     | `{ reservationId }`                                                  | `NOT_FOUND`, `PAST_DATE` |
| `desk.myReservations`, `desk.myRequests` | none; future plus the last 12 months                          | none |
| `desk.requestApproval`            | `{ deskId, date }`                                                   | `NOT_FOUND`, `PAST_DATE`, `NO_OFFICE_ASSIGNED`, `PERMANENT_DESK_HOLDER`, `DESK_NOT_AVAILABLE`, `DESK_RESERVATION_LIMIT_REACHED`, `DESK_ALREADY_RESERVED`, `DESK_REQUEST_ALREADY_PENDING`, `VALIDATION_FAILED` |
| `desk.cancelRequest`              | `{ requestId }`                                                      | `NOT_FOUND`, `DESK_REQUEST_ALREADY_DECIDED` |
| `desk.pendingRequests`            | none; requests awaiting the caller (hive owner or admin; not under `admin` because owners are not admins) | none |
| `desk.decideRequest`              | `{ requestId, approve }`; `{ request, reservation \| null }`         | `NOT_FOUND`, `DESK_REQUEST_ALREADY_DECIDED`, `PAST_DATE`, `PERMANENT_DESK_HOLDER`, `DESK_NOT_AVAILABLE`, `DESK_RESERVATION_LIMIT_REACHED`, `DESK_ALREADY_RESERVED`, `VALIDATION_FAILED`, `CONFLICT` |
| `desk.myReleases`                 | none; permanent desk plus releases, or `null`                        | none |
| `desk.release`                    | `{ dates[1..60] }`; `{ added }`                                      | `NO_PERMANENT_DESK`, `PAST_DATE` |
| `desk.cancelRelease`              | `{ releaseId }`                                                      | `NOT_FOUND`, `DESK_RELEASE_ALREADY_RESERVED` |
| `admin.desk.list` / `.stats`      | `{ date, officeId? }`                                                | `.stats`: `NOT_FOUND` |
| `admin.desk.update`               | `{ deskId, active?, hiveId?, zoneId?, officeId? }`                   | `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT` |
| `admin.desk.bulkUpdate`           | `{ deskIds[1..500], active?, hiveId? }`                              | `NOT_FOUND`, `CONFLICT` |
| `admin.desk.setPermanentAssignee` | `{ deskId, userId \| null }`                                         | `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT` |
| `admin.desk.grants` / `.setGrant` | `{ deskId }` / `{ deskIds[1..500], userId, granted }`                | `NOT_FOUND` |
| `admin.hive.list`                 | none                                                                 | none |
| `admin.hive.create` / `.update`   | `{ name, color, ownerId }` / partial plus `hiveId`                   | `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT` |
| `admin.hive.delete`, `.setMembership` | `{ hiveId }` / `{ hiveId, userId, member }`                      | `NOT_FOUND` |
| `admin.office.list` / `.create` / `.update` | none / `{ name, active }` / partial plus `officeId`        | create `CONFLICT`; update `NOT_FOUND`, `CONFLICT` |
| `admin.zone.list` / `.create` / `.update` | `{ officeId }` / `{ officeId, key, name }` / `{ zoneId, name }` | create `NOT_FOUND`, `CONFLICT`; update `NOT_FOUND` |
| `admin.employeeSync.get` / `.setLiveMode` | none / `{ liveMode }`; `{ liveMode, configured, runs[] }`    | none |

A series call skips blocked days with a `DeskSkipReason` instead of failing; `NO_FREE_DAY` means none was left. Desk-level blockers fail the whole call. The employee sync itself (`POST /api/employee-sync`, bearer key) is outside oRPC.

## Realtime (`@sit-and-park/contract/realtime`)

The Socket.io half has its own entry point so the RPC builder never reaches the browser socket bundle or the gateway. The root `index.ts` does not re-export it, and nothing under `src/realtime` imports `src/api`. `no-orpc.spec.ts` walks the actual module graph from `realtime/index.ts` and fails on any `@orpc/*` or `api/` file; the walker must also find `@orpc/contract` from `api/index.ts`, otherwise it would pass by not searching. `SOCKET_IO_PATH` (`/socket.io`) lives here as the one value server and client both use.

**Rooms.** One room per day, `day:YYYY-MM-DD`, from `roomForDate(date)`, which throws on an invalid date. The name is derived, never stored.

**Server to client events** go to the whole day room, only after the transaction commits.

| event                        | payload                                                                                   | when |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ---- |
| `cell:locked`                | `{ date, parkingSpotId, lockedBy, expiresAt }`                                            | someone started editing a cell |
| `cell:unlocked`              | `{ date, parkingSpotId }`                                                                 | the lock was released, expired or dropped with the socket |
| `reservation:created`        | `{ date, parkingSpotId, reservation }`                                                    | a free spot is now occupied |
| `reservation:cancelled`      | `{ date, parkingSpotId, reservationId }`                                                  | the spot is free and stays free |
| `reservation:reassigned`     | `{ date, parkingSpotId, cause, previousReservationId, reservation, fromWaitlistEntryId }` | the holder changed within one transaction |
| `waitlist:updated`           | `{ date, parkingSpotId, waitlistCount }`                                                  | a cell's waitlist got longer or shorter |
| `timed-reservations:updated` | `{ date, parkingSpotId, timedReservations[] }`                                            | a guest block was created or cancelled |
| `desk:reserved`              | `{ date, deskId, reservationId, userId, userName }`                                       | a desk reservation was created |
| `desk:released`              | `{ date, deskId, reservationId }`                                                         | a desk reservation is gone (not a `DeskRelease`) |

- Names are `<subject>:<past-participle>`: an event announces something already committed. Commands use the imperative (`cell:lock`), so direction reads from the name. `cell` is one (spot, date) cell of the grid; `cell:locked` has nothing to do with `MonthLockState.LOCKED`.
- **One transaction, one event.** A cancellation that promotes the first waitlist entry sends `reservation:reassigned` instead of `reservation:cancelled`, never both, so clients do not flash the cell empty. `waitlist:updated` is not sent for that promotion: a non-null `fromWaitlistEntryId` means the cell's waitlist is one shorter and the client decrements locally or reloads.
- `reservation:reassigned` is its own event because a promotion is a system action exempt from the window lock; `reservation:created` in a locked month would look like a violation. `cause` is from `RESERVATION_REASSIGN_CAUSES` (today only `WAITLIST_PROMOTION`).
- `timed-reservations:updated` carries the whole current list, not a delta, so a client that missed an event self-heals on the next one.

**Client to server commands:**

| command           | payload                   | ack |
| ----------------- | ------------------------- | --- |
| `day:subscribe`   | `{ date }`                | none |
| `day:unsubscribe` | `{ date }`                | none |
| `cell:lock`       | `{ date, parkingSpotId }` | `{ result: 'ACQUIRED', expiresAt }` or `{ result: 'HELD_BY_OTHER', lockedBy, expiresAt }` |
| `cell:unlock`     | `{ date, parkingSpotId }` | none |

The gateway looks the event up in `CLIENT_TO_SERVER_EVENT_SCHEMAS`, `safeParse`s the payload and only then runs the handler; invalid payloads are dropped and unknown names are not handled. The registries are what `ServerToClientEvents` / `ClientToServerEvents` are derived from, so a command without a schema cannot be declared. Inbound schemas are `strictObject` (unknown keys rejected; outbound stay lenient so a client tolerates a newer server) and use no `z.any`, `z.unknown`, `z.record` or passthrough. The socket carries subscriptions and the editing lock only: reservations are never created or cancelled over it. Re-sending `cell:lock` for a held cell extends the TTL (no separate heartbeat). The lock is a courtesy, not authorization; a client that skips it gets `CONFLICT` from `reservation.create`.

**Not broadcast:** anything relative to the viewer (queue position; clients reload), anything secret (users go out as `userSummarySchema`), who is on a waitlist (only a count), and the reservation-window state (the banner catches up on the next `overview.day`; a `window:updated` event would be added to the contract first). Gateway and lock behaviour are in `doc/integrations.md`.

**Adding an event:** schema in `events.ts` (outbound) or `commands.ts` (inbound), derived from `schemas/` (`cellRefSchema` carries the date and spot pair); register it in `event-maps.ts`; add it to the expected list in `event-maps.spec.ts` with a payload test; describe it above.

## Adding to the contract

**A procedure:**

1. Input and output schemas as named constants in the domain file under `api/`, derived from entities (`.pick()`, `.omit()`, `.partial()`), never copied.
2. Build on `authed` with `.input()`, `.output()`, `.errors(contractErrors(...))`; `noInputSchema` for no arguments.
3. Wire it into `router.ts`, under `admin.` if it needs that role.
4. Add a `*.spec.ts`: valid input, invalid input, what the output guarantees.
5. Update `EXPECTED_PROCEDURES` and `EXPECTED_ERROR_CODES` in `api/router.spec.ts`. They are manual on purpose, so every change of the API surface shows in the diff.
6. Describe it in this document.

**A schema:** shared entities go in `schemas/entities.ts`, scalars in `schemas/primitives.ts`; a new enum value goes first into the tuple in `shared-types/src/lib/domain-constants.ts`, then into the Zod wrapper in `schemas/enums.ts`. Reuse `idSchema`, `dateOnlySchema`, `timestampSchema`; export the type via `z.infer` (plus `z.input` when there is a `.default()`); test valid, invalid and edge values (for an enum, the exact list); re-export from `schemas/index.ts`. Then `pnpm lint && pnpm typecheck && pnpm test`.

Never added: an ad-hoc error shape, database-dependent validation in a schema, a new error code that is undocumented here, a new audit action without extending `AUDIT_LOG_ACTIONS`, or an import from `@orpc/client` / `@orpc/server`.

## Tooling notes

- `@orpc/contract` is ESM-only and Jest runs CommonJS, so `jest.config.cts` transpiles the `@orpc` packages (`buildTransformIgnorePatterns` from the root `jest.preset.js`, an `.mjs` ts-jest transform, `mjs` in `moduleFileExtensions`, `allowJs` in `tsconfig.spec.json`). Any project importing the contract in a Jest test needs the same.
- The API implements the contract with `@orpc/server` plus one Nest route per procedure delegating to a shared RPC handler, served under `/api/rpc/`; see `doc/backend.md`.
