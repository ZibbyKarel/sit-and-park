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
 * New employees are **pre-created** with a placeholder `oktaId`
 * (`hibob:<id>`): sign-in matches by `oktaId`, then by e-mail, and rebinds the
 * row it found to the token's subject (`AuthUserService.linkOrCreate`), so the
 * first login adopts the row. Until then the account holds an office and a
 * HiBob id, and nobody can sign in as it.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdminEmployeeSyncOutput,
  EmployeeSyncCounts,
  EmployeeSyncResponse,
  EmployeeSyncRun,
  EmployeeSyncSettings,
  EmployeeSyncSummary,
} from '@garage/contract';
import { employeeSyncRequestSchema, employeeSyncSummarySchema } from '@garage/contract';
import type { EmployeeSyncRun as EmployeeSyncRunRow } from '@garage/database';
import { EMPLOYEE_SYNC_SETTINGS_ID } from '@garage/database';
import type { DateOnly, EmployeeSyncMode } from '@garage/shared-types';
import {
  EMPLOYEE_SYNC_RUN_HISTORY,
  EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT,
  todayInPrague,
} from '@garage/shared-types';
import { AuditLogService } from '../audit/audit-log.service';
import { generateIcsToken } from '../auth/auth-user.service';
import { isUniqueConstraintViolation } from '../common/errors/prisma-error-mapping';
import { PrismaService } from '../database/prisma.service';
import type { ApiEnv } from '../env';
import type { EmployeeSyncPlan } from './employee-sync-plan';
import { planEmployeeSync } from './employee-sync-plan';
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

function cap<T>(list: readonly T[]): T[] {
  return list.slice(0, EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT);
}

@Injectable()
export class EmployeeSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deactivation: UserDeactivationService,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService<ApiEnv, true>
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

    const profiles = await this.prisma.client.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        hibobId: true,
        active: true,
        manualAccount: true,
      },
    });
    const plan = planEmployeeSync(parsed.data.employees, profiles);

    if (plan.status === 'REJECTED') {
      const summary = emptySummary(plan.received, plan.activeBefore);
      const run = await this.log(parsed.data.source, mode, plan.reason, summary);
      return { status: 422, body: response(run, countsOf(summary)) };
    }

    const full = await this.execute(plan, liveMode, today);
    const summary: EmployeeSyncSummary = {
      ...full,
      created: cap(full.created),
      renamed: cap(full.renamed),
      deactivated: cap(full.deactivated),
      reactivated: cap(full.reactivated),
      warnings: cap(full.warnings),
    };
    const run = await this.log(parsed.data.source, mode, null, summary);
    return { status: 200, body: response(run, countsOf(full)) };
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
        await this.prisma.client.user.update({
          where: { id: change.userId },
          data: {
            ...(change.linkHibobId === undefined ? {} : { hibobId: change.linkHibobId }),
            ...(change.rename === undefined ? {} : { name: change.rename.to }),
            ...(change.reactivate ? { active: true, deactivatedAt: null } : {}),
          },
        });
      }
    }

    const officeId = live && plan.create.length > 0 ? await this.defaultOfficeId() : null;
    for (const row of plan.create) {
      if (live) {
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
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) {
            throw error;
          }
          // Signed in (and was provisioned) since the users were read.
          summary.warnings.push(
            `${row.email}: the account appeared during the sync; it is linked on the next run.`
          );
          continue;
        }
      }
      summary.created.push({ email: row.email, name: row.name });
    }

    for (const profile of plan.deactivate) {
      const report = live
        ? await this.deactivation.deactivate(profile.id, 'EMPLOYEE_SYNC', profile.id, today)
        : await this.deactivation.inspect(profile.id, today);
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
    return summary;
  }

  /** The office a pre-created employee starts in: the oldest active one. */
  private async defaultOfficeId(): Promise<string | null> {
    const office = await this.prisma.client.office.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return office?.id ?? null;
  }

  private async log(
    source: string,
    mode: EmployeeSyncMode,
    reason: string | null,
    summary: EmployeeSyncSummary
  ): Promise<EmployeeSyncRunRow> {
    return this.prisma.client.employeeSyncRun.create({
      data: {
        source,
        mode,
        status: reason === null ? 'OK' : 'REJECTED',
        reason: reason?.slice(0, MAX_REASON_LENGTH) ?? null,
        // Strict: a summary that does not fit the contract fails here, loudly,
        // rather than later in the admin screen.
        summary: employeeSyncSummarySchema.parse(summary),
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
