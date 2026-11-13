# Parking

Reservations, the waitlist with auto-promotion, the reservation window, the monthly
cap, guest blocks and bulk reservation. Desks are separate and deliberately do not
share these rules (`doc/desks.md`). Event publishing, Slack and the ICS feed are in
`doc/integrations.md`.

Code: `apps/sit-and-park/api/src/{reservations,reservation-window,reservation-limits,spots,timed-reservations}/`,
the pure window rules in `libs/sit-and-park/shared-types/src/lib/reservation-window.ts`, shapes in
`libs/sit-and-park/contract/src/api/{reservations,waitlist,bulk,reservation-window,reservation-limits,timed-reservations}.ts`,
the web side in `apps/sit-and-park/web/src/lot/`.

## Model

- `ParkingSpot`: `label`, `group` (`IT` before `SHARED` in every ordering), `active`
  (false = retired), `hidden`, `evCharger`, `officeId` (required).
- `Reservation`: one spot, one day. Unique `(parkingSpotId, date)` and `(userId, date)`.
  The holder is a user or a guest (`guestName`, no `userId`), never neither; `licensePlate`
  freezes the plate shown for that booking. A guest has no `(userId, date)` limit.
- `WaitlistEntry`: unique `(parkingSpotId, userId, date)`. Queue order is `createdAt`, then
  `id` (`reservations/waitlist-order.ts`, used by every reader of a queue, so the position shown
  is the one promotion acts on). Entries are hard-deleted on promotion, leave and cancellation.
- `TimedReservation`: half-hour-granular guest blocks on a spot and day, admin-only
  (`admin.timedReservation.create` / `.cancel`). A (spot, day) is either one full-day
  `Reservation` or any number of non-overlapping blocks, never both; a check constraint and
  triggers enforce it and a violation is `SPOT_ALREADY_RESERVED`. A spot with blocks has no
  queue (`waitlist.join` answers `SPOT_NOT_OCCUPIED`); bulk allocation treats it as blocked.
- `ReservationWindowSettings` and `ReservationLimitSettings`: singletons (`id` fixed by a CHECK).
  A missing row answers the documented default.

Dates are date-only (`YYYY-MM-DD`), Europe/Prague. Time zones live in the shared-types helpers
(`todayInPrague`, `isBusinessDay`, `czech-holidays.ts`, hand-rolled); services take `today` as a
parameter so tests never depend on the clock.

## The reservation window

Settings: `lockMode` (`AUTO`, `FORCE_OPEN`, `FORCE_LOCKED`; default `AUTO`) and `openDaysBefore`
(1 to 31, default 7). `monthLockState` is the only implementation of the rule; nothing
re-derives it, schemas do not encode it (it depends on a database setting):

| mode           | state of the month containing the target day                                   |
| -------------- | ------------------------------------------------------------------------------ |
| `FORCE_OPEN`   | `OPEN`                                                                         |
| `FORCE_LOCKED` | `LOCKED`                                                                       |
| `AUTO`         | `NOT_YET_OPEN` while today < first of the month - `openDaysBefore`, else `OPEN` |

Under `AUTO` a month never closes: once it begins, anybody may book what is left. `LOCKED`
exists only as the admin's `FORCE_LOCKED`. Error mapping: `NOT_YET_OPEN` is `OUT_OF_HORIZON`,
`LOCKED` is `RESERVATIONS_LOCKED`.

`ReservationPolicy` decides which rules apply to whom:

| action                            | window applies?                                       |
| --------------------------------- | ----------------------------------------------------- |
| create a reservation              | yes, for a normal user                                |
| join the waitlist                 | yes, for a normal user                                |
| leave the waitlist                | never (leaving gives a position back, like cancelling) |
| cancel your own reservation       | never: a closed window stops taking spots, not giving them back |
| anything, as an admin             | never                                                 |
| auto-promotion                    | never: a system action, so a locked month still works |

Two rules apply to everyone, admin included, because they are facts about the day: a past
day (`PAST_DATE`), and a weekend or Czech public holiday (`VALIDATION_FAILED` with
`details.reason = NOT_A_BUSINESS_DAY`; there is no dedicated error code). `assertMayTakeDay`
checks in that order, so a Saturday in a locked month is reported as the Saturday.

Naming somebody other than yourself is admin only and enforced in the service (a schema cannot
see the caller): `reservation.create` takes an optional `holder` (a user, or a guest with a
name and optional plate); `waitlist.join` and bulk take an optional `holderId`. A normal user
naming themselves is allowed. The named user must be active.

