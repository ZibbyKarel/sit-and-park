# Integrations

Realtime (Socket.io), Slack notifications, the ICS calendar feed and the employee sync.
The deployment target is a single instance: no Redis, no broker; the upgrade seams are
named below.

## Domain events and their publisher

Services never talk to sockets or Slack. They return events from their transaction and
publish them after commit through `DomainEventPublisher`
(`apps/sit-and-park/api/src/reservations/reservation-events.ts`), an abstract class with
`publish`, `notifyPromotions`, `deskApprovalRequested` and `deskApprovalDecided`. It is
bound to `CompositeDomainEventPublisher`, which forwards each event to the realtime and the
Slack publisher, each in its own try, so a failing channel never blocks the other or the
caller; async rejections are contained too. A failed publish never fails the request.

## Realtime

Code: `apps/sit-and-park/api/src/realtime/`, payload schemas in
`libs/sit-and-park/contract/src/realtime/` (entry `@sit-and-park/contract/realtime`), client in
`libs/sit-and-park/realtime-client`. Web consumers: `web/src/lot/lot-screen/use-lot-realtime.ts`
and `web/src/desks/desks-screen/use-desk-realtime.ts`.

### Protocol

Path `/socket.io` (`SOCKET_IO_PATH`). Server to client:

| Event                       | Meaning                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `cell:locked` / `unlocked`  | Somebody is working on a (spot, day) cell; the asker is excluded             |
| `reservation:created`       | A reservation was made                                                       |
| `reservation:cancelled`     | A reservation was cancelled and nobody was promoted                          |
| `reservation:reassigned`    | A cancellation promoted the next person (replaces cancelled + created)       |
| `timed-reservations:updated`| Guest half-hour blocks of a spot and day changed                             |
| `waitlist:updated`          | A queue changed (join, leave, promotion, bulk)                               |
| `desk:reserved` / `released`| A desk reservation was made / is gone (`doc/desks.md`)                       |

Client to server: `day:subscribe`, `day:unsubscribe`, `cell:lock` (with an ack), `cell:unlock`.
Events are scoped to rooms `day:<date>` (`roomForDate`). A socket may hold at most
`MAX_DAY_ROOMS_PER_SOCKET` (64) day rooms. Every inbound and outbound payload is validated
against its Zod schema by lookup; an invalid inbound message is dropped without an ack, an
outbound failure is logged and never thrown.

### Authentication

The token is read from `handshake.auth.token` only. A Socket.io middleware runs the same
`JwksVerifierService` and `AuthUserService` as HTTP (no `NODE_ENV` branch, no dev bypass). A
refusal arrives as `CONNECT_ERROR` with the same message for every reason (`Unauthorized`), so
a client cannot tell a bad signature from a deactivated user. The socket carries
`data: { user: UserSummary, role }`.

### Visibility

A hidden parking spot's events go to admin sockets only; a hidden-spot `cell:lock` from a
non-admin is dropped silently. **Broadcasts are not office-scoped**: a day room carries every
office's events.

### Cell locks

A lock advertises "somebody is in this dialog" so two people do not fill in the same cell. It
is advisory, not a reservation. `LockService` is one concrete in-memory class (a Map with
timers). TTL is `REALTIME_LOCK_TTL_MS` (default 30 s; a value under 20 s logs a warning
because the client renews at half the TTL). There is no heartbeat command: re-sending
`cell:lock` renews. Ownership is by user; release is keyed by user plus socket id, so a second
tab of the same user does not release the first's lock, and a disconnect releases that
socket's locks. A multi-instance deployment needs a shared lock store.

### Client library

`RealtimeProvider`, `useRealtime`, `useDayRoom`, `useRealtimeEvent`, `useCellLock`. The
provider's `url` option is the API origin, not the web base URL. Statuses: `connecting`,
`connected`, `disconnected`, `rejected`.

- After a refused handshake the client replaces the socket and retries after 1 s, 5 s and
  30 s (`REJECTED_RETRY_DELAYS_MS`), then waits for an explicit `reconnect()`.
- `cell:lock` waits for its ack for `CELL_LOCK_ACK_TIMEOUT_MS` (5 s), two attempts. Renewal is
  at half the TTL with a one-second floor.
