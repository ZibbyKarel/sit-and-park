# Authentication and authorization

How a person becomes an identified caller: `apps/sit-and-park/web` signs them in against Okta and keeps a session, and `apps/sit-and-park/api` turns the access token in that session into a user. The frontend half is `libs/sit-and-park/auth` (a wrapper over next-auth v5 / Auth.js, pinned to a beta), the backend half is `apps/sit-and-park/api/src/auth/`. When this document and the code disagree, trust the code.

## The one rule

**Dev, e2e and production run the same code. Only env values differ.** There is no `NODE_ENV` check, no test flag and no "skip auth locally" branch in `apps/sit-and-park/api/src/auth/**`, and no bypass flag, credentials provider or test-only branch in `libs/sit-and-park/auth`. Local development points `AUTH_OKTA_ISSUER` at the `mock-oauth2-server` container; production points it at the Okta org. Consequently the JWKS URI and the authorization and token endpoints are discovered, not hardcoded, and the tests stand up a real OIDC issuer instead of stubbing the verifier.

## Backend pieces (`apps/sit-and-park/api/src/auth/`)

| file                                   | role |
| -------------------------------------- | ---- |
| `jwks-verifier.service.ts`             | OIDC discovery, the single cached `JwksClient`, `getSigningKey()`, `verifyToken()`, failure classification and log throttling |
| `jwt-verify-options.ts`                | the one rule set both verification paths apply |
| `jwt.strategy.ts`                      | `passport-jwt` plumbing; delegates keys, rules and provisioning |
| `jwt-auth.guard.ts`, `public.decorator.ts` | the global default-deny guard and the `@Public()` opt-out |
| `roles.guard.ts`, `roles.decorator.ts` | `@Roles('ADMIN')` |
| `current-user.decorator.ts`, `authenticated-user.ts` | `@CurrentUser()` and the `AuthenticatedUser` shape |
| `auth-user.service.ts`                 | just-in-time provisioning, `icsToken`, deactivated user to `FORBIDDEN` |
| `token-claims.ts`                      | the Zod claim schema, parsed after verification |
| `auth.module.ts`                       | exports the verifier and user service (the Socket.io handshake reuses them) |

## The flow

### Sign-in and session

The web app never handles a password. Auth.js redirects to the issuer (PKCE and `state`), exchanges the authorization code server-side, and keeps the result in an encrypted httpOnly cookie (`strategy: 'jwt'`, default max age 30 days). `callbacks.authorized` returns false without a session, so the Next.js proxy (`apps/sit-and-park/web/src/proxy.ts`) redirects to `/login`. It matches everything except `/api/auth/*`, `/api/health` and static assets. Scopes requested: `openid profile email offline_access`. `offline_access` is required: without it Okta issues no refresh token and the session dies with the first access token.

### Frontend to API

Every API call carries `Authorization: Bearer <jwt>` with the access token from the session. Nothing else is accepted (no cookie, no query parameter): a token in a URL leaks into logs, `Referer` and history, so `ExtractJwt.fromAuthHeaderAsBearerToken()` is the only extractor.

### Guards

`AppModule` registers three global guards in this order, which is load-bearing:

```
ThrottlerGuard  ->  JwtAuthGuard  ->  RolesGuard
```

Throttling comes first so it applies to unauthenticated traffic; `JwtAuthGuard` makes every route authenticated by default (a controller written tomorrow is protected without anyone remembering); `RolesGuard` reads the `request.user` the previous guard set, so reversing the order would make every `@Roles()` route answer 401.

### Finding the key and verifying

`JwksVerifierService.getSigningKey()` decodes only the JOSE header (the one part of an unverified token ever read) to get `kid` and `alg`, refuses anything but `RS256` before any network call (`alg: none` and HMAC-with-the-public-key forgeries stop here), then asks the cached `JwksClient` for that `kid`. Every failure throws; nothing returns a fallback key.

