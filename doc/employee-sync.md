# Employee sync (HiBob via Keboola)

A Keboola flow pushes the HiBob employee list to the API. The sync links,
renames, reactivates and pre-creates employees, and deactivates the ones that
left. Decisions: `doc/decision/0329-users-are-deactivated-never-deleted.md`,
`doc/decision/0330-employee-sync-endpoint-key-hash-dry-run-shrink-protection.md`.
Code: `apps/sit-and-park/api/src/employee-sync/`; shapes: `libs/sit-and-park/contract/src/api/employee-sync.ts`.

## Endpoint

`POST /api/employee-sync`, outside oRPC (like the ICS feed): `@Public()`, the
strict throttle, and its own bearer key.

```http
POST /api/employee-sync
Authorization: Bearer <key>
Content-Type: application/json

{ "source": "keboola", "employees": [{ "id": "123", "email": "jane@team.blue", "name": "Jane Doe" }] }
```

`source` is optional (default `keboola`, at most 200 characters). The body may
be up to 2 MB; that limit applies to this path only, every other route keeps
`BODY_LIMIT`.

## Key and rotation

The server knows only the key's SHA-256, from `EMPLOYEE_SYNC_KEY_SHA256`
(64 hex characters). Nothing secret is in the database, and neither the key nor
the `Authorization` header is logged.

1. Generate a key of at least 32 characters, e.g. `openssl rand -base64 48`.
2. Compute its hash: `printf %s "$KEY" | shasum -a 256`.
3. Set `EMPLOYEE_SYNC_KEY_SHA256` to the hash, restart the API, put the key in
   Keboola. The old key stops working on restart.

## Responses

| status | when | body |
| --- | --- | --- |
| 200 | applied, or dry run | `{ ok: true, mode, reason: null, runId, counts }` |
| 400 | malformed JSON (no run) or wrong shape (`INVALID_PAYLOAD`, run logged) | as above with `ok: false`, or the API's transport error |
| 401 | missing, short (< 32) or wrong key | `{ ok: false, reason }` |
| 413 | body above 2 MB | the API's transport error |
| 422 | list rejected (`EMPTY_LIST`, `INVALID_ROWS`, `LIST_SHRANK`); the Keboola step fails | `{ ok: false, mode, reason, runId, counts }` |
| 503 | `EMPLOYEE_SYNC_KEY_SHA256` unset | `{ ok: false, reason }` |

`reason` is `"<CODE>: <English detail>"`; the codes are
`EMPLOYEE_SYNC_REASON_CODES` in the contract and the admin UI translates them.
`counts` has `received`, `activeBefore`, `created`, `renamed`, `deactivated`,
`reactivated`, `linked`, `unchanged`, `warnings`.

## Rules

- **The whole list is validated first.** One bad row rejects everything: a
  missing id or name, an invalid e-mail, a duplicate id or e-mail, an id over
  100, a name over 200 or an e-mail over 320 characters. Rows are trimmed and
  e-mails lower-cased.
- **Shrink protection, on the outcome.** Rejected when the list is empty, or
  when the run would deactivate so many active synced users that fewer than
  `ceil(0.9 × active synced users)` stay. Counting matches rather than rows
  means a long list of strangers is rejected too.
- **Manual accounts are never touched**: `manualAccount = true`, or an e-mail
  outside `@team.blue`. A row outside `@team.blue` that matches nobody is not
  created (a warning).
- **Matching** by HiBob id, then by e-mail. If the id points at one account and
  the e-mail at another, the e-mail matches an account with a different HiBob
  id, or two accounts have the row's e-mail in different letter case, the row
  is skipped with a warning.
- **Existing users**: the HiBob id is linked when missing, the name follows
  HiBob. An inactive user is reactivated only when their latest
  `USER_DEACTIVATED` audit row has `source: 'EMPLOYEE_SYNC'`; one an admin
  deactivated (or with no audit row) stays inactive, with a warning. Cancelled
  bookings are not restored. The e-mail is never changed (a warning instead),
  nor role, office, hive or desk.
- **New employees are pre-created** with the oldest active office (none
  active: no office, and a warning), their HiBob id and a placeholder `oktaId`
  (`hibob:<id>`). Sign-in matches by `oktaId`, then by the lower-cased e-mail,
  and rebinds the row to the Okta subject, so the first login adopts it.
- **Active synced users missing from the list are deactivated**, except one
  whose deactivation would leave no active admin (a warning). Manual admins
  count as remaining admins.
- **One user's failure is a warning, not an abort.** A failed update, create
  or deactivation is logged at `error` and listed in the run's warnings; the
  rest of the run is applied and the run is logged. The summary is clipped to
  its schema; should it still not fit, the run is logged with an empty summary
  and one warning.

## Dry run and live mode

`EmployeeSyncSettings.liveMode`, off by default, switched by an admin
(`admin.employeeSync.setLiveMode`, audited). A dry run computes everything,
including what each deactivation would free, and writes only the run log.
Every authenticated call that parses is logged in `EmployeeSyncRun`, rejected
ones included, with the summary (each list capped at 500).
`admin.employeeSync.get` returns the mode, whether a key is configured and the
last 12 runs. The run itself has no audit row: the caller is not a user and
`AuditLog.actorUserId` must be one; the run log is the record.

## Deactivation

One function (`UserDeactivationService`) serves the sync and an admin setting
`active: false` through `admin.user.update`. In one transaction per user:
`active = false`, `deactivatedAt`, future (today or later) desk reservations
cancelled and pending desk requests rejected (reason `USER_DEACTIVATED`),
future waitlist entries removed, and `USER_DEACTIVATED` audited with the counts
(attributed to the admin, or for the sync to the user themselves). After the
commit, each future parking reservation is cancelled through the normal cancel
path, so the freed spot is promoted to the next person queued; one that fails
is logged at `error`, left out of `freedParkingReservations` and reported as a
warning. Owned hives and a permanent desk are kept and reported as warnings.

The clean-up is re-runnable. Each live sync sweeps synced users who are
inactive but still hold future parking or desk reservations, waitlist entries
or pending desk requests, finishes their clean-up and says so in a warning.
An admin setting `active: false` again does the same for that user; the flip
itself happens inside the deactivation transaction, so a failed attempt leaves
the user active. Only the call that flips the account audits
`USER_DEACTIVATED`, so the record of who deactivated someone survives a
sweep. Desk reservations cancelled this way are audited as
`DESK_RESERVATION_CANCELLED` when the sync did it (the actor is the holder) and
`DESK_RESERVATION_CANCELLED_BY_ADMIN` when an admin did, both with reason
`USER_DEACTIVATED`. A deactivated user gets 403
from the API and 404 from the ICS feed.