- Rooms are re-joined on reconnect; screens refetch their day after every reconnect because
  events may have been missed.

### Server wiring

`RealtimeGateway` registers a `GracefulShutdownService` closer named `socket.io`. CORS follows
`CORS_ALLOWED_ORIGINS`. `RealtimeIoAdapter.installClusterAdapter` is a no-op: the seam where a
Redis adapter would go for several instances.

## Slack

Code: `apps/sit-and-park/api/src/slack/`. Outbound only: `chat.postMessage` and
`users.lookupByEmail`. There are no slash commands, no interactive Block Kit, and
`SlackModule` has no controllers. The bot needs scopes `chat:write` and `users:read.email`.
Message copy is Czech, in `slack/slack-messages.ts`.

### Messages

| Message                       | Trigger                                              | Goes to                  |
| ----------------------------- | ---------------------------------------------------- | ------------------------ |
| A parking spot was freed      | `reservation:cancelled` (not for hidden spots)       | the channel              |
| You were promoted             | a waitlist promotion                                 | DM to the promoted user  |
| Daily summary                 | scheduled job; hidden spots excluded, guest blocks count as unavailable | the channel |
| Desk approval requested       | a new request                                        | DM to the hive owner     |
| Desk approval decided         | a decision, human or automatic                       | DM to the requester      |

DMs resolve the user through `users.lookupByEmail`; a user not found in Slack is `skipped`.

### Delivery

`SlackClient` never throws; each call returns `delivered`, `disabled`, `failed` or `skipped`.
Retries: HTTP 429 waits for `Retry-After`; 5xx and network errors back off exponentially;
4xx and `ok: false` answers are not retried. Each attempt has its own timeout (AbortController).
Delivery is at-least-once. The Web API client is built with
`attachOriginalToWebAPIRequestError: false` and `slack-token-redaction.ts` scrubs the bot token
from anything logged, so a failure cannot leak it.

### Configuration

| Variable                       | Default | Notes                                       |
| ------------------------------ | ------- | ------------------------------------------- |
| `SLACK_ENABLED`                | `false` | Parsed from a string; off means `disabled`  |
| `SLACK_BOT_TOKEN`              | -       | Required when enabled                       |
| `SLACK_CHANNEL_ID`             | -       | Required when enabled                       |
| `SLACK_REQUEST_TIMEOUT_MS`     | `5000`  | Per attempt                                 |
| `SLACK_RETRY_ATTEMPTS`         | `3`     |                                             |
| `SLACK_RETRY_BASE_DELAY_MS`    | `500`   | Backoff base                                |
| `SLACK_DAILY_SUMMARY_AT`       | `08:00` | Europe/Prague                               |

### The daily summary job

`slack/daily-summary.job.ts` is registered through `SchedulerRegistry` with
`timeZone: Europe/Prague` and skips non-business days. It runs through
`scheduling/ScheduledJobRunner`, which swallows a throw, skips a run while the previous is
still going, and drains running jobs on shutdown via `GracefulShutdownService`. With two
replicas it would post twice; the upgrade path is an advisory lock around the run.

## ICS calendar feed

Code: `apps/sit-and-park/api/src/calendar/`, generation in `libs/sit-and-park/calendar-export`
(the only code allowed to import `ical-generator`), URL shape in
`libs/sit-and-park/contract/src/api/ics.ts` (`ICS_FEED_BASE_PATH = '/api/calendar'`,
`buildIcsFeedUrl`).

`GET /api/calendar/<icsToken>.ics` is served by `CalendarController`, outside oRPC (a calendar
client cannot speak it), `@Public()` and `@StrictThrottle()` (default 20 requests per minute
per client, `THROTTLE_STRICT_LIMIT` / `THROTTLE_STRICT_TTL_MS`). The token is the credential:
a user is resolved by `{ icsToken, active: true }` in one `findFirst`.

- **Every failure is a 404**: unknown token, malformed token, deactivated user. The responses
  are identical so a token cannot be probed.
- Headers are set on success only: `Content-Type: text/calendar; charset=utf-8`,
  `Cache-Control: private, max-age=300, must-revalidate`,
  `Content-Disposition: attachment; filename="sit-and-park.ics"`,
  `X-Robots-Tag: noindex, nofollow`.
