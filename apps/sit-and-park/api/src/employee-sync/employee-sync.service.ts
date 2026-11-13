/**
 * The employee sync (`POST /api/employee-sync`) and its admin settings.
 *
 * {@link EmployeeSyncService.run} reads every user, lets the pure
 * `planEmployeeSync` decide, and — only in live mode — applies the plan. Every
 * call that got past the key check is logged as an `EmployeeSyncRun`, rejected
 * ones included; that table is the sync's log. The run itself writes no audit
 * row: `AuditLog.actorUserId` must be a user and the caller is a machine. Each
 * deactivation is audited (`USER_DEACTIVATED`), attributed to the deactivated
 * user.
 *
 * A step that fails for one user (an update, a create, a deactivation) becomes
 * a warning and an `error` log; the run goes on and is still logged. Users who
 * are inactive but still hold future bookings, queue places or pending
 * requests (an earlier clean-up failed half-way, or an admin deactivated them
 * before it existed) are swept on every live run, so a failure heals itself.
 *
 * New employees are **pre-created** with a placeholder `oktaId`
 * (`hibob:<id>`): sign-in matches by `oktaId`, then by e-mail, and rebinds the
 * row it found to the token's subject (`AuthUserService.linkOrCreate`), so the
 * first login adopts the row. Until then the account holds an office and a
 * HiBob id, and nobody can sign in as it.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type {
  AdminEmployeeSyncOutput,
  EmployeeSyncCounts,
  EmployeeSyncResponse,
  EmployeeSyncRun,
  EmployeeSyncSettings,
  EmployeeSyncSummary,
} from '@sit-and-park/contract';
import { employeeSyncRequestSchema, employeeSyncSummarySchema } from '@sit-and-park/contract';
import type { EmployeeSyncRun as EmployeeSyncRunRow } from '@sit-and-park/database';
import { EMPLOYEE_SYNC_SETTINGS_ID } from '@sit-and-park/database';
import type { DateOnly, EmployeeSyncMode } from '@sit-and-park/shared-types';
import { EMPLOYEE_SYNC_RUN_HISTORY, todayInPrague } from '@sit-and-park/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { generateIcsToken } from '../auth/auth-user.service';
import { isUniqueConstraintViolation } from '../common/errors/prisma-error-mapping';
import { defaultOfficeId } from '../common/office-scope';
import { toDateColumn } from '../common/prisma-mapping';
import { PrismaService } from '../database/prisma.service';
import type { ApiEnv } from '../env';
import type { EmployeeSyncPlan } from './employee-sync-plan';
import { EMPLOYEE_DOMAIN, fitSummary, planEmployeeSync } from './employee-sync-plan';
import { UserDeactivationService } from './user-deactivation.service';

/** `oktaId` of a pre-created account until its first sign-in rebinds it. */
export function placeholderOktaId(hibobId: string): string {
  return `hibob:${hibobId}`;
}

const DEFAULT_SOURCE = 'keboola';
const MAX_REASON_LENGTH = 2000;

export interface EmployeeSyncResult {
  status: 200 | 400 | 422;
  body: EmployeeSyncResponse;
}

type OkPlan = Extract<EmployeeSyncPlan, { status: 'OK' }>;

function emptySummary(received: number, activeBefore: number): EmployeeSyncSummary {
  return {
    received,
    activeBefore,
    created: [],
    renamed: [],
    deactivated: [],
    reactivated: [],
    linked: 0,
    unchanged: 0,
    warnings: [],
  };
}

