/**
 * The employee sync's decision, as a pure function: what a list from HiBob
 * does to the users we have. No I/O, so every rule is unit-tested in
 * `employee-sync-plan.spec.ts`; `EmployeeSyncService` only reads the users,
 * calls {@link planEmployeeSync} and, in live mode, applies the plan.
 *
 * Rules (`doc/employee-sync.md`, `doc/decision/0330-*`):
 *
 * 1. The whole list is validated first; one bad row rejects everything.
 * 2. An empty list, or one shorter than 90 % of the active synced users, is
 *    rejected (a broken export must not offboard the company).
 * 3. A *manual* account (`manualAccount`, or an address outside
 *    `@team.blue`) is never touched.
 * 4. Rows match by HiBob id, then by e-mail. Conflicting matches are warnings,
 *    resolved by hand. An existing user is linked, renamed and reactivated,
 *    never re-addressed, and nothing else about them changes.
 * 5. Active synced users missing from the list are deactivated.
 */

import type { EmployeeSyncReasonCode, EmployeeSyncRow } from '@garage/contract';

export const EMPLOYEE_DOMAIN = '@team.blue';

/** A list may be at most this much shorter than the active synced users. */
export const MAX_SHRINK = 0.1;

/** How many bad rows the rejection reason names before "and N more". */
const REPORTED_ROW_PROBLEMS = 5;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `syncEmailSchema` / `syncNameSchema` in the contract's summary. */
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 200;

/** What the plan needs to know about an existing user. */
export interface SyncProfile {
  id: string;
  email: string;
  name: string;
  hibobId: string | null;
  active: boolean;
  manualAccount: boolean;
}

/** A validated, cleaned row. */
export interface CleanRow {
  hibobId: string;
  email: string;
  name: string;
}

export interface ProfileUpdate {
  userId: string;
  email: string;
  /** The user's current name. */
  name: string;
  /** Set when the user had no HiBob id yet. */
  linkHibobId?: string;
  rename?: { from: string; to: string };
  reactivate?: true;
}

export type EmployeeSyncPlan =
  | {
      status: 'REJECTED';
      code: EmployeeSyncReasonCode;
      reason: string;
      received: number;
      activeBefore: number;
    }
  | {
      status: 'OK';
      received: number;
      activeBefore: number;
      create: CleanRow[];
      update: ProfileUpdate[];
      deactivate: SyncProfile[];
      unchanged: number;
      warnings: string[];
    };

export function isManualAccount(profile: Pick<SyncProfile, 'email' | 'manualAccount'>): boolean {
  return profile.manualAccount || !normaliseEmail(profile.email).endsWith(EMPLOYEE_DOMAIN);
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function reject(
  code: EmployeeSyncReasonCode,
  detail: string,
  received: number,
  activeBefore: number
): EmployeeSyncPlan {
  return { status: 'REJECTED', code, reason: `${code}: ${detail}`, received, activeBefore };
}

/** Cleans every row, or returns the problems (1-based row numbers). */
export function validateRows(
  rows: readonly EmployeeSyncRow[]
): { rows: CleanRow[] } | { problems: string[] } {
  const problems: string[] = [];
  const clean: CleanRow[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const n = index + 1;
    const hibobId = (row.id ?? '').trim();
    const email = normaliseEmail(row.email ?? '');
    const name = (row.name ?? '').trim();
    const before = problems.length;

    if (hibobId === '') {
      problems.push(`row ${n}: missing HiBob id`);
    } else if (seenIds.has(hibobId)) {
      problems.push(`row ${n}: duplicate HiBob id ${hibobId}`);
    }
    if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) {
      problems.push(`row ${n}: invalid e-mail`);
    } else if (seenEmails.has(email)) {
      problems.push(`row ${n}: duplicate e-mail ${email}`);
    }
    if (name === '') {
      problems.push(`row ${n}: missing name`);
    } else if (name.length > MAX_NAME_LENGTH) {
      problems.push(`row ${n}: name longer than ${MAX_NAME_LENGTH} characters`);
    }

    seenIds.add(hibobId);
    seenEmails.add(email);
    if (problems.length === before) {
      clean.push({ hibobId, email, name });
    }
  });

  return problems.length === 0 ? { rows: clean } : { problems };
}

