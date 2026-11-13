# Administration (`/admin`)

The tabbed "Správa" screen: the parking lot for today, users, parking spots, the
reservation window, reservation limits, and (from the desk feature) hives, offices,
employee sync, desks and desk statistics. Visual identity is `@shoptet/ui`; copy
is in the `admin` namespace of `apps/sit-and-park/web/messages/cs.json`
(`doc/frontend.md`).

## Where authorization lives

**On the API, and nowhere else.** Every `admin.*` procedure carries
`@Roles('ADMIN')`, and `RolesGuard` (registered after `JwtAuthGuard`) answers the
contract's `FORBIDDEN` with a 403 whatever any browser believes (`doc/auth.md`).
Two specs hold that up and make different claims:

- `apps/sit-and-park/api/src/orpc/orpc-route-parity.spec.ts` reads the decorator
  off Nest's metadata: every `admin.*` route has `@Roles('ADMIN')`, and no other
  route does.
- `apps/sit-and-park/api/src/orpc/orpc-pipeline.spec.ts` drives **every admin
  procedure** over real HTTP with a real non-admin token and requires a 403 in the
  RPC envelope, with nothing written to the database and nothing in the audit log.
  Metadata being present is not the guard running; this is the one that proves the
  guard runs. Its procedure list is checked against `libs/sit-and-park/contract`,
  so an admin procedure added later fails the suite instead of being skipped.

Everything in the browser is a courtesy:

- The role gate in `AdminScreen` stops a non-admin who typed the URL from staring at
  a screen where nothing loads. It fails closed: while the profile is loading it
  shows `ScreenLoading`, if it failed `ScreenError`, and an unknown or non-admin
  role gets a `FORBIDDEN` empty state.
- The disabled "Aktivní" switch on an admin's own row and the disabled "Admin"
  switch on the last active admin are hints. `UsersService.adminUpdate` refuses
  self-deactivation and removing the last active admin (`CONFLICT`) whatever the
  browser sends.

## Layout

```
apps/sit-and-park/web/src/
  app/(app)/admin/page.tsx        wiring: profile + the connected panels
  shell/admin-screen/admin-screen.tsx   role gate, page chrome, the tab strip
  shell/admin/
    admin-errors.ts               (operation, code) -> sentence
    use-admin-failure.ts          one attempt's failure, cleared with the attempt
    admin-{day,users,spots,window,limits}-panel.tsx   connected panels
    admin-day-screen/  admin-users-screen/  admin-spots-screen/
    admin-window-screen/  admin-limits-screen/        presentational screens
    window-banner/  lock-mode-choice/                 shared pieces
    admin-hives-screen/  admin-offices-screen/  admin-sync-screen/
    admin-desks-screen/  admin-desk-stats-screen/     desk tabs
```

Every tab is a **screen** (presentational: every value a prop, every rule testable
with only an `IntlProvider`) and a **panel** (wiring: queries, mutations, router);
the five parking tabs have separate `-panel.tsx` files, the desk tabs connect inside
their screen folder. Same split as `TopBar`/`AppTopBar`.

`AdminScreen` takes the panels as a `panels` prop instead of importing them, so it
renders without a query client. React elements are inert until rendered and `Tabs`
mounts only the selected tab, so an unselected tab fetches nothing. The first tab
is selected by default.

Testing: each screen has its own spec. `admin-panels.spec.tsx` runs the real
screens and real `useQuery`/`useMutation` against a fake `api` object and sees what
only that layer can: which procedure a control calls, what input it sends, which
`AdminWrite` a failure is attributed to, what is invalidated afterwards, and that
`viewerId` really comes from `me.get` (a screen takes it as a prop, so nothing there
would notice a panel that stopped supplying it and silently removed the
self-deactivation hint).

## The tabs

Tab order: `Přehled parkoviště`, `Uživatelé`, `Parkovací místa`, `Rezervační okno`,
`Limity rezervací`, `Hivy`, `Kanceláře`, `Synchronizace`, `Stoly`, `Statistiky
stolů`. The last five are described in `doc/desks.md` and `doc/integrations.md`
(employee sync); they follow the same screen/panel split and failure rules.

### Přehled parkoviště

