# Desks

The desk-booking half of the app: offices, zones, desks drawn on a floor plan, hives,
permanent desks, series booking and approval requests. Desks deliberately follow their
own rules and do not use parking's reservation window, monthly cap or waitlist; do not
"align" them with parking (`doc/parking.md`).

Code: `apps/sit-and-park/api/src/desks/` (the caller's side), `desk-admin/` (admin side),
`employee-sync/` (see `doc/integrations.md`); shapes in
`libs/sit-and-park/contract/src/api/{desks,desk-requests,admin-desks,hives,offices}.ts`.
Schema and migrations: `doc/backend.md`. Procedures and errors: `doc/contract.md`.

## Model

| Table                  | Notes                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Office`               | `name` unique, `active`, `floorPlan` (a key of `FLOOR_PLANS`, only `praha`) with `floorPlanWidth`/`Height`.                                                                   |
| `Zone`                 | Per office; unique `(officeId, key)`.                                                                                                                                         |
| `Desk`                 | `code` (`D-001`..., unique per office), `active`, `hiveId`, `permanentAssigneeId` (**unique**), geometry `x y width height` in plan units. `hiveId` is `SET NULL` on hive delete. |
| `Hive`                 | `name` unique, `color` (`#RRGGBB`, CHECK), `ownerId`. Global, not office-scoped. The owner is a column, not a role (an owner need not be an admin).                           |
| `HiveMembership`       | `userId` **unique**: a user is in at most one hive; adding to another moves them.                                                                                             |
| `DeskGrant`            | Direct access to one desk; unique `(deskId, userId)`.                                                                                                                         |
| `DeskReservation`      | Unique `(deskId, date)` and `(userId, date)`.                                                                                                                                 |
| `DeskRelease`          | A permanent holder frees the desk for a day; unique `(deskId, date)`.                                                                                                         |
| `DeskApprovalRequest`  | `PENDING` / `APPROVED` / `REJECTED`; a partial unique on `(deskId, userId, date)` where `PENDING` (hand-written SQL). An author's withdrawal **deletes** the row.            |
| `User` / `ParkingSpot` | Carry `officeId` (spot: required); `User` also `hibobId`, `manualAccount`, `deactivatedAt`, `preferredDeskId`.                                                                |

Dates are date-only (`DATE` column, `YYYY-MM-DD` in Europe/Prague).
`schema-contract-parity.spec.ts` keeps the Prisma models and contract entities field for
field. Ids created by migrations use `gen_random_uuid()` (v4); rows created by the app get
`uuid(7)`. Users are deactivated, never deleted.

## Rules

All of them live in `desks/desk-rules.ts` (pure, no database) and are fed facts loaded
inside the writing transaction by `desks/desk-db.ts`.

**Access** (`deskAccess`): `NONE` when the caller has no office (`NO_OFFICE_ASSIGNED`) or the
desk is in another office (never accessible, admin included). Otherwise `DIRECT` if the desk
has no hive, or the caller is an admin, a member of its hive, or holds a grant; else
`APPROVAL`.

**Status of a desk on a day**, first match wins: `INACTIVE`, `ASSIGNED` (has a permanent
holder who did not release that day), `RESERVED_BY_ME` / `RESERVED`, `FREE`.

**Series** (`desk.previewSeries`, `desk.reserve`): 1 to `MAX_DESK_SERIES_DATES` (20) distinct
dates, the last at most `MAX_DESK_SERIES_SPAN_DAYS` (34) after the first (contract
refinements). Booking **always** skips conflicts: free days are booked, the others come back
in `skipped` with a reason, checked in this order: `PAST_DATE` (today is allowed),
`DESK_ASSIGNED`, `ALREADY_RESERVED_THIS_DESK`, `ALREADY_RESERVED_OTHER_DESK`, `DESK_TAKEN`.
Preview returns the same plan without writing. Whole-call failures, in order:
`NO_OFFICE_ASSIGNED`, `PERMANENT_DESK_HOLDER`, `NOT_FOUND`, `DESK_NOT_AVAILABLE` (inactive),
`DESK_ACCESS_DENIED`; and `NO_FREE_DAY` when nothing is bookable (nothing is written).

**Bulk booking** (`desk.previewBulk`, `desk.confirmBulk`; rules in `desks/desk-bulk-rules.ts`,
service `desk-bulk.service.ts`). Days as parking's bulk modal: distinct, one calendar month,
at most `MAX_BULK_BOOKING_DAYS` (31). People: the caller by default; anybody else is admin
only (`FORBIDDEN`, `ReservationPolicy.assertMayNameDeskHolders`), at most
`MAX_DESK_BULK_USERS` (50).

- Preview allocates per person (people with a `preferredDeskId` first, stable) and date
  ascending: the preferred desk if bookable and in the optional `deskIds` pool (`isPreferred`),
  else the nearest bookable pool desk (Euclidean distance of centres) in the anchor's zone,
  else `UNASSIGNED`. Anchor = the preferred desk when it is active, in the person's office, in
  the pool and `DIRECT`ly accessible; else the bookable pool desk free on most of the days
  (ties: code). Auto-allocation uses `DIRECT` access only and never gives a desk twice a day.
- Per-row `UNAVAILABLE` reasons (`DESK_BULK_SKIP_REASONS`): `PAST_DATE`, `USER_INACTIVE`,
  `NO_OFFICE_ASSIGNED`, `PERMANENT_DESK_HOLDER`, `ALREADY_RESERVED_OTHER_DESK`. Preview also
  returns the free desks per office and day for a manual pick (an admin: every free active
  desk; anybody else: directly bookable ones).
- Confirm takes the explicit `{ userId, date, deskId }` rows, locks the desks (`lockDesks`) then
  the users `FOR SHARE`, re-checks every row and books the valid ones; the rest come back in
  `skipped` (adds `DESK_NOT_AVAILABLE`, `DESK_ACCESS_DENIED`, `DESK_ASSIGNED`,
  `ALREADY_RESERVED_THIS_DESK`, `DESK_TAKEN`). An admin may book a hive desk the person has only
  `APPROVAL` access to. A later row for a person or desk already booked that day by an earlier
  row is skipped. A lost race on a `DeskReservation` unique index is `CONFLICT` for the whole
  call (nothing written).
- Side effects as `desk.reserve`: pending requests rejected (`DESK_TAKEN` for others,
  `REQUESTER_HAS_DESK` for the person's own), `DESK_RESERVATION_CREATED` audited with the caller
  as actor, `desk:reserved` after commit.
- `User.preferredDeskId` (nullable, `SET NULL`) is set through `me.updateSettings` to an active
  desk of the user's office. It is cleared when an admin changes the user's office
  (`admin.user.update`) and when the desk is deactivated or moved to another office
  (`admin.desk.update` / `bulkUpdate`, via `DeskCleanupService.clearPreferredDesk`, same
  transaction).

**Permanent desks.** At most one per user (unique). A holder cannot book any other desk, even
on a day they released. `desk.release` takes 1 to `MAX_DESK_RELEASE_DATES` (60) distinct
dates, today or later (already released days are skipped). `desk.cancelRelease` withdraws one
unless somebody booked that day (`DESK_RELEASE_ALREADY_RESERVED`).

**Approval requests.** For one date, on a hive desk of the caller's office that the caller
cannot book directly (anything else is `VALIDATION_FAILED`; past date `PAST_DATE`; a permanent
holder `PERMANENT_DESK_HOLDER`). The owner of the desk's _current_ hive, or any admin, decides
(`desk.decideRequest`); an admin sees every pending request (`desk.pendingRequests`,
deliberately not under `admin`, because an owner need not be an admin). A rejection always goes
through. An approval re-checks date, desk (active, in a hive, not assigned), requester (active,
same office, no permanent desk, no desk that day), books, and rejects the other pending
requests for that desk and day (`DESK_TAKEN`). The requester gets a Slack DM on a decision,
the owner on a new request; no realtime event carries requests (`doc/integrations.md`).

**Auto-rejection reasons** (`DeskApprovalDecidedReason` in `audit/audit-payloads.ts`):
`DECIDED` (a human), `DESK_TAKEN`, `REQUESTER_HAS_DESK`, `DESK_DEACTIVATED`,
`DESK_HIVE_CHANGED`, `DESK_OFFICE_CHANGED`, `HIVE_DELETED`, `USER_DEACTIVATED`.

**Cancelling** (`desk.cancel`): the holder cancels today's and future reservations; past ones
only an admin (`PAST_DATE` otherwise); anybody else `FORBIDDEN`; an admin may cancel anyone's.

**History floor.** `desk.myReservations` and `desk.myRequests` reach back `DESK_HISTORY_MONTHS`
(12) from today, and forward without limit.

**Office scoping.** The desk directory returns the caller's office only. New users and spots
get the oldest active office unless one is named. Changing a user's or a spot's office touches
no existing booking. Parking's office rule is in `doc/parking.md`.

**Statistics** (`computeDeskStats`): occupancy = reserved bookable desks / bookable desks for
that day, so it never exceeds 100 %; an optional office narrows it.

## What admin changes cascade into

All through `desks/desk-cleanup.service.ts`, inside the changing transaction; `desk:released`
events go out after commit. Cancelling only ever touches reservations dated today or later;
history is never changed.

| Change                                                                    | Reservations                                                                                                                                                                                                                                                | Pending requests                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Desk deactivated (`admin.desk.update`, `bulkUpdate`)                      | Cancelled, `DESK_DEACTIVATED`                                                                                                                                                                                                                               | Rejected, `DESK_DEACTIVATED`                                                              |
| Desk moved to another office                                              | Cancelled, `DESK_OFFICE_CHANGED`. The permanent holder is cleared if not in the new office, and release days nobody booked are dropped. Grants stay.                                                                                                        | Rejected, `DESK_OFFICE_CHANGED`                                                           |
| Desk's hive changed or cleared                                            | Kept (made with access)                                                                                                                                                                                                                                     | Rejected, `DESK_HIVE_CHANGED`                                                             |
| Hive deleted (`admin.hive.delete`)                                        | Kept; its desks become open (`hiveId` null), memberships cascade                                                                                                                                                                                            | Rejected, `HIVE_DELETED`                                                                  |
| Permanent holder set (`admin.desk.setPermanentAssignee`)                  | Others' reservations of that desk cancelled on every day not released, and the new holder's reservations of other desks cancelled, `PERMANENT_ASSIGNMENT`. Any holder change (also clearing) drops release days nobody booked; booked ones keep both rows. | Untouched (a holder's own requests are blocked at approval)                               |
| User deactivated (sync or `admin.user.update`, `UserDeactivationService`) | Desk reservations cancelled, `USER_DEACTIVATED`; parking reservations cancelled after commit through the normal cancel path, so the waitlist promotes                                                                                                       | Rejected, `USER_DEACTIVATED`                                                              |
| Direct booking (`desk.reserve`, `desk.confirmBulk`)                       | -                                                                                                                                                                                                                                                           | Others' for that desk and day `DESK_TAKEN`; the caller's own for those days `REQUESTER_HAS_DESK` |

A permanent holder must be an active user of the desk's office and hold no other permanent desk
(`VALIDATION_FAILED`, `CONFLICT`). A hive owner must be an active user. Deactivating a user keeps
the hives they own and their permanent desk; the sync only warns. Deactivating an office
cascades to nothing. Bulk edit is `admin.desk.bulkUpdate`: up to `MAX_DESK_BULK_IDS` (500) desks,
one transaction.

Audit of a cancelled desk reservation: `DESK_RESERVATION_CANCELLED` when the actor is the holder
(the holder's own cancel, and the employee sync, which acts as the deactivated user),
`DESK_RESERVATION_CANCELLED_BY_ADMIN` otherwise; the payload's `reason` names the cause (`USER`,
`ADMIN` or one of the cascade reasons above).

## Concurrency

Correctness rests on the database; the reads before a write only produce better errors.

- `DeskReservation (deskId, date)` guarantees one holder per desk and day; `(userId, date)` one
  desk per user and day. A lost race surfaces as the unique violation and is mapped by
  `rethrowUnique` to `DESK_ALREADY_RESERVED` / `DESK_RESERVATION_LIMIT_REACHED`.
- `Desk.permanentAssigneeId` unique: one permanent desk per user. The pending unique stops a
  duplicate request; a withdrawal's `deleteMany` carries the `PENDING` guard so a concurrent
  decision is not erased.
- `lockDesk` (`SELECT ... FOR UPDATE` on the desk row) serialises everything that books,
  approves, releases or edits one desk (a reservation's foreign key takes `FOR KEY SHARE` on the
  desk, which conflicts, so even a writer that skips the lock waits). Multi-desk writers
  (`bulkUpdate`, hive delete, bulk confirm) use `lockDesks`, ascending id.
- `lockUser` locks the user row **after** the desk: `FOR SHARE` when booking or approving
  (bookings of one user on different desks do not wait on each other), `FOR UPDATE` when making
  the user a permanent holder. That orders "becomes a holder" against "books a desk" even though
  the two lock different desks. **Lock order is always desk, then user.**
- Transactions use `RESERVATION_TRANSACTION_OPTIONS` (bulk edits `BULK_TRANSACTION_OPTIONS`).
  Events are published after commit; a failed broadcast never fails the call.

Tested in `desks/desks.db.spec.ts` (races) and `desk-admin/desk-admin.db.spec.ts`; see
`doc/testing.md`.

## Realtime

`desk:reserved` (date, deskId, reservationId, userId, userName) and `desk:released` (date,
deskId, reservationId) go to the same per-day rooms as parking, with no hidden concept (the
directory shows every desk). `desk:released` means a _reservation_ is gone (cancel, cascade); a
`DeskRelease` by a permanent holder broadcasts nothing, and the client refetches the directory
(`web/src/desks/desks-screen/use-desk-realtime.ts`). Requests have no event. **Broadcasts are not
office-scoped**: a day room carries every office's desk and parking events (a known gap).

## Audit actions

`DESK_RESERVATION_CREATED`, `DESK_RESERVATION_CANCELLED`, `DESK_RESERVATION_CANCELLED_BY_ADMIN`,
`DESK_RELEASED`, `DESK_RELEASE_CANCELLED`, `DESK_APPROVAL_REQUESTED`, `DESK_APPROVAL_DECIDED`,
`DESK_UPDATED`, `HIVE_UPDATED`, `OFFICE_UPDATED`, `ZONE_UPDATED`, `EMPLOYEE_SYNC_APPLIED`,
`EMPLOYEE_SYNC_SETTINGS_UPDATED`, `USER_DEACTIVATED`. Catalogue edits carry `before`/`after`
(null = created / deleted). There is **no** action for desk grants or hive memberships; those
two writes are unaudited.

## Floor plan

The SVG is a static asset, `apps/sit-and-park/web/public/floorplans/praha.svg`, shown as an SVG
`<image>`; it is **never** fetched, parsed or injected as markup (a stored-XSS hole in the app
this feature came from). Desks are React `<rect>`s drawn from the geometry on `Desk`
(`web/src/ui/floor-plan/`).

The geometry reaches the database through a migration: `20261112120200_praha_office` creates the
office `Praha`, its 12 zones and 221 desks, backfills `User.officeId` and `ParkingSpot.officeId`,
and makes the spot column required. The file is **generated** by
`libs/sit-and-park/database/src/lib/floor-plan.ts` (a small SVG walker: transform stack, desk =
`g#Desk_N > rect#desk_body_N`, zone = nearest `g#zone-<key>`, stored box = axis-aligned box after
every transform). `floor-plan.spec.ts` fails until the committed SQL matches the SVG.

Regenerate (only for an unapplied migration; an applied one is checksummed):

```bash
node --require @swc-node/register libs/sit-and-park/database/src/scripts/generate-floor-plan-sql.ts
```

A changed plan for a live database needs a new migration instead.

**A second office** needs: a new SVG under `public/floorplans/`, its key added to `FLOOR_PLANS`
(`libs/sit-and-park/shared-types/src/lib/domain-constants.ts`), and a migration that inserts the
office, zones and desks (extend `floor-plan.ts` to emit it, as for Praha). There is no admin
upload. Offices and zones without a plan can be created in the admin UI, but their desks cannot
be drawn.

## Web

| Route           | Screen                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/desks`        | `desks/desks-screen/`: the day (in the URL), floor plan or list, zone, hive, only-free and only-directly-bookable filters, a dialog to book (series with live preview), request approval, withdraw or cancel.                                                           |
| `/reservations` | `reservations/my-reservations/`: month calendar of parking, desks and requests (`/desks/my` redirects here) and, in tab Seznam, upcoming and past reservations, releases (permanent holders), my requests, and the owner's / admin's inbox of pending requests.         |
| `/admin` tabs   | `Hivy` (hives, owner, members), `Kanceláře` (offices, zones dialog), `Synchronizace` (live-mode switch, last runs), `Stoly` (list, edit, multi-select bulk edit, grants, permanent holder), `Statistiky stolů` (a day, optional office). Users get office and manual-account fields, spots an office. |

Top navigation (`Parkování`, `Stoly`, `Moje rezervace`) is in `shell/top-bar/top-bar.tsx`. Pure
rules of the screens are in `desks/desk-view.ts`,
`reservations/my-reservations/my-reservations-view.ts` and
`desks/desk-bulk-modal/desk-bulk-view.ts`.

## Out of scope

Employee sync, deactivation and its key are in `doc/integrations.md`. The contract is kept
MCP-friendly (flat inputs, a description per procedure), but there is no MCP server or Slack
bot. Desk events appear in the ICS feed beside parking, and Slack sends approval DMs
(`doc/integrations.md`).