- Contents: all-day events with no time zone, `DTSTAMP` = the row's `createdAt`, calendar name
  `Parkování`, `PRODID -//sit-and-park//parking//CS`, refresh `PT1H`. Parking events read
  `Parkování – <label>` with the spot label as location. Desk events read `Stůl D-014`, description
  `Rezervovaný stůl D-014 (<zone>).`, the zone as location and UID `desk-<id>@sit-and-park`.
- Window: from 30 days back (`ICS_FEED_PAST_DAYS`) with no forward bound, ordered by date then id.
- A user who holds or queues for a hidden spot still gets their own reservation in the feed.
- `me.regenerateIcsToken` replaces the token; the old URL stops working immediately.
- `logging/redact-ics-token.ts` (`redactIcsToken`) keeps the token out of access logs.

## Employee sync

Code: `apps/sit-and-park/api/src/employee-sync/`; contract
`libs/sit-and-park/contract/src/api/employee-sync.ts`. HiBob is the source of truth for who
works here; an automation pushes the full list of employees to the app.

### Endpoint

`POST /api/employee-sync`, outside oRPC, `@Public()`, strict throttle, authenticated by a
bearer key. The body limit `EMPLOYEE_SYNC_BODY_LIMIT` (2 MB) applies to this path only.

The app knows only `EMPLOYEE_SYNC_KEY_SHA256`; a configured key is at least 32 characters
(`MIN_EMPLOYEE_SYNC_KEY_LENGTH`) and the presented key is hashed and compared with
timing-safe equality.

| Status | Meaning                                                                                |
| ------ | -------------------------------------------------------------------------------------- |
| 200    | Applied, or a dry run                                                                  |
| 400    | Malformed JSON, or `INVALID_PAYLOAD` (the run is logged)                               |
| 401    | Missing, too short or wrong key (`INVALID_KEY`)                                        |
| 413    | Body over 2 MB                                                                         |
| 422    | `EMPTY_LIST`, `INVALID_ROWS` or `LIST_SHRANK`                                          |
| 503    | `NOT_CONFIGURED` (no key hash set)                                                     |

A rejected run carries a reason of the form `"<CODE>: detail"` from
`EMPLOYEE_SYNC_REASON_CODES`.

### Rules

- Only rows with email in `EMPLOYEE_DOMAIN` (`@team.blue`) count.
- **Shrink guard:** `MAX_SHRINK = 0.1`; a run must leave at least `ceil(0.9 x active synced
  users)`, otherwise `LIST_SHRANK` and nothing is applied. An empty list is always refused.
- Matching is by HiBob id, then by email. A new user gets a placeholder `oktaId`
  (`hibob:<id>`, replaced at first sign-in) and the oldest active office.
- A deactivated user is reactivated only if their latest `USER_DEACTIVATED` audit has
  `source: 'EMPLOYEE_SYNC'`; a person an admin deactivated stays deactivated.
- **Manual accounts** (`manualAccount`) are never touched. The last active admin is never
  deactivated.
- A failure for one user (`perUser`) is a warning, not a failed run.
- `sweepLeftovers` finishes the clean-up of earlier deactivations that did not complete.

### Dry run and live mode

Dry run is the default: the run is computed and logged, nothing is changed.
`EmployeeSyncSettings.liveMode` is switched with `admin.employeeSync.setLiveMode` (audited as
`EMPLOYEE_SYNC_SETTINGS_UPDATED`); `admin.employeeSync.get` shows the last 12 runs. Applied runs
are audited as `EMPLOYEE_SYNC_APPLIED`.

### Deactivation

`UserDeactivationService.deactivate(userId, source, actorId, today)` is shared by the sync and
`admin.user.update`. One transaction per user: desk reservations cancelled, pending requests
rejected, waitlist entries removed, `USER_DEACTIVATED` audited. After commit the user's parking
reservations are cancelled through `ReservationsService.cancel`, so the waitlist promotes. Hives
the user owns and a permanent desk are kept and reported as warnings. A deactivated user gets 403
from the API and 404 from the ICS feed; the cascade is tabulated in `doc/desks.md`.
