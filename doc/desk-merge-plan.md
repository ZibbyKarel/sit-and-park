# Merging the desk-booking app into garage

Status: **proposed, not yet approved for implementation.**

## Source of the colleague's app

The desk-booking app we are merging is a colleague's separate project. Its code
was shared in Slack as a zip (618 KB, 155 files, shared 2026-11-12):

<https://teamdotblue.slack.com/files/U0BDT6R7HTP/F0CGZ9G0NKV/chat-yfcj1atkl1rr9o5biwmbctis-files.zip>

Stack of the source app: Convex backend (`convex/`), TanStack Start + React
frontend (`src/`), shadcn/Tailwind UI, Convex Auth, generated with Macaly. None
of it is portable 1:1. We **reimplement the desk features in garage's stack** and
take from the zip only the floor plan asset (`public/floorplan.svg`: 221 desks,
12 zones, 22473x5835), the zone names, the desk geometry parser
(`src/lib/desk-geometry.ts`) and the business rules documented below. Its
parking feature is dropped (garage's is the one we keep).

Treat the zip as untrusted third-party code: read it, do not run it.

## Decisions already made

- Tech stack, auth (Okta), and `@shoptet/ui` come from garage; the colleague's
  UI, Convex, Macaly and password/OTP/Google login are dropped.
- **Every desk feature the colleague's app has is implemented**, whether or not
  it is used today.
- HiBob employee sync (via Keboola) is implemented. Deactivation applies to the
  whole app: no desk or parking reservations, no login (Okta enforces login,
  garage's guard already answers 403 for `active = false`).
- `officeId` is added to desks, parking spots and users.
- Zones become a table.
- Roles stay `USER` / `ADMIN`. A hive owner is **not a role**: it is
  `Hive.ownerId`. Its only power (as in the source app) is approving or
  rejecting requests for desks of its hive. Garage has nothing else an owner
  could do beyond a normal user.
- Desk reservations are shared to the user's calendar (ICS), as parking is.
- The contract must be ready for a future MCP server, but **no MCP server and no
  Slack bot are built now.**

## Rules to carry over (from the source app)

- One desk per user per day; a reservation is unique per (desk, date).
- Series: 1-20 dates, span at most 34 days from the first date, today allowed,
  past dates rejected. `skipConflicts` books free days and reports skipped ones
  with a reason each; a preview shows the same plan.
- A permanent holder cannot book any other desk, even on a day they released.
  Release: 1-60 dates, future only, revocable until someone books that day.
  Changing the holder clears free release days.
- Access to a desk: no hive, member of its hive, a direct grant, or admin.
  Otherwise the user files an approval request (one date) to the hive owner;
  approval re-checks everything, and rejecting is always allowed.
- A user sees and books only desks of their own office; admin does not bypass it.
- A user is in at most one hive; adding to another hive moves them.
- Cancelling: the owner may cancel today's and future bookings, past ones only an
  admin.

Known defects of the source app **not** to copy: admin without a hive sees no
pending requests; requests can be filed for desks the user can already book;
occupancy can exceed 100 %; deactivating a desk or changing its hive/office
leaves future bookings and requests dangling; hard-deleting a user erases
history; duplicated admin setters; date validated by regex only.

## Stages

Each stage must build and pass its tests before the next starts. Work happens in
git worktrees under `worktrees/`. Texts are written in Czech first
(`cs.json`), English after. "Stage" is used because "Fáze 0-7" already names the
finished work.

1. **Decisions and spec.** Decision records (desks in garage, office scoping,
   owner derived from `ownerId`, zones table, HiBob sync, MCP-ready contract
   rules). A `doc/desks.md` spec from the rules above. Answers from the
   colleague (see open questions).
2. **Data model (Prisma).** New: `Office`, `Zone`, `Desk`, `Hive`,
   `HiveMembership`, `DeskGrant`, `DeskReservation`, `DeskRelease`,
   `ApprovalRequest`, `EmployeeSyncRun`, `EmployeeSyncSettings`. Changed:
   `User` (`officeId`, `hibobId`, `manualAccount`, `deactivatedAt`),
   `ParkingSpot` (`officeId`). Uniques in the database: (desk, date), (user,
   date), one membership per user, one permanent desk per user. Migration
   creates a default office and backfills.
3. **Contract (Zod).** Entities and procedures for the desk directory, series
   availability, booking, cancelling, approvals, releases, hives, offices,
   zones, bulk admin edits, statistics and sync admin. Typed error codes (copy in
   i18n, not free strings). MCP-ready: described procedures, flat inputs, no
   implicit session state, stable error codes; guarded by a route-parity test.
   Realtime events for desk taken/released.
4. **Desk API.** One function computes a desk's status for a day and is shared
   by directory, booking and series. Booking in a transaction backed by the
   unique constraints. Approvals, releases, hives, bulk desk admin, statistics.
   Audit log entries. DB tests (`api:test-db`) for concurrent booking. Defects
   above fixed.
5. **Employee sync and deactivation.** Endpoint outside oRPC (like ICS) with a
   bearer key whose SHA-256 is stored, never the key. Whole-list validation,
   rejection when the list shrinks by 10 % or more or is empty, dry-run by
   default, a log of every run including rejected ones. Deactivation sets
   `active = false`, frees future desk **and parking** reservations, removes
   waitlist entries, rejects pending requests, makes the ICS feed 404, and
   warns about owned hives and permanent desks.
6. **Offices for parking.** Office filter on spots, reservations and day
   overview; admin assigns users and spots.
7. **Web.** A domain-free `FloorPlan` in `apps/garage/web/src/ui/` (pan/zoom,
   pinch, zoom only with Ctrl/Cmd, zone highlight). Screens: desks with filters,
   banner and series dialog; extended "My bookings" (calendar/list, releases,
   approvals); admin (statistics, plan editor with multi-select, hives, offices,
   zones, users, sync log). **The source app injects an SVG from an arbitrary
   URL inline, which is an XSS hole: ship the SVG as a static asset or admin
   upload and sanitize it.**
8. **Notifications and calendar.** Outbound Slack DMs (hive owner on a new
   request, requester on the decision) through the existing Slack service. Desk
   reservations added to the existing ICS feed via `calendar-export`.
9. **E2E and docs.** Playwright specs (each file needs its own day in
   `SPEC_DAY_SLOTS`), `doc/README.md`, `README.md`, `graphify update .`.

Order: 2 -> 3 -> 4; 5 and 6 can run in parallel after 4; 7 can start after 3
against `stubApi`; 8 after 4.

## Assumptions still to confirm

1. Desks use the colleague's rules (34-day span) and **not** garage's monthly
   reservation window or waitlist.
2. At most one permanent desk per user (the source does not enforce it).
3. User deletion is replaced by deactivation; history is kept.

## Open questions for the colleague

1. Was "owner only approves" deliberate, or was desk management by owners left
   unfinished?
2. Can a hive have more than one owner? What happens when the owner leaves?
3. Why is a user limited to one hive?
4. Does Keboola call the sync endpoint live today or only in dry-run, and how
   often (the UI text says the 2nd and 16th, the code comments say monthly)?
5. Why was the MCP server removed?