`jsonwebtoken.verify` then applies `jwt-verify-options.ts`: `algorithms: ['RS256']` as an allow-list (never the token's own claim), `issuer` equal to `AUTH_OKTA_ISSUER`, `audience` equal to `AUTH_OKTA_AUDIENCE`, expiry enforced with no clock tolerance. Only after that are claims parsed by `authTokenClaimsSchema` (`sub` required, `email` and `name` optional, other claims tolerated). Nothing downstream reads an unverified claim.

**Trap:** `passport-jwt` overwrites `issuer`, `audience`, `algorithms` and `ignoreExpiration` from its top-level options, with `undefined` when absent. Passing the rules only as `jsonWebTokenOptions` silently disables issuer and audience checks, so they are spread at the top level and two pipeline tests (wrong issuer, wrong audience) guard it.

### Becoming a user

`JwtStrategy.validate()` passes the claims to `AuthUserService.resolve()`. The result is an `AuthenticatedUser` (`id`, `oktaId`, `email`, `name`, `role`, `active`), placed on `request.user` and handed out by `@CurrentUser()`. It deliberately carries no `icsToken`: that is the only credential on the personal calendar URL and only the ICS and settings handlers may hold it.

### Failure responses

| situation                                                                           | status  | body |
| ----------------------------------------------------------------------------------- | ------- | ---- |
| no header, bad signature, expired, wrong `iss`/`aud`, unknown `kid`, IdP unreachable | **401** | Nest's transport shape `{ statusCode, message }`, no `code` |
| `User.active === false`                                                             | **403** | `{ defined: false, code: 'FORBIDDEN', status: 403, message }` |
| `@Roles('ADMIN')` reached by a `USER`                                               | **403** | same |
| `@Roles(...)` with no `request.user`                                                | **401** | Nest shape |

Authentication fails before any procedure exists, so it cannot be one of the contract's typed errors. A deactivated user presented a valid token, and answering 401 would send them round the Okta login loop forever, so that is a typed `FORBIDDEN`. Stack traces are logged, never sent; no log line in `src/auth/**` carries a raw token, key or `icsToken`, and the logger redacts the `authorization` header.

## Roles

`USER_ROLES` is `['USER', 'ADMIN']`. The role is a database column on `User`; nothing in the token grants it, and a new user is a `USER`. Admins are assigned by an admin via `admin.user.update` (or seeded in dev). `@Roles()` takes the contract's `UserRole`, so a typo does not compile. Admin-only routes carry `@Roles('ADMIN')`; the oRPC router puts every admin procedure under `admin.` and a parity spec fails when a procedure has no route or an admin route has no guard. The last active admin cannot be demoted or deactivated, and an admin cannot deactivate themselves. Admins are not bound by the reservation window.

```ts
@Controller('spots')
export class SpotsController {
  @Get() list(@CurrentUser() user: AuthenticatedUser) {} // authenticated by default
  @Roles('ADMIN') @Post() create(@CurrentUser() admin: AuthenticatedUser) {}
}
// No token; authenticates on the secret in its own URL:
@Public() @StrictThrottle() @Get('ics/:token') feed(@Param('token') token: string) {}
```

## Public routes

`@Public()` is route metadata evaluated identically in every environment, for routes that cannot carry a bearer header:

- **Health probes** (`HealthController`) at `/health/live` and `/health/ready`, outside the `/api` prefix. They expose no data.
- **The personal ICS feed** (`CalendarController`): calendar clients send no headers; it authenticates on the token in its URL and carries the stricter throttle tier.
- **The employee-sync endpoint** (`EmployeeSyncController`), which authenticates with its own bearer key (see `doc/integrations.md`).

A `@Public()` route gets no `request.user`: `RolesGuard` fails closed, so `@Public()` next to `@Roles('ADMIN')` denies, and `@CurrentUser()` throws rather than returning `undefined`.

## Environment

| variable                  | read by                  | used for |
| ------------------------- | ------------------------ | -------- |
| `AUTH_SECRET`             | web                      | encrypts the Auth.js cookie; at least 32 characters |
| `AUTH_OKTA_ISSUER`        | web and api              | the OIDC issuer, shared verbatim. Web discovers the authorization and token endpoints from it, the API discovers the JWKS URI from the same document. The only Okta URL anywhere |
| `AUTH_OKTA_AUDIENCE`      | api                      | the `aud` every bearer must carry |
| `AUTH_OKTA_CLIENT_ID`     | web                      | the web app's OAuth2 client |
| `AUTH_OKTA_CLIENT_SECRET` | web                      | its secret, server-side only |

The web variables are validated fail-fast in `apps/sit-and-park/web/src/env.ts`; `AUTH_OKTA_AUDIENCE` belongs to the API's env schema. `libs/sit-and-park/auth` reads no environment variable itself: the web app passes the secrets to `createAuth` as arguments, bypassing Auth.js's implicit inference so `env.ts` is the one schema that decides what exists. None carries a `NEXT_PUBLIC_` prefix. `.env.example` documents all of them; the full variable list is in `doc/workspace.md`.

There is deliberately no `AUTH_TRUST_HOST`. Auth.js computes `trustHost` as false in production unless `AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL` or `CF_PAGES` is set, which would answer every `/api/auth/*` request with `UntrustedHost` in production only. `createAuthConfig` therefore sets `trustHost: true` outright: it is a property of the topology (single instance behind one reverse proxy), and `create-auth.spec.ts` drives the route handler under `NODE_ENV=production` and asserts a 200.

### Audience and the Okta org

`libs/sit-and-park/auth` sends no `audience` or `resource` parameter, so the token's `aud` is the issuer's choice and `AUTH_OKTA_AUDIENCE` must be set to match it.

- **Dev and e2e:** `mock-oauth2-server` (no `JSON_CONFIG`) mints `aud: default`, so `.env.example` sets `AUTH_OKTA_AUDIENCE=default` (not `api://default`).
- **Production:** the issuer must be an Okta Custom Authorization Server (`https://<org>.okta.com/oauth2/<id>`), whose audience (for the built-in one, `api://default`) goes in `AUTH_OKTA_AUDIENCE`. The Org Authorization Server (no `/oauth2/...`) mints the org URL as `aud`. This is expected behaviour, not yet observed against a real tenant; if wrong the fix is an env value, never code.
- **Symptom of a mismatch:** sign-in succeeds, then every API call and Socket.io handshake answers 401 with `jwt audience invalid`.

Three settings live in the identity provider and nothing here enforces them: register the redirect URI `https://<host>/api/auth/callback/okta` (the path comes from the provider id, the constant `OKTA_PROVIDER_ID`); use a Custom Authorization Server as issuer; and keep **refresh-token rotation switched off** until a `LockService` exists (concurrent refreshes are coalesced in-process only).

## What the browser sees

| value                        | lives in                                              | reaches the browser |
| ---------------------------- | ----------------------------------------------------- | ------------------- |
| refresh token                | the encrypted httpOnly session cookie                 | no                  |
| access token                 | that cookie, and React state after `/api/auth/session` | yes, in memory only |
| `AUTH_SECRET`, client secret | `process.env`, server only                            | no                  |

Nothing is written to `localStorage`, `sessionStorage` or a JS-readable cookie. The browser needs the access token because `libs/sit-and-park/realtime-client` puts it in the Socket.io handshake.

## Refresh-token rotation

Rotation lives in the `jwt` callback. At sign-in the access token, expiry and refresh token are copied onto the JWT. On each later session read, a token more than 60 s (`REFRESH_SKEW_SECONDS`) from expiry is returned untouched; inside that window the refresh token is exchanged at the discovered token endpoint, renewing before expiry so the renewed request does not race `exp`. On failure both tokens are dropped and `error: 'RefreshTokenError'` is set; the session is not retried while the flag is present. The client-authentication method (`client_secret_basic` or `client_secret_post`) is read from the discovery document's `token_endpoint_auth_methods_supported`, defaulting to basic.

The callback only runs when something reads the session, so `AuthProvider` polls `/api/auth/session` every 300 s (`SESSION_REFETCH_SECONDS`).

**Concurrent renewals.** A page load reads the session several times; with rotation enabled the first grant would invalidate the refresh token under the others and sign the user out. Callers presenting the same refresh token therefore share one in-flight grant, which covers a whole single-instance deployment but not several processes.

**When renewal fails**, three things happen: `getAccessToken()` returns `null` so `createApiClient` omits the header (the API answers "unauthenticated", not "stale token"); `callbacks.authorized` returns false so the next navigation redirects to sign-in; and `useRequireAuth()` calls `signOut()` to clear the dead cookie rather than signing in on top of it.

## Signing out

Sign-out clears the cookie and, load-bearing, adds the session's subject to a server-side revoked set (`libs/sit-and-park/auth/src/lib/revocation.ts`). Clearing alone is unreliable: under `strategy: 'jwt'` Auth.js re-issues the session cookie on every request that reads it (renders, RSC prefetches, the proxy), so the clearing `Set-Cookie` races renders already in flight and the browser keeps whichever arrives last.

On `events.signOut` the session's `sub` joins the revoked set; in the `jwt` callback a token whose `sub` is in the set makes the callback return `null`. Then `auth()` yields no session (the proxy redirects to `/login`) and the response clears the cookie, so a surviving cookie deletes itself on first use. `sub` works as the key because `@auth/core` assigns a fresh random UUID to `token.sub` on every completed sign-in: it names one sign-in session, re-encoding never changes it, and signing back in needs no special case. Nothing compares clocks; time is only the retention of entries (the session max age). A token with no `sub` is refused outright.

What it does not cover: the Okta access token is not revoked at the issuer (a copy keeps working against the API until it expires), and the revoked set is in memory, shared across Next.js bundles via `globalThis`. A restart forgets it and a second web instance would not see the first's sign-outs. The module refuses to boot on the Edge runtime, where each bundle has its own `globalThis` and the set would silently enforce nothing.

## Just-in-time provisioning

There is no sign-up screen. On a first request, `AuthUserService.resolve()`:

1. matches on `oktaId` (the token's `sub`);
2. failing that, matches on `email` and adopts the token's `sub` onto that row (a row seeded before the first login, or an Okta account deleted and recreated), logged at `warn`;
3. failing that, creates the row with a fresh `icsToken` (`crypto.randomBytes(32)`, base64url).

Then `active === false` is `FORBIDDEN`. Further rules:

- A valid token with **no `email` claim** for an unprovisioned `sub` is refused with 401 and an error log ("check the IdP scopes"); no placeholder address is invented.
- `email` is never refreshed from the token (it is the fallback identity key); `name` is, only when it differs, so the steady-state request does no write.
- The email is trimmed and lower-cased before lookup and create. `User.email` is a case-sensitive unique and the employee sync pre-creates rows lower-cased.
- **Concurrency.** The first request is routinely several at once. There is no application lock; `oktaId`, `email` and `icsToken` are `@unique`, so the loser gets `P2002`, which `AuthUserService` catches and retries (at most three attempts) until the re-read finds the winner's row.

## Discovery and key rotation

On the first token verified, the service fetches `${AUTH_OKTA_ISSUER}/.well-known/openid-configuration` and takes `jwks_uri` from it (Okta serves `${issuer}/v1/keys`, `mock-oauth2-server` serves `${issuer}/jwks`). The document is checked: its own `issuer` must equal the configured one (trailing slashes normalised) and `jwks_uri` must be on the same origin. Discovery is lazy (resolving it in the constructor would make boot depend on the IdP) and memoised, and a failed discovery drops the memo so the next request retries.

Rotation needs nothing operational: `jwks-rsa` caches signing keys per `kid` and does not cache failures, so the first token with a new `kid` is a cache miss that refetches the JWKS. Settings (constants in `jwks-verifier.service.ts`):

| setting                         | value       | why |
| ------------------------------- | ----------- | --- |
| `cache`                         | `true`      | one fetch per key, not per request |
| `cacheMaxAge`                   | 10 min      | bounds how long a withdrawn key stays usable |
| `cacheMaxEntries`               | 5           | an issuer publishes a handful of keys |
| `rateLimit` / `jwksRequestsPerMinute` | `true` / 12 | an unknown `kid` is a cache miss; this stops an anonymous caller making the API hammer the IdP |
| `timeout`                       | 5 s         | an unreachable IdP fails quickly |
| `cacheMaxAgeFallback`           | **unset**   | see below |

`cacheMaxAgeFallback` (serve the last good key while the JWKS endpoint is down) is deliberately off: that window is exactly when a leaked, revoked key would keep being trusted. An IdP outage means requests are rejected, not waved through; do not "fix" it. The HTTP strategy and the Socket.io handshake (`realtime-handshake.ts`) share the one `JwksClient` through `verifyToken()` then `AuthUserService.resolve()`; a second client would mean two caches, two rotation moments and two rate limiters.

## Diagnosing a 401

Every rejection reaches the caller as the same bare 401, so the logs carry the diagnosis. `JwksVerifierService` logs key-lookup failures with an `authFailure` field:

| `authFailure`           | level   | meaning | what to check |
| ----------------------- | ------- | ------- | ------------- |
| `issuer-unreachable`    | `error` | discovery did not answer 2xx | is the IdP up and reachable from the API host? |
| `discovery-rejected`    | `error` | the document's `issuer` differs from `AUTH_OKTA_ISSUER`, or `jwks_uri` is on another origin | `AUTH_OKTA_ISSUER` points at the wrong tenant; the `reason` field names the check |
| `jwks-unavailable`      | `error` | discovery worked, fetching keys did not | usually a partial IdP outage |
| `jwks-rate-limited`     | `error` | more than 12 JWKS fetches in a minute | a flood of unknown `kid`s |
| `signing-key-not-found` | `debug` | the JWKS has no key with this `kid` | normally someone else's token; if it hits everyone, the IdP rotated to an unpublished key |
| `malformed-token`       | `debug` | not a JWT, or an algorithm we do not accept | background noise on a public endpoint |

Two other 401s happen after a key was found and are not in that table: `jsonwebtoken` rejecting the token (signature, expiry, `iss`, `aud`; not logged individually, so if nobody can log in and there is no `authFailure` line, compare `AUTH_OKTA_AUDIENCE` against the `aud` the IdP mints), and a valid token with no `email` claim for an unprovisioned subject (error log from `AuthUserService`; first thing to check on a fresh dev environment). The four server-side kinds are `error` because each needs a human; the two caller-side kinds are `debug` so an anonymous caller cannot fill the log.

`FailureLogThrottle` emits the first occurrence of each kind immediately, then stays quiet for 60 s, counting what it swallowed and attaching `suppressedSinceLastLog` to the next line. It is keyed by failure kind only, so its map is bounded and a caller cannot grow it; a `kid` appears inside a line, truncated to 64 characters. Only an error's message is logged, never the object.

## Using it from the app

```ts
// apps/sit-and-park/web/src/auth.ts
export const { handlers, auth, signIn, signOut, getAccessToken } = createAuth({ ... });
// app/api/auth/[...nextauth]/route.ts:  export const { GET, POST } = handlers;
// proxy.ts:                              export { auth as proxy } from './auth';
const api = createApiClient({ url: apiRpcUrl(env.NEXT_PUBLIC_API_URL), getAccessToken });
```

`apiRpcUrl` (`apps/sit-and-park/web/src/api-url.ts`) is required: `NEXT_PUBLIC_API_URL` stops at the global prefix (`http://localhost:3000/api`) while the oRPC transport is mounted one segment below (`/api/rpc/...`), and `RPCLink` appends only the procedure path. Passing the configured URL straight in calls `/api/me/get`, which 404s every request. The same file derives the readiness-probe URL and the Socket.io origin.

Browser side, from `@sit-and-park/auth/client`: `AuthProvider` (given the server-read session), `useRequireAuth()`, `useAccessTokenProvider()` (stable identity, latest session), `signIn`, `signOut`, `useSession`. The two entry points are separate on purpose: the server one pulls in Auth.js route handlers and `next/server`, which have no place in a browser bundle, and `client-boundary.spec.ts` fails if the client entry reaches the server modules.

## How it is tested

Everything below runs without Docker (see `doc/testing.md` for the layers).

- **A real OIDC issuer.** `apps/sit-and-park/api/src/auth/testing/oidc-test-issuer.ts` is an in-process HTTP server with a genuine discovery document and a JWKS of real RSA keys, and tests sign real RS256 tokens against it. It publishes the JWKS at `/jwks` so a reintroduced hardcoded Okta path fails the suite.
- **The assembled application.** `auth-pipeline.spec.ts` boots the real `AppModule` with the `configureApp()` that `main.ts` uses on an ephemeral port and drives it with `fetch`. It observes properties of the composition: issuer and audience really checked, a deactivated user getting 403 not 401, an undecorated route protected, probes reachable.
- **Provisioning concurrency.** `testing/in-memory-user-store.ts` raises a genuine `PrismaClientKnownRequestError` P2002 with the `meta.target` Postgres produces; the HTTP-level concurrency test holds the insert open so the requests genuinely race. That Postgres raises P2002 for these indexes is covered by the database suites.
- **The frontend half.** `libs/sit-and-park/auth` tests stub only `fetch` and drive the real callbacks, `SessionProvider` and `createApiClient`.
- **Over HTTP without a browser.** `apps/sit-and-park/api-e2e` checks a real token against a procedure, and the refusals a browser never sends (no header, another issuer, a non-Bearer scheme).
- **The browser.** `web-e2e` signs three personas in through the real OIDC redirect.

## Mock OIDC server

`docker-compose.yml` runs `ghcr.io/navikt/mock-oauth2-server` under the `dev` profile, port 8080. It accepts any client id and secret, serves a real discovery document and issues real signed JWTs. `.env.example` sets `AUTH_OKTA_ISSUER=http://localhost:8080/default`. It builds every URL it publishes (authorization endpoint, JWKS URI, the `iss` claim) from the `Host` header of the request it answers, so the issuer must be reachable under one name from both the API and the browser; the compose service therefore has the network alias `sit-and-park-oidc` (add `127.0.0.1 sit-and-park-api sit-and-park-oidc` to `/etc/hosts` when running the containers). Reach it under different names and sign-in succeeds while every API call 401s on a mismatched `iss`. Nothing in the `app` profile depends on it.

It mints no `email` claim, and provisioning refuses a subject without one. In the sign-in form, type the claims into the "Optional claims JSON" field, for example `{"email":"user@example.com","name":"Dev User"}`; the e2e login does this for each persona (`web-e2e/src/support/personas.ts` maps `admin@example.com`, `user@example.com`, `user2@example.com` to the seeded Dev Admin, Dev User, Dev User Two). The container re-mints its signing keys when it starts, so after `docker compose restart mock-oauth2-server` restart the API too, or it will 401 everything on a cached key the issuer no longer has.

## Not covered

No real Okta tenant has been exercised: the Custom-versus-Org audience, the refresh-rotation setting and key rotation against a live IdP rest on Okta's documentation. The suites do not run the real `mock-oauth2-server` container except in the e2e layers.