`overview.day` reports `canReserve` (this caller, this day: window, admin exemption, past,
business day) and `canReserveMonth` (the window and admin exemption only). The web never
re-derives either. A month-level control (the bulk button) must read `canReserveMonth`;
reading `canReserve` would switch it off on every weekend and holiday.

## The monthly cap

Per user, per calendar month, `ReservationLimitSettings.monthlyReservationCap` (1 to 31,
default 5). It stops one person claiming a month in advance, so it applies only while it is
**in force** (`isMonthlyCapInForce`): mode `AUTO` and today inside `[first of month -
openDaysBefore, day before the month]`. Once the month has begun, under `FORCE_OPEN` or
under `FORCE_LOCKED`, nothing is capped. Guests never count.

The count is computed, not stored, so there is no index to arbitrate. Every insert for a real
user while the cap is in force reads the cap inside the transaction, takes
`pg_advisory_xact_lock` on `(userId, month)`, recounts, and throws
`MONTHLY_RESERVATION_LIMIT_REACHED` when `count + additional > cap`
(`reservations/monthly-reservation-cap.ts`). Callers: `create` (1), bulk confirm (the number
of days it is about to assign), and promotion. The cap is read once per promotion, above the
candidate loop, so one promotion judges everybody against the same number. A promotion skips a
capped candidate (their entry stays) and moves on. `overview` and `myMonth` report the cap in
force (`null` when none applies) with the count so the client computes remaining slots.

## Spots, visibility and offices

- **A spot is never deleted**, only retired (`active = false`). Retiring (also through
  `update({ active: false })`) is a `CONFLICT` while anyone holds, queues for, or has a guest
  block on that spot today or later: they would otherwise be left with a place that no screen
  shows.
- **Hidden spots belong to admins.** To a normal user a hidden spot does not exist
  (`NOT_FOUND`, the retired spot's answer) for `reservation.create`, `waitlist.join` and
  preferred-spot selection; bulk never assigns or queues one for anybody; Slack leaves it out;
  realtime delivers its events to admin sockets only (`doc/integrations.md`). A normal user who
  holds or queues for a hidden spot still sees that tile and their own reservation in the
  ICS feed. Hiding is not retiring: no commitment check, existing bookings survive.
- **Offices.** A user books spots of their own office; a user with `officeId = null` sees every
  office's spots; an admin may book any office's spot for somebody (`common/office-scope.ts`).
  Moving a spot or user to another office touches no existing booking.
- **Preferred spot.** `User.preferredParkingSpotId` (set through `me.updateSettings`; must be
  an active, visible spot). It is a bulk-only preference: single-day booking never applies it.
  A retired or hidden preferred spot just stops matching.

## Reserve and cancel

`reservation.create(date, parkingSpotId, holder?)`: policy checks (holder, then day and
window), cap if in force, spot lookup, then one transaction with the insert and the audit row.
The two one-per-day rules are left to the unique indexes (`SPOT_ALREADY_RESERVED`,
`RESERVATION_LIMIT_REACHED`), because a read-then-write check cannot be safe against a
concurrent writer; the checks that exist (spot lookup, active holder) only give better errors.

`reservation.cancel(reservationId)`: the holder or an admin, never window-checked. It deletes the
row, audits, and promotes the queue inside the same transaction (below).

## The waitlist and auto-promotion

`waitlist.join` is allowed only for an occupied cell (`SPOT_NOT_OCCUPIED` otherwise), not the
holder's own spot (`CANNOT_WAITLIST_OWN_SPOT`), and not for a user who already has a reservation
that day (`RESERVATION_LIMIT_REACHED`, since they could never be promoted). That last check has
no index behind it; it only gives an honest error. A concurrent acquisition is benign because
promotion re-reads eligibility and skips them. Duplicate joins are `ALREADY_IN_WAITLIST` (unique
index). The join reads the reservation `FOR SHARE`, so "occupied" cannot be decided from a row
another transaction is deleting; shared rather than exclusive because many people may join at once.
The position is read back after the insert. Joining audits `WAITLIST_JOINED`
(`WAITLIST_JOINED_BY_ADMIN` with `targetUserId` when an admin names somebody else).

**Promotion** (`WaitlistPromotionService.promote`, inside the cancelling transaction):

1. Read the cell's queue with `SELECT ... FOR UPDATE` in queue order (`$queryRaw`, Prisma cannot
   express a row lock).
2. Keep candidates who hold no reservation that day. If the cap is in force, take the first that
   also passes the cap recount; otherwise the first eligible.
