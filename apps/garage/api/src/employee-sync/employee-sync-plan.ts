/**
 * The employee sync's decision, as a pure function: what a list from HiBob
 * does to the users we have. No I/O, so every rule is unit-tested in
 * `employee-sync-plan.spec.ts`; `EmployeeSyncService` only reads the users,
 * calls {@link planEmployeeSync} and, in live mode, applies the plan.
 *
 * Rules (`doc/employee-sync.md`, `doc/decision/0330-*`):
 *
 * 1. The whole list is validated first; one bad row rejects everything.
 * 2. An empty list is rejected, and so is a plan that would deactivate more
 *    than 10 % of the active synced users (fewer than 90 % would stay): a
 *    broken export, or a list of strangers, must not offboard the company.
 * 3. A *manual* account (`manualAccount`, or an address outside
 *    `@team.blue`) is never touched, and a row outside `@team.blue` creates
 *    nobody.
 * 4. Rows match by HiBob id, then by e-mail. Conflicting matches, and two
 *    accounts whose e-mails differ only in case, are warnings, resolved by
 *    hand. An existing user is linked, renamed and reactivated (only when the
 *    sync itself deactivated them), never re-addressed, and nothing else
 *    about them changes.
 * 5. Active synced users missing from the list are deactivated, except the
 *    last active admin.
 */

import type {
  EmployeeSyncReasonCode,
  EmployeeSyncRow,
  EmployeeSyncSummary,
} from '@garage/contract';
import { EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT } from '@garage/shared-types';

export const EMPLOYEE_DOMAIN = '@team.blue';

/** A list may be at most this much shorter than the active synced users. */
export const MAX_SHRINK = 0.1;

/** How many bad rows the rejection reason names before "and N more". */
const REPORTED_ROW_PROBLEMS = 5;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Bounds of `employeeSyncSummarySchema` (contract `schemas/entities.ts`). */
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 200;
const MAX_HIBOB_ID_LENGTH = 100;
const MAX_WARNING_LENGTH = 1000;
const MAX_DESK_CODE_LENGTH = 40;
const MAX_PERMANENT_DESKS = 10;
const MAX_HIVE_NAME_LENGTH = 100;
const MAX_OWNED_HIVES = 100;

