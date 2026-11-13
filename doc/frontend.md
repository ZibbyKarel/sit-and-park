# Frontend

`apps/sit-and-park/web` is the Next.js 16 App Router front end. This document
covers its structure, the wrapper libs, `@shoptet/ui` usage, the data layer, i18n,
dialogs and the shell screens. Parking and desk rules are in `doc/parking.md` and
`doc/desks.md`; the `/admin` section is in `doc/admin.md`.

## Language and copy

Code, identifiers, URLs and docs are English. UI copy is Czech and comes only from the message
catalogs via `@sit-and-park/i18n`, never from a component; the UI keys off error `code`, not `message`.

## Wrapper libs

App and lib code imports the wrapper, never the library:

| Instead of                     | Import                                            | Tags                     |
| ------------------------------ | ------------------------------------------------- | ------------------------ |
| `next-auth`, `next-auth/react` | `@sit-and-park/auth`, `@sit-and-park/auth/client` | `type:util`, `scope:web` |
| `socket.io-client`             | `@sit-and-park/realtime-client`                   | `type:util`, `scope:web` |
| `next-intl`                    | `@sit-and-park/i18n`                              | `type:util`, `scope:web` |
| `react-hook-form`              | `@sit-and-park/form`                              | `type:util`, `scope:web` |
| `@orpc/client`                 | `@sit-and-park/api-client`                        | `type:util`, `scope:web` |
| `ical-generator` (API only)    | `@sit-and-park/calendar-export`                   | `type:util`, `scope:api` |

`@tanstack/react-query` is **not** wrapped: feature code imports `useQuery`,
`useMutation`, `useQueryClient` and `QueryClientProvider` from it directly.

### ESLint enforcement (`eslint.config.mjs`)

- One map, `WRAPPED_LIBRARIES` (package to `owner` directory and `use` path), generates a
  global `no-restricted-imports` ban on `apps/**` and `libs/**`, a `no-restricted-syntax` ban
  on `require('pkg')` and `import('pkg')` (the import rule misses both), and a per-owner
  override that subtracts the owner's package. A new wrapper is one entry. `lint` runs with
  `--max-warnings=0`; subpaths (`next-auth/react`) are covered.
- **The owner is one directory, never a namespace**: collapsing owners to `libs/shared/**`
  would give every shared lib every package's exception while lint stayed green.
- Every override needs `basePath: workspaceRoot` (Nx runs `eslint` with the project as cwd, so
  a workspace-relative glob without it never matches).
- `no-restricted-imports` is one rule: a lib-local config that sets it replaces the root's and
  silently turns the ban off. Such a config must spread `restrictWrappedLibraries()` and
  `restrictWrappedLibrariesDynamically()` back in; otherwise use a bare `[...baseConfig]`.
- `NPM_ALLOWLIST.util` (all `type:util` libs) is `WRAPPED_LIBRARIES` plus React/Next peers,
  `@hookform/resolvers`, `@orpc/tanstack-query`, `zod` and Testing Library; only the
  per-directory override says which wrapper may import which package. A package used by one
  lib's specs (`ical.js`) gets a scoped constraint on those specs, not a tag-wide entry.
  `@orpc/contract` stays allow-listed for `type:contract` alone.
- **Verify with probes, not a green lint**: import the package in its owner (must pass) and
  elsewhere (must fail naming the right wrapper), then delete the probes.

### The libs

**`@sit-and-park/form`**: `useAppForm({ schema, defaultValues })` wires a Zod schema through
`@hookform/resolvers/zod`; `FormProvider`; `FormField`, a **generic render prop** importing no
UI library, handing the caller `field` (`name`, `value`, `onChange`, `onBlur`, `ref`) and the
Zod `error`. A text input can take `{...field}`; a checkbox cannot (it carries `checked`), so
the caller adapts it. A control merges its own `aria-describedby` with the error id.