export function planEmployeeSync(
  rawRows: readonly EmployeeSyncRow[],
  profiles: readonly SyncProfile[]
): EmployeeSyncPlan {
  const received = rawRows.length;
  const synced = profiles.filter((profile) => !isManualAccount(profile));
  const activeBefore = synced.filter((profile) => profile.active).length;

  if (received === 0) {
    return reject('EMPTY_LIST', 'The employee list is empty.', received, activeBefore);
  }
  const validated = validateRows(rawRows);
  if ('problems' in validated) {
    const shown = validated.problems.slice(0, REPORTED_ROW_PROBLEMS).join('; ');
    const more = validated.problems.length - REPORTED_ROW_PROBLEMS;
    return reject(
      'INVALID_ROWS',
      `The list has invalid rows: ${shown}${more > 0 ? ` and ${more} more` : ''}.`,
      received,
      activeBefore
    );
  }
  const minimum = Math.ceil(activeBefore * (1 - MAX_SHRINK));
  if (received < minimum) {
    return reject(
      'LIST_SHRANK',
      `The list has ${received} employees, the app has ${activeBefore} active ones; a drop of more than 10 % (minimum ${minimum}). Nothing was changed.`,
      received,
      activeBefore
    );
  }

  const byHibobId = new Map<string, SyncProfile>();
  const byEmail = new Map<string, SyncProfile>();
  for (const profile of profiles) {
    if (profile.hibobId !== null) {
      byHibobId.set(profile.hibobId, profile);
    }
    byEmail.set(normaliseEmail(profile.email), profile);
  }

  const seen = new Set<string>();
  const create: CleanRow[] = [];
  const update: ProfileUpdate[] = [];
  const warnings: string[] = [];
  let unchanged = 0;

  for (const row of validated.rows) {
    const byId = byHibobId.get(row.hibobId);
    const byMail = byEmail.get(row.email);

    if (byId !== undefined && byMail !== undefined && byId.id !== byMail.id) {
      warnings.push(
        `${row.email}: HiBob id ${row.hibobId} belongs to ${byId.email}, the e-mail to another account; resolve by hand.`
      );
      seen.add(byId.id).add(byMail.id);
      continue;
    }
    const profile = byId ?? byMail;
    if (profile === undefined) {
      create.push(row);
      continue;
    }
    seen.add(profile.id);
    if (isManualAccount(profile)) {
      unchanged += 1;
      continue;
    }
    if (byId === undefined && profile.hibobId !== null) {
      warnings.push(
        `${row.email}: the account has HiBob id ${profile.hibobId}, the list has ${row.hibobId}; resolve by hand.`
      );
      continue;
    }
    if (normaliseEmail(profile.email) !== row.email) {
      warnings.push(
        `${profile.email}: HiBob has e-mail ${row.email}; the app’s e-mail is not changed, update it by hand.`
      );
    }

    const change: ProfileUpdate = { userId: profile.id, email: profile.email, name: profile.name };
    if (profile.hibobId === null) {
      change.linkHibobId = row.hibobId;
    }
    if (profile.name !== row.name) {
      change.rename = { from: profile.name, to: row.name };
    }
    if (!profile.active) {
      change.reactivate = true;
    }
    if (change.linkHibobId === undefined && change.rename === undefined && !change.reactivate) {
      unchanged += 1;
    } else {
      update.push(change);
    }
  }

  const deactivate = synced.filter((profile) => profile.active && !seen.has(profile.id));

  return {
    status: 'OK',
    received,
    activeBefore,
    create,
    update,
    deactivate,
    unchanged,
    warnings,
  };
}