3. Insert their reservation, delete **all** their queue entries for that day (`DELETE ... RETURNING`
   so the emptied cells can be announced), audit `WAITLIST_PROMOTED`.
4. Nobody eligible: the spot stays free and the queue is kept.

**Why the row lock.** Two cancellations of one cell cannot race (the unique index), so the lock
is not for that. It protects against `waitlist.leave`: without it a person who just left could be
promoted into a spot they asked to give up. With it, the leave blocks until the promotion commits
and then answers `NOT_FOUND` (they were promoted first), or wins and the next person is promoted.

**What is enforced where.** One reservation per spot per day, per user per day, one queue entry per
person per cell: unique indexes, the loser is told `SPOT_ALREADY_RESERVED`,
`RESERVATION_LIMIT_REACHED`, `ALREADY_IN_WAITLIST`. The index violation is mapped to a contract
code by `mapUniqueConstraintViolation`, which reads `meta.driverAdapterError.cause.constraint.index`
because `@prisma/adapter-pg` does not populate `meta.target`.

**Retry.** `ReservationsService.cancel` retries the transaction up to `MAX_CANCEL_ATTEMPTS` (3)
for exactly two conditions, both caused by promotion:

- `P2002` on `Reservation (userId, date)`: the candidate got a reservation elsewhere between the
  eligibility read and the insert (no predicate lock outside SERIALIZABLE, so the index arbitrates).
- A deadlock (`40P01`): two cancellations on different spots, same day, with queues headed by the
  same person take each other's queue row and `(userId, date)` key. Spelled `P2034` when the victim is
  Prisma's own insert and `P2010` when it is a raw statement, so the test is `isWriteConflict`, not a
  single code. No lock ordering removes the cycle; the retry converges because the winner's
  reservation is committed by then, so that candidate is skipped and one fewer cell is reached.