**`@sit-and-park/api-client`**: `createApiClient`, `toContractError`, `errorStatus`,
`createApiQueryUtils`. `ApiClient` is derived from the contract, so an undeclared endpoint
cannot be called. `getAccessToken` is called **per request**; `null`/`undefined`/`''` omits
the `Authorization` header instead of sending `Bearer undefined`. `toContractError(caught)`
parses the **code** through the contract's `errorCodeSchema` and returns a `ContractError` or
`null` (transport failure, unknown code, plain throw); it avoids oRPC's `isDefinedError`,
which narrows on a `defined` flag the API sets to `false` on every domain error.
`errorStatus` gives the HTTP status, or `undefined` when no response arrived (the retry
policy's whole input). `createApiQueryUtils(api)` mirrors the contract router: leaves carry
`queryKey`, `queryOptions`, `mutationOptions`, `call`; branches carry `key()`.

**`@sit-and-park/auth`** (server: `createAuth`, `OKTA_PROVIDER_ID`) and
**`@sit-and-park/auth/client`** (browser: `AuthProvider`, `useRequireAuth`,
`useAccessTokenProvider`, `useSession`, `signIn`, `signOut`); the split keeps route handlers
out of the browser bundle. `next-auth` is pinned to an exact v5 beta (`latest` is v4).
Details: `doc/auth.md`.

**`@sit-and-park/realtime-client`**: `RealtimeProvider`, `useRealtime`
(`{ status, reconnect, reportInvalidPayload }`), `RealtimeStatus`
(`connecting | connected | disconnected | rejected`), `useRealtimeEvent`, `useDayRoom`,
`useCellLock`. Event names and payloads come from `@sit-and-park/contract/realtime` and are
parsed before a handler sees them. The socket factory and `Socket` type are not exported (a
re-exported type walks past an import ban); the provider is the only way to open a connection.
`AccessTokenProvider` is defined once in api-client. Protocol: `doc/integrations.md`.

## Route tree

`src/app/`: `layout.tsx` (root: `<html lang>`, `@shoptet/ui/index.css`, `<Providers>`),
`providers.tsx` (the one client boundary), `error.tsx` / `global-error.tsx` (global has no
layout above it), `not-found.tsx`, `login/page.tsx` (server component + Server Action),
`api/auth/[...nextauth]/route.ts`, `api/health/route.ts`, and the `(app)` group (top bar +
centred `<main>`, route-level `loading.tsx`) with `/` (parking), `/desks`, `/reservations`,
`/settings` (renders as a modal) and `/admin` (admin only).

Every route path is declared once in `src/routes.ts`; `auth.ts` and `proxy.ts` both read
`LOGIN_ROUTE` from it, so the path Auth.js redirects to and the path the proxy exempts cannot
drift. Under `src/`: `shell/` (top bar, settings, admin, query client, providers,
screen-state), `lot/`, `desks/`, `reservations/my-reservations/`, `ui/`, `i18n/`, `theme/`,
`test-utils/`, `testing/`. A component and its companions (spec, CSS Module, view module) live
in one folder named after it, with no per-folder `index.ts`; imports name the file.

## The client boundary

`app/providers.tsx` is the **only** `'use client'` boundary in the shell; wrapper providers ship
without their own directive. Nesting, outermost first (load-bearing): `AuthProvider` (session
read on the server, no signed-out flash) > `IntlProvider` (locale and catalog per request,
Europe/Prague) > `LocalizationProvider` and `RouterProvider` from `@shoptet/ui` > `QueryClientProvider`
(one client per mount) > `ApiProvider` (oRPC client built from the session token; `useApi()`
returns the `createApiQueryUtils` tree and throws outside it) > `RealtimeBoundary` (socket opened
only once authenticated and with a non-empty origin, since `io('')` would dial the page's own
origin; an invalid payload is reported with `console.warn`, never with a token). Auth is outermost
because the API client and socket take their token from it; intl sits above the data layers so
failure screens have copy.

`layout.tsx` passes `await auth()` down: `null` means "no session, I checked", whereas omitting it
starts Auth.js in `loading` and flashes every visitor as signed-out.

`src/api-url.ts` derives three URLs from `NEXT_PUBLIC_API_URL` (`http://localhost:3000/api`, which
is none of the endpoints): `apiRpcUrl` gives `.../api/rpc`, `apiReadinessUrl` gives
`.../health/ready` (probes are excluded from the global prefix), `apiOriginOf` gives the origin
only (`io()` reads a path as a **namespace**). Each has a silent failure mode, so each is a named,
specced function.

## Data layer (TanStack Query)

- Query keys are **never written by hand**: use `api.<router>.<proc>.queryOptions({ input })` and
  `.mutationOptions()`, and invalidate with a branch key, e.g.
  `queryClient.invalidateQueries({ queryKey: api.overview.key() })`. Realtime hooks and tests
  derive keys the same way.
- The client comes from `createQueryClient()` (`shell/query/query-client.ts`) in `useState`'s
  initialiser. Do not call `new QueryClient()` in feature code; nothing prevents it, so
  convention does. Defaults: `staleTime` 30 s, `gcTime` 5 min, `refetchOnWindowFocus: false`
  (realtime delivers freshness), `retry: shouldRetryQuery`, mutations never retried.
- Retry (`retry.ts`): a 4xx is never retried, anything else up to `MAX_QUERY_RETRIES` (2). It
  splits by HTTP status, not code, because throttled and unmatched-route responses carry no
  code; a rejected reservation is a decision and repeating it only delays the message. Mutations
  are not retried because a second attempt after an ambiguous failure risks a duplicate write.
- Session-dependent queries pass `enabled: status === 'authenticated'` from `useRequireAuth()`.
- Tests drive a real `RPCLink` with only `fetch` stubbed (or `test-utils` `stubApi`/`serveApi`),
  never a hand-built client, which would skip the layer that produces the errors under test.

### `ScreenData<T>`

`shell/screen-state/screen-state.tsx` holds `ScreenLoading` (`role="status"`), `ScreenError`,
`EmptyState` and the type saying which a screen is in:

```ts
export type ScreenData<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "ready"; readonly data: T };
```

A union, not `data | undefined` plus `isPending` plus `isError`: impossible combinations cannot be
written, and a screen never claims "no spots" for "not loaded". `screenDataOf(query)` narrows a
`ScreenQueryLike<T>` (written out so the seam names no transport): pending beats error, and a
result with no data that is neither pending nor failed counts as a **failure**, never as empty.
`ScreenDataGuard` takes a render prop so a modal can keep its frame while the body loads.
`ScreenError` reads the thrown value through `toContractError` and renders a sentence keyed off
the code, never the error's `message`; unknown codes and transport failures get one generic
sentence, and `onRetry` adds a button. `(app)/loading.tsx` and `app/error.tsx` wire these up.

### `*-view.ts`

A screen's decisions live in a sibling module with no React, hooks or network and a
`*-view.spec.ts` (`lot-view.ts`, `bulk-view.ts`, `desk-view.ts`, `settings-view.ts`, `spots-view.ts`,
`window-view.ts`, ...): conditional rendering is costly to test through the DOM. Use **a union, not a
nullable pair** (`IcsFeedView`, `SpotDialog`), and **keys are structure, sentences are copy** (a view
function returns a message key, never a formatted string). Presentational/connected split
everywhere: `TopBar`/`AppTopBar`, `SettingsScreen`/`SettingsPage`, admin screens/panels.

## `@shoptet/ui` and styling

- UI comes from `@shoptet/ui` (exact pin), imported directly, no wrapper lib; `layout.tsx` imports
  `@shoptet/ui/index.css` once. **Server components never import `@shoptet/ui`.**
- Styling a prop cannot express goes in a colocated CSS Module using its custom properties
  (`--spacing-*`, `--background-*`, `--foreground-*`). No Tailwind, no Storybook. Domain colours
  and lot/calendar classes live in `global.css` on `--lot-*` variables.
- Compositions it lacks live in `src/ui/`, one folder per component, domain-free (`chip`,
  `client-select`, `confirm-dialog`, `data-table`, `empty-state`, `floor-plan`, `icon-circle`,
  `icons`, `month-nav`, `text-field`, `toast`, `toggle-tile`, `visually-hidden`). Domain
  composition (`ScreenError`) stays in app code.
- Appearance is a body class: `theme-brand`, plus `theme-dark` when the `sit-and-park-theme`
  cookie is `dark` (with no cookie an inline script uses the OS preference); the cookie lets
  server HTML carry the class, so there is no flash. The top bar toggles it.
- `floor-plan` draws an `<image>` background and the shapes it is given (wheel pans,
  Ctrl/Cmd+wheel and pinch zoom, CSS-only fullscreen, keyboard-reachable shapes). It never parses
  or injects the SVG as markup.

## Dialogs

Every dialog is a `@shoptet/ui` `Modal` and is **dismissible**: Escape, a scrim click
and the × all call `onClose`. `canBeDismissed` is the only mechanism. A dialog is
non-dismissible only while closing would be wrong right now:

- `ConfirmDialog` (`src/ui/confirm-dialog`): `canBeDismissed={!loading}`; cancel,
  Escape, scrim and × all call `onCancel`. Focus does not start on the confirming
  button, so a destructive confirmation is never armed under Enter. Render it
  unconditionally and drive it with `open`; mounting it conditionally removes it in
  the commit its button is pressed.
- Bulk modals (parking and desks) and the schedule preview:
  `canBeDismissed={!confirmBulk.isPending}`, since closing mid-confirm hides the result.
- Settings: `canBeDismissed={!confirmOpen}`, because the nested "regenerate link"
  `ConfirmDialog` owns Escape and the scrim while open, so one Escape closes only it.

No dialog protects unsaved input by refusing to close; do not reintroduce
`canBeDismissed={false}` for that.

## Sign-in

No test path and no bypass: dev, e2e and production run the same code and differ only in
environment values. An unauthenticated request to a protected path hits `src/proxy.ts`
(Auth.js's `auth` re-exported as Next 16's interceptor; it is `proxy.ts`, not `middleware.ts`),
which redirects to `/login?callbackUrl=...` (the matcher exempts `api/auth/`, `api/health`,
`_next/static`, `_next/image` and top-level images). `login/page.tsx` is a **server**
component: with a session it redirects to `/`, otherwise it renders `LoginScreen` with a Server
Action calling `signIn(OKTA_PROVIDER_ID, { redirectTo: LOT_ROUTE })`, so it needs no client JS.
Auth.js goes to Okta (the mock OIDC server in dev) with PKCE `S256` and `offline_access` and
returns to `/api/auth/callback/okta`. Sign-out is `signOut({ redirectTo: LOGIN_ROUTE })`.

The access token lives in the encrypted session cookie. It is never written to
`localStorage`/`sessionStorage`, rendered or logged; the browser sees it only as an
`Authorization: Bearer` header and `socket.handshake.auth.token`, never a query string.
`AUTH_SECRET` and the client secret are server-only (no `NEXT_PUBLIC_`). Dev: the mock OIDC
server issues no `email` claim by default and the API refuses such a token, so supply
`{"email":"...","name":"..."}` in its optional claims field; its token has `aud: "default"`,
which must match `AUTH_OKTA_AUDIENCE`.

## Shell screens

**Top bar.** `top-bar.tsx` is presentational, `app-top-bar.tsx` connected. Navigation: Parking,
Desks, My reservations, and Administration for admins only; right side: an `Admin` badge, the
avatar menu (name, e-mail, settings, sign-out) and the theme toggle. The role comes from
`me.get` (`use-current-user.ts`), not the session; while it loads or fails `role` is
`undefined`, so badge and admin tab are absent. That is a convenience: the API's `RolesGuard`
enforces the role and `/admin` shows a `FORBIDDEN` empty state to a non-admin.

**Settings (`/settings`)** renders as a `Modal`, closes on save, and holds a licence-plate /
preferred-spot / preferred-desk form (`useAppForm`/`FormField`) submitted through
`me.updateSettings`'s three-valued input (absent leaves alone, `null` clears, a value sets;
`toUpdateInput` turns an empty string into `null`, and the desk is sent only when its picker
is shown). Fields sit in a real `<form id="settings-form">`; Save is in `Modal`'s footer,
linked by `form="settings-form"`, so Enter submits natively. The language control and the ICS
section sit outside the form, so Enter in the read-only feed input cannot save.