/** What the plan needs to know about an existing user. */
export interface SyncProfile {
  id: string;
  email: string;
  name: string;
  hibobId: string | null;
  active: boolean;
  manualAccount: boolean;
  role: 'USER' | 'ADMIN';
  /**
   * The latest `USER_DEACTIVATED` audit row says `source: 'EMPLOYEE_SYNC'`.
   * Only such a user is reactivated: an admin's deactivation (or one with no
   * audit row) stands.
   */
  deactivatedBySync: boolean;
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

export function normaliseEmail(email: string): string {
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
    } else if (hibobId.length > MAX_HIBOB_ID_LENGTH) {
      problems.push(`row ${n}: HiBob id longer than ${MAX_HIBOB_ID_LENGTH} characters`);
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

  const byHibobId = new Map<string, SyncProfile>();
  const byEmail = new Map<string, SyncProfile[]>();
  for (const profile of profiles) {
    if (profile.hibobId !== null) {
      byHibobId.set(profile.hibobId, profile);
    }
    const key = normaliseEmail(profile.email);
    byEmail.set(key, [...(byEmail.get(key) ?? []), profile]);
  }

  const seen = new Set<string>();
  const create: CleanRow[] = [];
  const update: ProfileUpdate[] = [];
  const warnings: string[] = [];
  let unchanged = 0;

  for (const row of validated.rows) {
    const sameEmail = byEmail.get(row.email) ?? [];
    if (sameEmail.length > 1) {
      warnings.push(
        `${row.email}: ${sameEmail.length} accounts have this e-mail in different letter case; resolve by hand.`
      );
      for (const profile of sameEmail) {
        seen.add(profile.id);
      }
      continue;
    }
    const byId = byHibobId.get(row.hibobId);
    const byMail = sameEmail[0];

    if (byId !== undefined && byMail !== undefined && byId.id !== byMail.id) {
      warnings.push(
        `${row.email}: HiBob id ${row.hibobId} belongs to ${byId.email}, the e-mail to another account; resolve by hand.`
      );
      seen.add(byId.id).add(byMail.id);
      continue;
    }
    const profile = byId ?? byMail;
    if (profile === undefined) {
      if (row.email.endsWith(EMPLOYEE_DOMAIN)) {
        create.push(row);
      } else {
        // It would be a manual account forever, out of the sync's reach.
        warnings.push(`${row.email}: not a ${EMPLOYEE_DOMAIN} address; not created.`);
      }
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
      if (profile.deactivatedBySync) {
        change.reactivate = true;
      } else {
        warnings.push(
          `${profile.email}: deactivated by an admin, not by the sync; not reactivated, reactivate by hand.`
        );
      }
    }
    if (change.linkHibobId === undefined && change.rename === undefined && !change.reactivate) {
      unchanged += 1;
    } else {
      update.push(change);
    }
  }

  // Never leave the app without an active admin (`UsersService` has the same
  // rule); manual admins count, they keep their access.
  let activeAdmins = profiles.filter((p) => p.active && p.role === 'ADMIN').length;
  const deactivate: SyncProfile[] = [];
  for (const profile of synced) {
    if (!profile.active || seen.has(profile.id)) {
      continue;
    }
    if (profile.role === 'ADMIN') {
      if (activeAdmins <= 1) {
        warnings.push(
          `${profile.email}: missing from the list but the last active admin; not deactivated.`
        );
        continue;
      }
      activeAdmins -= 1;
    }
    deactivate.push(profile);
  }

  // Judged on the outcome, not on the row count: a list of strangers is long
  // enough but matches nobody.
  const minimum = Math.ceil(activeBefore * (1 - MAX_SHRINK));
  if (activeBefore - deactivate.length < minimum) {
    return reject(
      'LIST_SHRANK',
      `The list would deactivate ${deactivate.length} of ${activeBefore} active employees; a drop of more than 10 % (minimum ${minimum} stay). Nothing was changed.`,
      received,
      activeBefore
    );
  }

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

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Caps every list and clips every string so the summary always satisfies
 * `employeeSyncSummarySchema`: names and e-mails of existing users, hive names
 * and HiBob ids in warnings come from the database, not from the validated
 * list. Counts stay as they are; the caller takes totals from the uncapped one.
 */
export function fitSummary(summary: EmployeeSyncSummary): EmployeeSyncSummary {
  const list = <T>(items: readonly T[]): T[] => items.slice(0, EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT);
  const email = (value: string) => clip(value, MAX_EMAIL_LENGTH);
  const name = (value: string) => clip(value, MAX_NAME_LENGTH);
  return {
    ...summary,
    created: list(summary.created).map((r) => ({ email: email(r.email), name: name(r.name) })),
    renamed: list(summary.renamed).map((r) => ({
      email: email(r.email),
      from: name(r.from),
      to: name(r.to),
    })),
    deactivated: list(summary.deactivated).map((r) => ({
      ...r,
      email: email(r.email),
      name: name(r.name),
      permanentDesks: r.permanentDesks
        .slice(0, MAX_PERMANENT_DESKS)
        .map((code) => clip(code, MAX_DESK_CODE_LENGTH)),
      ownedHives: r.ownedHives
        .slice(0, MAX_OWNED_HIVES)
        .map((hive) => clip(hive, MAX_HIVE_NAME_LENGTH)),
    })),
    reactivated: list(summary.reactivated).map((r) => ({
      email: email(r.email),
      name: name(r.name),
    })),
    warnings: list(summary.warnings).map((warning) => clip(warning, MAX_WARNING_LENGTH)),
  };
}
