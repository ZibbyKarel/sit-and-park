# Merging the desk-booking app into sit-and-park

Status: **in implementation** on branch `desk-merge` (worktree `worktrees/desk-merge`).
Live progress is in [`desk-merge-handoff.md`](desk-merge-handoff.md).

This is the second revision. The first was written before anybody had read the
source zip or mapped sit-and-park's guard tests; §"What the first revision got wrong"
lists what changed and why.

## Source of the colleague's app

A colleague's separate project, shared in Slack as a zip (618 KB, 155 files,
2026-11-12):
<https://teamdotblue.slack.com/files/U0BDT6R7HTP/F0CGZ9G0NKV/chat-yfcj1atkl1rr9o5biwmbctis-files.zip>

Stack: Convex backend, TanStack Start + React, shadcn/Tailwind, Convex Auth,
generated with Macaly. None of it is portable. We **reimplement the desk
features in sit-and-park's stack** and take only the floor plan
(`public/floorplan.svg`: 221 desks numbered 1–221, 12 zones, viewBox
`0 0 22473 5835`, verified free of scripts, handlers, `foreignObject` and
external references) and the business rules. Its parking feature is dropped.

The zip is untrusted third-party code: it was read, never run.

## Decisions

- Stack, auth (Okta) and `@shoptet/ui` come from sit-and-park.
- Every desk feature of the source app is implemented.
- Roles stay `USER` / `ADMIN`. A hive owner is `Hive.ownerId`, not a role; its
  only power is deciding approval requests for desks of its hive.
- Hives are global (not office-scoped), as in the source.
- Desks follow the source's rules (series span 34 days, no monthly window, no
  waitlist) — not parking's reservation window.
- Users are never deleted, only deactivated; history is kept.
- At most one permanent desk per user (database unique).
- No MCP server and no Slack bot now; the contract is kept MCP-friendly.

## Rules carried over

- One desk per user per day; one reservation per (desk, date).
- Series: 1–20 distinct dates, last date at most 34 days after the first, today
  allowed. Booking always uses skip semantics: free days are booked, the others
  are reported with a reason code; a preview returns the same plan. Shape errors
  (count, duplicates, span) and desk-level blockers (inactive, no access, caller
  holds a permanent desk) fail the whole call.
- A permanent holder cannot book any other desk, even on a released day.
  Release: 1–60 dates, today or later, revocable until someone books that day.
  Changing or clearing the holder deletes release days nobody booked.
- Direct access to a desk: desk in the user's office AND (no hive, OR admin, OR
  member of its hive, OR a direct grant). A desk of another office is never
  accessible, admin included.
- Without direct access, a desk in a hive can be requested for one date. The
  hive owner or any admin decides. Approval re-checks every booking rule;
  rejection is always possible.
- A user is in at most one hive; adding to another moves them.
- Cancelling: the holder may cancel today's and future reservations; past ones
  only an admin.
- Desk status for a day, first match wins: `INACTIVE`, `ASSIGNED` (permanent
  holder, not released), `RESERVED_BY_ME` / `RESERVED`, `FREE`.

Defects of the source that are fixed, not copied:

| Source behaviour | Here |
| --- | --- |
| Uniqueness only in code | Database uniques on (desk, date), (user, date), one membership per user, one permanent desk per user |
| An admin who owns no hive sees no pending requests | An admin sees every pending request |
| A request can be filed for a directly bookable desk | Rejected with `VALIDATION_FAILED` |
| Occupancy can exceed 100 %, `totalBookings` counts all history | Occupancy = reserved bookable desks / bookable desks for that day; stats take an optional office |
| Deactivating a desk, or changing its hive or office, leaves future reservations and pending requests dangling | The same transaction cancels future reservations (deactivate, office change) and rejects pending requests (all three) |
| Assigning a permanent holder ignores existing reservations | The same transaction cancels other people's future reservations of that desk and the new holder's future reservations elsewhere |
| Deleting a hive leaves undecidable requests | Pending requests of its desks are rejected |
| Approval does not re-check the requester | Re-checks active, office and permanent-desk state |
| Bulk edit is a client loop of single mutations | One `admin.desk.bulkUpdate` procedure, one transaction |
| Dates validated by regex | The contract's date-only type |
| Free-text Czech reasons | Typed error codes and reason enums; copy lives in i18n |
| Floor plan SVG fetched from an admin-set URL and injected with `innerHTML` (stored XSS) | See "Floor plan" |
| Public `seed` / demo-admin mutations | Not ported |
| Hard user delete | Not ported |