`overview.day` for today in Europe/Prague (`todayInPrague()`, recomputed every
render so a tab left open overnight does not show yesterday): date, free and taken
counts, the window banner, and a `DataTable` of spots with holder and queue length.
It **summarises** the lot and does not redraw the painted grid; that is the lot
screen. `AdminDayScreen` takes `date` as a prop and links to the lot.

### Uživatelé

`admin.user.list` (unfiltered) and `admin.office.list` feed a `DataTable`:
name, e-mail, an office picker (empty clears it), an `Admin` switch, an `Aktivní`
switch and a manual-account switch (exempt from the employee sync). All write
`admin.user.update`.

- The search box filters the loaded list; it does not refetch.
- Both role and active switches on a row, and its other controls, are frozen while
  any write on that row is in flight: they share one procedure and a second call
  would race the first.
- The viewer's own `Aktivní` switch is disabled. The last active admin's `Admin`
  switch is disabled with an explanatory name.
- **Stepping down is allowed but never by accident.** Switching the viewer's _own_
  `Admin` switch off opens a `ConfirmDialog` ("you lose access to Administration;
  only another admin can give it back") instead of writing. Promoting anyone,
  demoting someone else and the viewer granting themselves the role back are
  immediate: only the irreversible direction asks.
- Setting a user inactive runs `UserDeactivationService` on the API: future desk
  and parking reservations are cancelled, queue entries removed and pending
  requests rejected (`doc/integrations.md`).
- Success invalidates `api.admin.user.key()` and `api.admin.office.key()`.

### Parkovací místa

`admin.spot.list({ includeInactive: true })`, `admin.office.list` and today's
`overview.day` (for the "Stav dnes" column) feed a `DataTable`. Per row: an inline
category `Select`, an office column, today's state, `Aktivní`, `Skryté` and
`Nabíječka` switches, `Upravit` (a `Modal` form: label, group, office, charger) and
`Smazat` (a `ConfirmDialog`). Writes invalidate `api.admin.spot`, `api.spot`,
`api.overview` and `api.admin.office`.

- `Smazat` calls `admin.spot.deactivate`: a soft delete that keeps reservation
  history, refused while somebody holds the spot from today onwards.
- `Skryté` hides a spot from everybody but admins, who can also book it. It is not a
  retirement and refuses nothing; a hidden row carries a `Skryté` badge here and a
  crossed-out eye in the tile's corner on the lot.
- `Nabíječka` marks an EV charger. It is informational only and refuses nothing; a
  charger spot carries a green bolt here and, for every viewer, on the lot.
- The category band counts; it does not edit. Categories are a closed enum.
- A spot missing from the day overview (every inactive spot) shows `—`, not "Volné":
  a claim about a spot nobody can book would be wrong.
- Who is currently editing a spot is presence on the realtime channel and no admin
  tab subscribes to one, so it is not shown here.
- The actions column keeps the accessible name `Akce` but is visually hidden, since
  a nameless column is still nameless to a screen reader.
- The new-spot form defaults the office to the first active office (an inactive one
  cannot take a booking).

### Rezervační okno

`admin.window.months` for the current month plus three (four rows). One response
feeds both cards: the contract returns `settings` alongside `months` so the form and
the list cannot disagree about the same moment.

- Left: the stepper (open days before month start, 1 to 31, declined into Czech
  through ICU) and the lock-mode segmented control (`AUTO`, `FORCE_OPEN`, `FORCE_LOCKED`). There is **no Save button**: both save on change, so no
  unsaved value on screen can disagree with the server.
- Right: one row per month with its window range and an `Otevřeno` / `Uzamčeno` /
  `Zatím neotevřeno` badge.
- Saving invalidates `api.admin.window` and `api.overview` (the day overview embeds
  its month's window state and the lot banner is drawn from it).

### Limity rezervací

`admin.reservationLimits.get` / `.update`: one stepper (1 to 31), no Save button, for
the same reason. It is a second settings surface rather than a variant of the window
tab, because the cap is not a window setting.

- Saving invalidates its own key and also `api.reservation.key()` and
  `api.admin.reservation.key()`: every month summary (`reservation.myMonth`,
  `admin.reservation.month`) carries the cap in force, and the bulk modal's
  greyed-out days derive from it.
- Lowering the cap does not touch existing reservations; it binds new inserts only.
- The cap applies only inside the `AUTO` reservation window. Once a month is running,
  or under `FORCE_OPEN`, nobody is capped and month summaries report `cap: null`.

## Never printing a date that is not true

`MonthWindowOverview.windowFrom` / `windowTo` are **always** the range the `AUTO`
rule would produce (`libs/sit-and-park/contract/src/schemas/reservation-window.ts`).
When `lockMode !== 'AUTO'` an admin has overridden the state and those dates
describe a hypothetical. Both places that render them read `lockMode` first:

- `WindowBanner` has six sentences: three `AUTO` ones that name a date and three
  forced ones that credit the admin and name none.
- The month list says `otevřeno 25. srpna – 31. srpna` under `AUTO` and
  `automaticky by bylo otevřeno 25. srpna – 31. srpna` under a forced mode.

`window-banner.spec.tsx` and `admin-window-screen.spec.tsx` each pin the forced
case, including that the date does **not** appear.

## Failure copy

Admin writes do not use the shared `errors` namespace. `admin-errors.ts` maps
**(operation, code)** to a sentence, because the same code means different things on
different procedures, and `errors.VALIDATION_FAILED` talks about weekends and
holidays, which is nonsense next to a role switch. The operation is the
`AdminWrite` union (`spotCreate`, `spotRetire`, `userUpdate`, `windowUpdate`, ...).

- A failure renders inside whichever dialog is open, and above the table when none
  is: a message printed behind a modal is a message nobody reads.
- **A failure belongs to one attempt and dies with it.** `useAdminFailure().run()`
  clears the previous failure when a write starts; changing the open dialog discards
  it (`onDiscardFailure`, which calls the panel's `clear`/`reset`); and
  `WRITE_ORIGINS` (in `spots-view.ts`) refuses to render a sentence on a surface that
  could not have produced it (a `spotRetire` failure has no route to the "new spot"
  form). Either guard alone would eventually fail: a forgotten discard brings the
  stale sentence back, and a missing origin table lets one through. A write with no
  entry in the table (`userUpdate`, `windowUpdate`) shows nowhere on the spots
  screen; silence is the right failure direction for an unaccounted origin.

**Colour is copy here.** Month badges take their tone from `BADGE_STATE_TONE`
(`admin-window-screen.tsx`) and the window banner from `BANNER_STATE_TONE`
(`window-banner/window-view.ts`), each exported so a spec can pin it: `Otevřeno`
green, `Uzamčeno` yellow, `Zatím neotevřeno` grey. A locked month drawn green reads
as open before a word of it is read. The two maps agree today and are deliberately
separate, pinned separately, so a redesign of one surface cannot silently repaint
the other.

## Czech copy

All admin copy is in the `admin` namespace (the desk tabs have their own `adminDesks`,
`adminDeskStats`, `adminHives`, `adminOffices`, `adminSync` namespaces), written in
Czech first, with English alongside in `en.json` under the parity guard
(`doc/frontend.md`, i18n).

- Plurals are ICU, not a hand-written table: Czech has `one` (1), `few` (2 to 4) and
  `other` (5+), and "1 den" / "3 dny" / "7 dní" differ in all three.
- `dayMonthAndYear` in `libs/shared/i18n` produces the month card's "dnes je
  28. srpna 2026" (day, genitive month, year, no weekday). It is a separate `Intl`
  call, not `fullDate` with the weekday cut off. Both are methods of
  `useDateFormatters()`.
- The admin-window copy reads "upravovat je pak může jen admin" (the grammatical
  form), not the older design text "upravuje je pak může jen admin".

## Admin on the other screens

- On the lot, an admin sees a `⋯` on every tile. It opens the same dialog as clicking
  the tile; the dialog shows admin controls (reserve for another user or a guest,
  guest half-hour blocks, cancel someone else's reservation) from the viewer's role.
  In the parking and desk bulk modals an admin may change the proposed spot or desk
  per day. See `doc/parking.md` and `doc/desks.md`.
- Admins book hidden spots, are exempt from the reservation window (`canReserve`,
  `canReserveMonth` carry the exemption) but not from the monthly cap, which is judged
  against the holder whoever books, and see the `Admin` badge
  and the `Správa` navigation item in the top bar, which appear only once `me.get`
  has loaded the role.