- The form is seeded from the profile **once** (ref-guarded effect), so a refetch never overwrites
  an edit. A second effect reconciles the seeded preferred spot (and desk) against `spot.list`
  (`desk.directory` for the caller's office): an id no longer active becomes "no preference";
  pending/error states show a hint or inline retry, so a failed list is not read as "no spots",
  and with no office the desk picker is hidden.
- `IcsSection` shows `buildIcsFeedUrl(apiOrigin, icsToken)`, a copy button and a "generate new
  link" button behind a `ConfirmDialog` (the old link stops resolving at once). An empty
  `apiOrigin` renders "unavailable". The ICS token is a bearer credential and is never logged.

**Parking overview (`/`).** Rules are in `doc/parking.md`; frontend specifics:

- `LotHeader` holds the date navigation; weekend and public-holiday highlighting comes from
  `toDayNoteView(date)` in `lot-view.ts`; the uppercase is CSS, not message text.
- One `date` state drives both the `overview.day` query key and `useDayRoom(date)`, so the
  query and the realtime room cannot disagree.
- The bulk modal reads `day.canReserveMonth`, not `day.canReserve` (anchor day versus month).
  Its failures use the `bulk` namespace because the shared `errors` sentences describe a
  single-day reservation. It is the one modal that does not close itself on a successful
  write: its last step compares the confirmation with the proposal and shows any difference.
- `SpotDialog` is presentational; `toSpotView` picks the mode (lock, full-day holder, guest
  blocks, free or window-locked) before render. A user holder is always `FULL_DAY`; only an
  admin's guest holder may pick `TIMED`, decided once in `toReservationRequest`. A bay with
  guest blocks has the `'timed'` appearance, never `'taken'`, with no queue UI. The admin `⋯`
  opens the same dialog as the tile.

**Desks.** `src/desks/` and `reservations/my-reservations/`; `use-desk-realtime.ts` refetches
on `desk:reserved` and `desk:released` for the open day. Geometry comes from the API, never
from parsing the SVG. Rules: `doc/desks.md`.

## Realtime: what a broadcast may change

A day room is shared by everyone viewing the day, so a payload carries nothing viewer-relative.
The day overview has five such fields (`canReserve`, `canReserveMonth`, `viewerReservationId`,
`viewerWaitlistEntryId`, `viewerWaitlistPosition`); no event can patch them.

> Patch the shared fields the payload determines. Additionally invalidate when the event could
> move a viewer-relative field the broadcast may not carry.

| event                           | patched                       | also refetched when                                         |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `reservation:created`           | `spots[i].reservation`        | the caller is the new holder                                |
| `reservation:cancelled`         | `spots[i].reservation = null` | it was the caller's own reservation                         |
| `reservation:reassigned`        | `spots[i].reservation`        | the caller was promoted, lost the spot, or is queued for it |
| `waitlist:updated`              | `spots[i].waitlistCount`      | the caller is in that queue                                 |
| timed-reservation update        | the spot's guest blocks       | never                                                       |
| `cell:locked` / `cell:unlocked` | nothing                       | never                                                       |

The patch repaints on the tick; the refetch corrects viewer fields shortly after, only for
callers whose fields moved. Patches are **pure and identity-preserving** (`day-overview-cache.ts`:
same reference when nothing changed; a client is in several day rooms and Socket.io does not say
which delivered a message, so the day guard matters). The query key is never written down.
**Cell locks are component state** (`use-cell-locks.ts`): no procedure returns current holds, so
there is nothing to patch; a hold lives about 30 s, is swept on its own `expiresAt` and dropped on
disconnect.

## `/api/health` and environment

`/api/health` is a readiness probe for the web/API pair: it calls the API's `/health/ready`
with a 4 s timeout and returns `200` or `503` with `checks.api.reason` one of `unreachable |
timeout | not-ready | not-configured` (a fixed enum, never upstream text), both with
`cache-control: no-store`; it is exempt from the session check. `src/env.ts` holds the Zod
schema (`NODE_ENV`, `NEXT_PUBLIC_API_URL`, `AUTH_SECRET` of 32+ chars, `AUTH_OKTA_ISSUER`,
`AUTH_OKTA_CLIENT_ID`, `AUTH_OKTA_CLIENT_SECRET`); `instrumentation.ts` validates it at boot and
exits with code 1 on failure. Keys may be added, never loosened; durations are milliseconds
with an `_MS` suffix. `src/auth.ts` reads raw `process.env` on purpose: it is imported during
page-data collection, and validating there would make `next build` require production secrets.

## i18n

`libs/shared/i18n` is the runtime and the only importer of `next-intl`; it is `scope:web`, so
`next-intl` has no path into the backend. The copy lives in the app. The lib provides a wholesale
re-export of `libs/sit-and-park/shared-types`' Europe/Prague date logic (`DateOnly`,
`todayInPrague`, `isWeekend`, `czechPublicHolidayOn`, ...) so features never import
`shared-types`; locale helpers (`LOCALES` = `cs`, `en`; `DEFAULT_LOCALE`; `LOCALE_COOKIE` =
`NEXT_LOCALE`; `isLocale`; `negotiateLocale`), free of `next-intl`; date formatters;
`createErrorTranslator`; `IntlProvider`; and `useTranslations`, `useFormatter`, `useLocale`.
`IntlProvider` requires `locale` and `messages` and fixes `timeZone` to `Europe/Prague` (a
reservation day is a Prague day in any language); `AppMessages` is `Record<string, unknown>` so
`next-intl`'s type does not leak into the app.