## Data model

Names are binding: the Prisma models and the contract entity schemas must match
field for field (`schema-contract-parity.spec.ts`). All ids are `uuid(7)`,
dates are `DATE`, timestamps `timestamptz(3)`.

- `Office`: `id`, `name` (unique), `active`, `floorPlan` (nullable enum-like
  string naming a bundled plan; only `praha` exists), `floorPlanWidth`,
  `floorPlanHeight` (nullable ints), `createdAt`, `updatedAt`.
- `Zone`: `id`, `officeId`, `key`, `name`; unique (`officeId`, `key`).
- `Hive`: `id`, `name` (unique), `color` (`#RRGGBB`), `ownerId` → User,
  `createdAt`, `updatedAt`.
- `HiveMembership`: `id`, `hiveId`, `userId` (**unique**), `createdAt`.
- `Desk`: `id`, `officeId`, `zoneId`, `code` (e.g. `D-001`; unique per office),
  `active`, `hiveId` (nullable), `permanentAssigneeId` (nullable, **unique**),
  geometry in plan units `x`, `y`, `width`, `height` (ints, the axis-aligned
  box after the SVG's rotation is applied), `createdAt`, `updatedAt`.
- `DeskGrant`: `id`, `deskId`, `userId`, `createdAt`; unique (`deskId`, `userId`).
- `DeskReservation`: `id`, `deskId`, `userId`, `date`, `createdAt`; unique
  (`deskId`, `date`), unique (`userId`, `date`), index (`date`).
- `DeskRelease`: `id`, `deskId`, `date`, `releasedById`, `createdAt`; unique
  (`deskId`, `date`).
- `DeskApprovalRequest`: `id`, `deskId`, `userId`, `date`, `status`
  (`PENDING` | `APPROVED` | `REJECTED`), `decidedById` (nullable),
  `decidedAt` (nullable), `createdAt`; a partial unique index on
  (`deskId`, `userId`, `date`) where `status = 'PENDING'` (hand-written SQL).
  A request cancelled by its author is deleted.
- `EmployeeSyncRun`: `id`, `createdAt`, `source`, `mode` (`DRY` | `LIVE`),
  `status` (`OK` | `REJECTED`), `reason` (nullable), `summary` (JSONB).
- `EmployeeSyncSettings`: singleton (`id = 1` CHECK), `liveMode`, `updatedAt`.
- `User` gains `officeId` (nullable FK), `hibobId` (nullable, unique),
  `manualAccount` (bool, default false), `deactivatedAt` (nullable). `active`
  stays the switch the guard reads; `deactivatedAt` records when.
- `ParkingSpot` gains `officeId` (required FK, backfilled).

The migration creates the office `Praha`, its 12 zones and its 221 desks with
geometry (SQL generated by a script from the SVG — zone membership comes from
the SVG's nesting, **not** from the source's `seed.ts`, which is stale), and
backfills `User.officeId` and `ParkingSpot.officeId`. New audit actions are
added with `ALTER TYPE … ADD VALUE` in a migration of their own.

## Floor plan

The SVG ships as a static asset of the web app
(`apps/sit-and-park/web/public/floorplans/praha.svg`) and is displayed as an
`<image>` — it is **never** parsed or injected in the browser. Desks are drawn
by React as `<rect>` elements on top of it from the geometry stored on `Desk`.
That removes the XSS hole instead of sanitising around it, and it removes the
source's `desk-geometry.ts` (which mis-identifies desk 1 and ignores rotation).
A second office needs a new bundled asset and a migration; an admin upload is
out of scope.

## Stages

Each stage builds and passes its tests before the next is called done.
"Stage" is used because "Fáze 0–7" names the finished parking work.

1. **Decisions and spec.** Decision records from 0320 up; `doc/desks.md`.
2. **Data model.** Schema, migrations, generated client (committed), seed
   (hives, memberships, a permanent desk, grants for the e2e personas),
   parity spec, the fixture ripple of the new `User` / `ParkingSpot` columns.
3. **Contract.** Entities, enums, error codes, procedures under `desk.*`,
   `me.*` and `admin.*`, realtime events `desk:reserved` / `desk:released`
   (payload carries `date`), the hand-kept lists in `router.spec.ts`,
   `errors.spec.ts`, `event-maps`. MCP-friendly: every procedure has a
   description, flat inputs, no implicit state beyond the caller's identity.
4. **Desk API.** One function computes access and status for (desk, user,
   day) and is shared by directory, booking, series preview and approval.
   Transactions rest on the uniques plus `SELECT … FOR UPDATE` on the desk;
   events are published after commit. Audit entries. DB suites for concurrent
   booking, the permanent-desk rules and approval.
5. **Employee sync and deactivation.** `POST /api/employee-sync`, outside
   oRPC, `@Public()` + strict throttle + bearer key. Only the key's SHA-256 is
   known to the server, through the env var `EMPLOYEE_SYNC_KEY_SHA256` (unset
   → 503); nothing secret is stored in the database. Whole-list validation,
   rejection of an empty list or one below 90 % of the active synced users,
   dry-run unless `liveMode`, every run logged. Deactivation: `active = false`,
   `deactivatedAt`, future desk **and parking** reservations cancelled, waitlist
   entries removed, pending requests rejected; warnings for owned hives and a
   permanent desk. Non-`@team.blue` or `manualAccount` users are never touched.
6. **Offices for parking.** Users see and book spots of their office; admin
   sets a user's and a spot's office.
7. **Web.** A domain-free `FloorPlan` in `apps/sit-and-park/web/src/ui/` (pan, wheel
   zoom only with Ctrl/Cmd, pinch, keyboard-reachable desks). Navigation
   between Parking and Desks (sit-and-park has no top navigation today). Screens:
   desks for a day (plan + list, filters, booking dialog with series preview,
   approval request), my desk reservations (upcoming, history, releases, my
   requests, owner inbox), admin (desks with multi-select bulk edit, hives,
   offices and zones, statistics, sync log, user office/manual flags).
8. **Notifications and calendar.** Slack DMs through the existing service
   (owner on a new request, requester on the decision). Desk reservations in
   the existing ICS feed.
9. **E2E and docs.** Playwright specs with their own `SPEC_DAY_SLOTS`,
   `reset-e2e.ts` cleaning desk tables, `doc/README.md`, `README.md`,
   `CLAUDE.md` counts, `graphify update .`.

Order: 2 ‖ 3 → 4; then 5, 6, 8 in parallel; 7 starts after 3 against `stubApi`.

## What the first revision got wrong

- It assumed Slack notifications existed in the source. There is no Slack
  code; the source e-mails through the Macaly platform. Stage 8 is new work.
- It assumed sit-and-park has a "My bookings" screen and top navigation to extend.
  It has neither.
- It planned to port `desk-geometry.ts` and sanitise the SVG. The parser is
  buggy and the injection is the vulnerability; geometry is extracted once,
  at migration-generation time.
- It trusted the source seed. The seed has 213 desks in an older numbering;
  the SVG has 221.
- It stored the sync key hash in the database. An env var is one moving part
  fewer and matches how sit-and-park handles every other secret.
- It called bulk admin edits a source feature. The source loops single
  mutations; the transaction is ours.
- `ApprovalRequest` is named `DeskApprovalRequest`, since sit-and-park will have
  other things to approve sooner than it will have a rename budget.

## Open questions for the colleague

1. Was "owner only approves" deliberate, or was owner desk management unfinished?
2. Can a hive have more than one owner? What happens when the owner leaves?
3. Why is a user limited to one hive?
4. Does Keboola call the sync endpoint live today, and how often?
5. Why was the MCP server removed?