When the attempts run out the caller gets `CONFLICT` (a 409 declared on `reservation.cancel`), never
the underlying `RESERVATION_LIMIT_REACHED`. The service never cancels without promoting. Upgrade path
if the deadlock ever matters: `pg_advisory_xact_lock` on the day at the start of every cancellation
(serialises all of a day's promotions; not built). The monthly cap's advisory lock is a different
key shape for a different purpose and does not order the cell locks.

A `create` racing a cancel of the same cell needs nothing extra: the latecomer's insert fails against
the old row or waits for the promotion and then fails; either way `SPOT_ALREADY_RESERVED`.

**After the commit.** Nothing that can block on the network runs inside a transaction. The
transaction callback returns the events and promotion notices; the service publishes them after
`await` resolves, outside the retry loop (one publish per cancellation, not per attempt). The seam is
`DomainEventPublisher` (`reservations/reservation-events.ts`), bound to a composite that fans out to
realtime and Slack (`doc/integrations.md`). Events per outcome:

| outcome                               | events                                              |
| ------------------------------------- | --------------------------------------------------- |
| created                               | `reservation:created`                               |
| cancelled, queue empty or all blocked | `reservation:cancelled`                             |
| cancelled, somebody promoted          | `reservation:reassigned` (no `waitlist:updated` for the freed cell) |
| joined / left a queue                 | `waitlist:updated`                                  |

`reassigned` replaces `cancelled` + `created`, never both: a client seeing both would flash the cell
empty. A promotion also emits one `waitlist:updated` for every other cell whose queue it emptied (the
promoted person's other entries for that day), so no open day view keeps a stale badge.

## Bulk reservation

`reservation.previewBulk` and `reservation.confirmBulk` take 1 to `MAX_BULK_BOOKING_DAYS` (31)
distinct dates inside **one calendar month** (else `VALIDATION_FAILED`) and give each a spot, a
queue place or a reason. Optional `holderId` books for another active user (admin only).

|              | `previewBulk`                                                           | `confirmBulk`                                                |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| writes       | nothing: no reservation, queue entry or audit row                       | reservations, queue entries, audit rows                      |
| transaction  | none                                                                    | one interactive transaction for the batch                    |
| broadcasts   | none                                                                    | `reservation:created` / `waitlist:updated`, after commit     |
| answer       | `days[]`, `freeSpots[]`, `summary`                                      | `days[]` (adds `reservationId` / `waitlistEntryId`), `summary` |
| errors       | `PAST_DATE`, `OUT_OF_HORIZON`, `RESERVATIONS_LOCKED`, `VALIDATION_FAILED` | those, plus `CONFLICT`, `FORBIDDEN`, `MONTHLY_RESERVATION_LIMIT_REACHED` |

The preview is a proposal, not a hold: two people may be shown the same spot and whoever confirms first
gets it. There are no draft reservations. It is idempotent and writes no audit noise. Every field of the
confirmation is built from rows the database returned, never from the plan.

**Whole-request errors vs per-day facts.** A past day, a month not yet open, a locked month (admins are
exempt from the window, not from `PAST_DATE`), an empty or two-month batch fail the whole request; the
window is checked once for the target month. Per day, inside a successful answer: `UNAVAILABLE` with
`NOT_A_BUSINESS_DAY`, `ALREADY_HAS_RESERVATION` or `NO_SPOTS_AVAILABLE`, so one impossible day does not
discard the rest. If the cap is in force and the batch would exceed it, the whole confirm fails with
`MONTHLY_RESERVATION_LIMIT_REACHED`; the cap is judged against the **holder**.

**The allocator** (`bulk-allocator.ts`) is pure: a snapshot in, a plan out, no database, no clock. Per day,
in this order:

1. Not a business day: `UNAVAILABLE / NOT_A_BUSINESS_DAY` (the most durable fact about a day).
2. The holder already has a reservation that day: `UNAVAILABLE / ALREADY_HAS_RESERVATION` (queueing them
   would create an entry that can never be promoted).
3. No allocatable spot (active, not hidden, no guest block that day, in the holder's office):
   `UNAVAILABLE / NO_SPOTS_AVAILABLE`.
4. Among free spots: an admin's choice for that day, else the holder's preferred spot (`isPreferredSpot`),
   else the first free spot (`SPOT_ASSIGNED`).
5. Otherwise the shortest queue (`QUEUED`, with the position the user would take). Its tiebreak is
   the label alone, not group-then-label: picking a queue is not picking where to park.

Spots are re-sorted inside the allocator (group, then label) rather than trusted from the caller. Days are
processed in ascending order, and that order is the row order of the reservation `INSERT`: it is the lock
ordering that keeps two concurrent confirmations from deadlocking, so it has a single authority
(`allocateBulk`). `assertRequestable` sorts only locally to name the earliest offending day.

**An admin's per-day spot choice.** `confirmBulk` accepts `spotChoices: { date, parkingSpotId }[]` (unique
dates, each one of `dates`); a non-admin sending a non-empty list gets `FORBIDDEN` before anything else.
`previewBulk` returns `freeSpots` per bookable day to fill the select. A choice counts only if that spot is
still free and allocatable inside the transaction; otherwise the day is allocated normally, with no new
error. The same choices are reused on every retry.

**The transaction** (`{ maxWait: 5_000, timeout: 15_000 }`): read the world (spots, that month's
reservations, queues, guest blocks), allocate, `INSERT` reservations with `ON CONFLICT DO NOTHING RETURNING`,
delete the holder's own queue entries on days just reserved (and announce those cells), re-read which
still-unsatisfied days the holder now holds a spot on, `INSERT` queue entries `ON CONFLICT DO NOTHING`,
re-read real positions, write audit rows (`RESERVATION_CREATED` / `WAITLIST_JOINED`, or the `_BY_ADMIN`
variants with one flag for the batch), return the events. Properties:

- **Ascending date order** for all writes; request order would deadlock two users selecting the same week
  from opposite ends. The service restores request order for the response.
- **No statement may fail**: `ON CONFLICT DO NOTHING` turns a lost cell into a missing row, because
  PostgreSQL aborts the whole transaction on a failed statement and Prisma has no savepoints.
- **No `FOR UPDATE`/`FOR SHARE`.** The read-write gap stays open and is self-correcting: state can only
  move against the plan, and a day that loses its spot falls onto that spot's waitlist. Locking all spots
  would serialise the building behind one bulk booking.
- **Retry.** The cap's `(userId, month)` advisory lock is month-scoped while cancel's queue locks are
  date-scoped, so `confirmBulk` x `cancel + promote` can deadlock and no ordering fixes it.
  `confirmBulk` retries the whole transaction on `isWriteConflict` and on a guest-block trigger conflict
  (up to `MAX_CANCEL_ATTEMPTS`) and then reports `CONFLICT`; the batch is all-or-nothing so a losing
  attempt wrote nothing.
- **A known narrow residual.** The "does the holder now hold a spot that day" re-read runs once, before the
  queue insert. A promotion committing between the read and the insert can leave the holder with a
  reservation and an unpromotable queue entry for one day. It is benign (no double booking, no data loss).

Deadlock summary: `confirmBulk` x `confirmBulk` cannot (same ascending key order); x `reservation.create`
cannot (one key); x `cancel + promote` can while the cap is in force (retry, then `CONFLICT`); x any writer
taking cells in the opposite order can, and is absorbed by the retry. Outside the `AUTO` window neither side
takes the cap lock.

## The web side

Lot screen (`/`): a day grid of spots, a date picker, per-cell holds, a dialog per spot (reserve, queue,
cancel, admin: holder or guest, guest time blocks). Realtime patches the cached `overview.day` through pure
functions in `lot-screen/day-overview-cache.ts`, then refetches viewer-relative fields (`canReserve`,
`viewerReservationId`) that no broadcast can carry. The day is refetched every time the socket reconnects.
Copy is Czech first (`doc/frontend.md`).

**Bulk modal** (`lot/bulk-modal/`; `bulk-view.ts` holds every decision as pure functions, `bulk-modal.tsx`
the connected component). Entry is the header's "Hromadná rezervace" button, shown when
`day.canReserveMonth`; the modal refuses its flow on the same prop so a window closing while it is open is
caught. Neither is authorisation: the API check is.

1. **Choosing days.** A Monday-first month grid for the lot screen's month. A day is blocked (checked in the
   allocator's order: weekend, holiday, past, already reserved by the holder) and `remainingSlots = cap -
   count` bounds the selection while a cap is in force (`cap: null` means unbounded; an unloaded summary
   falls back to the bounded default, never to unbounded). An admin picks the holder; switching holder
   clears the selection (the cap is the holder's). A preferred-spot line has five states including
   `unknown` when the profile or spot list failed to load.
2. **The proposed schedule.** `previewBulk` with the picked days. Rows show the spot and a badge (preferred,
   assigned, queue position, unavailable reason); totals are quoted from the preview's own `summary`, not
   recounted. An admin gets a per-day spot select from `freeSpots`; a non-admin's is disabled and prefilled.
   Only changed days are sent as `spotChoices`.
3. **The result, laid against the proposal.** `confirmBulk` with the days of the proposal on screen. The
   plan is not sent (the server would not trust it). The modal compares result and proposal day by day,
   lists only the days that moved ("Návrh" / "Skutečnost") in a `role="alert"` panel, and does not close
   until dismissed. This step is the point of the flow, because the race above can turn a promised spot into
   a queue place. The window gate guards entry and confirmation, never the display of a finished result.

On success `overview.day` is invalidated for every day in the batch (including `UNAVAILABLE` ones) and
`reservation.myMonth` for each month touched. Failures are rendered from the `bulk` message namespace, one
sentence per contract code, never from the shared `errors` namespace (its `VALIDATION_FAILED` copy says
"weekend or holiday"). A failed confirmation leaves the user on the proposal.

## Audit

`RESERVATION_CREATED`, `RESERVATION_CREATED_BY_ADMIN` (payload names the holder or guest),
`RESERVATION_CANCELLED`, `RESERVATION_CANCELLED_BY_ADMIN`, `WAITLIST_JOINED`, `WAITLIST_JOINED_BY_ADMIN`,
`WAITLIST_PROMOTED` (actor is whoever triggered the cancel; no system user exists),
`TIMED_RESERVATION_CREATED` / `_CANCELLED`, `SPOT_UPDATED`, `RESERVATION_WINDOW_UPDATED`,
`RESERVATION_LIMITS_UPDATED`. Payload shapes per action are fixed in `audit/audit-payloads.ts`. `AuditLog`
rejects `DELETE` by trigger.

## Testing

Pure rules run under `api:test` (`reservation-policy.spec.ts`, `bulk-allocator.spec.ts`, `cancel-retry.spec.ts`,
shared-types `reservation-window.spec.ts`). Anything about locks, isolation or the exact shape of a unique
violation runs against a real PostgreSQL under `api:test-db` (`reservations.db.spec.ts`,
`waitlist.db.spec.ts`, `waitlist-concurrency.db.spec.ts`, `bulk-reservation.db.spec.ts`,
`bulk-concurrency.db.spec.ts`, `monthly-reservation-cap.db.spec.ts`), with no Prisma double: a double cannot
reproduce `FOR UPDATE` or `P2002`. The suites get a throwaway database per run, because the concurrency
cases must commit and `AuditLog` rows cannot be deleted. Removing `FOR UPDATE` from the queue read, or the
retry in `cancel`, fails the corresponding concurrency cases; keep that property when changing either. The
after-commit ordering is proved by a publisher that reads through a second connection. Bulk db specs give each
case its own exclusive days (far-future months) and never assert which spot the allocator picked from the
shared lot. See `doc/testing.md`.