### Copy

Files: `apps/sit-and-park/web/messages/cs.json` (source of truth for keys), `en.json` (same keys),
`messages.spec.ts` (parity guard), `next-intl.d.ts` (key types from `cs.json`) and
`src/i18n/load-messages.ts` (the only place a catalog is read).

- **Czech first.** Write new copy in `cs.json`, then translate into `en.json`; never English
  first, never replace a Czech string with English.
- Namespaces: `shell`, `login`, `nav`, `sections`, `settings`, `lot`, `admin`, `errors`, `bulk`,
  `myReservations`, `myDesks`, `desks`, `adminDesks`, `adminDeskStats`, `adminHives`,
  `adminOffices`, `adminSync`, `deskBulk`.
- `next-intl.d.ts` augments `AppConfig["Messages"]` with `typeof csMessages`, so a wrong key is a
  compile error. It is asymmetric (a key only in `en.json` is invisible to TypeScript), which is
  the gap the parity guard closes. A `declare module` is not an import, so it does not breach the
  wrapper rule. `load-messages.ts` imports both catalogs statically: the locale set is closed
  and a missing file should fail the build.
- Plurals are ICU (`one`/`few`/`other` in Czech, `one`/`other` in English) with the same
  arguments in both; outside a plural `#` is a literal. Use typographic apostrophes only: a
  straight `'` is an ICU escape.