@Injectable()
export class EmployeeSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deactivation: UserDeactivationService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService<ApiEnv, true>,
    @InjectPinoLogger(EmployeeSyncService.name) private readonly logger: PinoLogger
  ) {}

  /** The configured key hash, or `undefined` when the sync is switched off. */
  keyHash(): string | undefined {
    return this.config.get('EMPLOYEE_SYNC_KEY_SHA256', { infer: true });
  }

  /** One authenticated call. `body` is the parsed JSON, not yet validated. */
  async run(body: unknown, today: DateOnly = todayInPrague()): Promise<EmployeeSyncResult> {
    const { liveMode } = await this.getSettings();
    const mode: EmployeeSyncMode = liveMode ? 'LIVE' : 'DRY';

    const parsed = employeeSyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined ? '' : `${issue.path.join('.') || '(root)'}: `;
      const detail = `${where}${issue?.message ?? 'invalid'}`;
      const reason = `INVALID_PAYLOAD: Expected { source?, employees: [{ id, email, name }] }; ${detail}`;
      const run = await this.log(DEFAULT_SOURCE, mode, reason, emptySummary(0, 0));
      return { status: 400, body: response(run, countsOf(emptySummary(0, 0))) };
    }

    const users = await this.prisma.client.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        hibobId: true,
        active: true,
        manualAccount: true,
        role: true,
      },
    });
    const bySync = await this.deactivatedBySync(users.filter((u) => !u.active).map((u) => u.id));
    const profiles = users.map((user) => ({ ...user, deactivatedBySync: bySync.has(user.id) }));
    const plan = planEmployeeSync(parsed.data.employees, profiles);

    if (plan.status === 'REJECTED') {
      const summary = emptySummary(plan.received, plan.activeBefore);
      const run = await this.log(parsed.data.source, mode, plan.reason, summary);
      return { status: 422, body: response(run, countsOf(summary)) };
    }

    const full = await this.execute(plan, liveMode, today);
    const run = await this.log(parsed.data.source, mode, null, fitSummary(full));
    return { status: 200, body: response(run, countsOf(full)) };
  }

  /**
   * Which of `userIds` were last deactivated by the sync: the latest
   * `USER_DEACTIVATED` row per user, in one query.
   */
  private async deactivatedBySync(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.client.auditLog.findMany({
      where: { action: 'USER_DEACTIVATED', entityType: 'User', entityId: { in: userIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['entityId'],
      select: { entityId: true, payload: true },
    });
    return new Set(
      rows
        .filter((row) => (row.payload as { source?: unknown } | null)?.source === 'EMPLOYEE_SYNC')
        .map((row) => row.entityId)
    );
  }

  /**
   * Runs one user's step; a failure becomes a warning and an `error` log, so
   * one user cannot abort the run or keep it out of the run log.
   */
  private async perUser<T>(
    summary: EmployeeSyncSummary,
    user: { id?: string; email: string },
    step: string,
    work: () => Promise<T>
  ): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      this.logger.error({ err: error, userId: user.id, step }, 'Employee sync step failed');
      summary.warnings.push(
        `${user.email}: ${step} failed; see the API log. The next run retries.`
      );
      return undefined;
    }
  }

  /** Applies `plan` when `live`; either way returns the uncapped summary. */
  private async execute(
    plan: OkPlan,
    live: boolean,
    today: DateOnly
  ): Promise<EmployeeSyncSummary> {
    const summary = emptySummary(plan.received, plan.activeBefore);
    summary.unchanged = plan.unchanged;
    summary.warnings.push(...plan.warnings);

    for (const change of plan.update) {
      if (change.linkHibobId !== undefined) {
        summary.linked += 1;
      }
      if (change.rename !== undefined) {
        summary.renamed.push({ email: change.email, ...change.rename });
      }
      if (change.reactivate) {
        summary.reactivated.push({ email: change.email, name: change.rename?.to ?? change.name });
      }
      if (live) {
        await this.perUser(summary, { id: change.userId, email: change.email }, 'update', () =>
          this.prisma.client.user.update({
            where: { id: change.userId },
            data: {
              ...(change.linkHibobId === undefined ? {} : { hibobId: change.linkHibobId }),
              ...(change.rename === undefined ? {} : { name: change.rename.to }),
              ...(change.reactivate ? { active: true, deactivatedAt: null } : {}),
            },
          })
        );
      }
    }

    const officeId = plan.create.length > 0 ? await defaultOfficeId(this.prisma.client) : null;
    if (plan.create.length > 0 && officeId === null) {
      summary.warnings.push('No office is active; new employees are created without an office.');
    }
    for (const row of plan.create) {
      if (live) {
        const created = await this.perUser(summary, row, 'create', async () => {
          try {
            await this.prisma.client.user.create({
              data: {
                oktaId: placeholderOktaId(row.hibobId),
                email: row.email,
                name: row.name,
                hibobId: row.hibobId,
                icsToken: generateIcsToken(),
                officeId,
              },
            });
            return true;
          } catch (error) {
            if (!isUniqueConstraintViolation(error)) {
              throw error;
            }
            // Signed in (and was provisioned) since the users were read.
            summary.warnings.push(
              `${row.email}: the account appeared during the sync; it is linked on the next run.`
            );
            return false;
          }
        });
        if (created !== true) {
          continue;
        }
      }
      summary.created.push({ email: row.email, name: row.name });
    }

    for (const profile of plan.deactivate) {
      const report = await this.perUser(summary, profile, 'deactivation', async () => {
        if (!live) {
          return this.deactivation.inspect(profile.id, today);
        }
        const outcome = await this.deactivation.deactivate(
          profile.id,
          'EMPLOYEE_SYNC',
          profile.id,
          today
        );
        this.warnFailedCancels(summary, profile.email, outcome.failedParkingReservations);
        return outcome.report;
      });
      if (report === undefined) {
        continue;
      }
      summary.deactivated.push({ email: profile.email, name: profile.name, ...report });
      if (report.ownedHives.length > 0) {
        summary.warnings.push(
          `${profile.email} owns hive ${report.ownedHives.join(', ')}; nobody can decide its requests, change the owner.`
        );
      }
      if (report.permanentDesks.length > 0) {
        summary.warnings.push(
          `${profile.email} holds permanent desk ${report.permanentDesks.join(', ')}; the assignment stays, free it by hand.`
        );
      }
    }

    if (live) {
      await this.sweepLeftovers(summary, new Set(plan.deactivate.map((p) => p.id)), today);
    }
    return summary;
  }

  private warnFailedCancels(summary: EmployeeSyncSummary, email: string, failed: number): void {
    if (failed > 0) {
      summary.warnings.push(
        `${email}: ${failed} future parking reservation(s) could not be cancelled; the next run retries.`
      );
    }
  }

  /**
   * Finishes the clean-up of synced users who are already inactive but still
   * hold something in the future. `deactivate` on an inactive user audits
   * nothing new, so who deactivated them stays on record.
   */
  private async sweepLeftovers(
    summary: EmployeeSyncSummary,
    handled: ReadonlySet<string>,
    today: DateOnly
  ): Promise<void> {
    const fromToday = { gte: toDateColumn(today) };
    const leftovers = await this.prisma.client.user.findMany({
      where: {
        active: false,
        manualAccount: false,
        email: { endsWith: EMPLOYEE_DOMAIN, mode: 'insensitive' },
        id: { notIn: [...handled] },
        OR: [
          { reservations: { some: { date: fromToday } } },
          { deskReservations: { some: { date: fromToday } } },
          { waitlistEntries: { some: { date: fromToday } } },
          { deskApprovalRequests: { some: { status: 'PENDING' } } },
        ],
      },
      select: { id: true, email: true },
    });
    for (const user of leftovers) {
      const outcome = await this.perUser(summary, user, 'clean-up of an earlier deactivation', () =>
        this.deactivation.deactivate(user.id, 'EMPLOYEE_SYNC', user.id, today)
      );
      if (outcome === undefined) {
        continue;
      }
      const { report } = outcome;
      summary.warnings.push(
        `${user.email}: finished the clean-up of an earlier deactivation (freed ${report.freedDeskReservations} desk and ${report.freedParkingReservations} parking reservation(s), ${report.removedWaitlistEntries} queue place(s), ${report.rejectedRequests} request(s)).`
      );
      this.warnFailedCancels(summary, user.email, outcome.failedParkingReservations);
    }
  }

  private async log(
    source: string,
    mode: EmployeeSyncMode,
    reason: string | null,
    summary: EmployeeSyncSummary
  ): Promise<EmployeeSyncRunRow> {
    // `fitSummary` makes this pass; if it ever does not, the live writes have
    // already happened, so the run is still logged, with a placeholder summary.
    const parsed = employeeSyncSummarySchema.safeParse(summary);
    if (!parsed.success) {
      this.logger.error({ err: parsed.error }, 'Employee sync summary does not fit its schema');
    }
    return this.prisma.client.employeeSyncRun.create({
      data: {
        source,
        mode,
        status: reason === null ? 'OK' : 'REJECTED',
        reason: reason?.slice(0, MAX_REASON_LENGTH) ?? null,
        summary: parsed.success
          ? parsed.data
          : {
              ...emptySummary(summary.received, summary.activeBefore),
              warnings: ['The run summary did not fit its schema; see the API log.'],
            },
      },
    });
  }

  async getSettings(): Promise<EmployeeSyncSettings> {
    const row = await this.prisma.client.employeeSyncSettings.findUnique({
      where: { id: EMPLOYEE_SYNC_SETTINGS_ID },
    });
    return { liveMode: row?.liveMode ?? false };
  }

  async adminGet(): Promise<AdminEmployeeSyncOutput> {
    const [settings, runs] = await Promise.all([
      this.getSettings(),
      this.prisma.client.employeeSyncRun.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EMPLOYEE_SYNC_RUN_HISTORY,
      }),
    ]);
    return { ...settings, configured: this.keyHash() !== undefined, runs: runs.map(toContractRun) };
  }

  async setLiveMode(
    input: EmployeeSyncSettings,
    actorUserId: string
  ): Promise<EmployeeSyncSettings> {
    const before = await this.getSettings();
    const row = await this.prisma.client.employeeSyncSettings.upsert({
      where: { id: EMPLOYEE_SYNC_SETTINGS_ID },
      create: { id: EMPLOYEE_SYNC_SETTINGS_ID, liveMode: input.liveMode },
      update: { liveMode: input.liveMode },
    });
    await this.audit.record({
      actorUserId,
      action: 'EMPLOYEE_SYNC_SETTINGS_UPDATED',
      entityType: 'EmployeeSyncSettings',
      entityId: String(EMPLOYEE_SYNC_SETTINGS_ID),
      payload: { before, after: { liveMode: row.liveMode } },
    });
    return { liveMode: row.liveMode };
  }
}

function response(run: EmployeeSyncRunRow, counts: EmployeeSyncCounts): EmployeeSyncResponse {
  return { ok: run.status === 'OK', mode: run.mode, reason: run.reason, runId: run.id, counts };
}

/** Totals of an **uncapped** summary. */
function countsOf(summary: EmployeeSyncSummary): EmployeeSyncCounts {
  return {
    received: summary.received,
    activeBefore: summary.activeBefore,
    created: summary.created.length,
    renamed: summary.renamed.length,
    deactivated: summary.deactivated.length,
    reactivated: summary.reactivated.length,
    linked: summary.linked,
    unchanged: summary.unchanged,
    warnings: summary.warnings.length,
  };
}

function toContractRun(row: EmployeeSyncRunRow): EmployeeSyncRun {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    mode: row.mode,
    status: row.status,
    reason: row.reason,
    summary: employeeSyncSummarySchema.parse(row.summary),
  };
}