- Glossary: one Czech term maps to one English term (místo = spot, SPZ = license plate, fronta =
  queue, Správa/Administrace = Administration). `cs.json` names some concepts twice (`Skupina` in
  the lot, `Kategorie` in admin); change `cs.json` first (a product decision), never one catalog.

### Parity guard

`messages.spec.ts` compares catalogs against each other, not a snapshot: every locale in `LOCALES`
has a catalog; English has every Czech key and no extra; same ICU arguments; no empty message;
typographic apostrophes; every contract `ErrorCode` translated per locale; `OUT_OF_HORIZON` and
`RESERVATIONS_LOCKED` stay distinct ("not open yet" versus "already locked"); no English message
is still the Czech one. A compile-time `const _check: Record<ErrorCode, string> = cs.errors`
makes a missing Czech error message a typecheck failure; it works only because
`tsconfig.spec.json` includes `messages/**/*.spec.ts`, so do not narrow that include. The "still
Czech" check has an eight-entry `SHARED` allowlist (`Sit & Park`, bare `{date}` cells, an em
dash, `Admin`, `E-mail`); do not widen it to make a failure go away.

### Choosing the locale

Per request (`i18n/resolve-locale.ts`): the `NEXT_LOCALE` cookie if it is a shipped locale (an
explicit choice wins); otherwise `Accept-Language` in quality order: `cs` for Czech **and
Slovak** (a half-translated Slovak catalog would be worse than either), `en` for any other named
language, `cs` for an absent, wildcard or malformed header. The result feeds `<html lang>`, the
catalog and `generateMetadata`; `global-error.tsx` negotiates from `navigator.language` (no
layout above it). The switcher is a `SegmentedControl` in settings with endonym labels;
`use-locale-switch.ts` writes the cookie (`path=/`, one year, `SameSite=Lax`, no `Secure` so
plain-HTTP dev works, lowercase because `isLocale` is case-sensitive) and calls
`router.refresh()`. There is **no locale URL segment, no next-intl middleware and no
`i18n/request.ts`**: the root layout is already dynamic and hands the catalog to a client provider.

### Date formatting

`createDateFormatters(locale)` returns eight memoised formatters (`fullDate`, `dayMonthAndYear`,
`dayAndMonth`, `monthAndYear`, `monthName`, `monthLocative`, `weekdayName`, `year`); components use
`useDateFormatters()`, pure view modules take a `DateFormatters` as their last parameter. `Intl`
gives the Czech genitive (`25. srpna`) only when `day` is in the same call, hence separate
methods; never slice a formatted string apart. `monthLocative` (`srpnu`) is a hand-written table
because CLDR has no locative; `en` returns the standalone name and out of range throws
`RangeError`. Inputs are `DateOnly`, formatted at UTC midnight, so the day never shifts with the
Prague zone or DST. Not supported, on purpose: locale URL routing, a third locale (a JSON file,
an entry in `LOCALES` and a line in `load-messages.ts`; Slovak is not one), translated URLs or API
messages; the ICS feed's Czech copy lives in `libs/sit-and-park/calendar-export`.

## Tests

`nx run web:test`: Jest with `next/jest`, jsdom plus Node's fetch/stream globals
(`jest-environment-web.cjs`).

- **Overwrite `transformIgnorePatterns` on the _resolved_ config**: `next/jest` appends a custom
  value after its own entries and Jest skips a file matching _any_ entry, so appending cannot
  exempt ESM-only packages. The override is at the bottom of `jest.config.cts`; a new ESM-only
  dependency goes in `esmOnlyPackages` (libs share `ESM_ONLY_PACKAGES` from `jest.preset.js`).
- `FormData`, `Blob` and `File` are jsdom's here: React 19 builds a form `action` with
  `new FormData(formElement)`, which Node's `FormData` rejects.
- A lib spec touching contract-backed code needs `@jest-environment node`; tests that build a real
  `QueryClient` beside the `@orpc/tanstack-query` bridge live in the web app (`module: esnext`).
- `web-e2e/src/locale.spec.ts` is the only browser spec not run in Czech. See `doc/testing.md`.
