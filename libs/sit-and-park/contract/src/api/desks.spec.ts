import { addDays } from '@sit-and-park/shared-types';
import { DATE_A, NOT_A_UUID, TIMESTAMP, UUID_A, UUID_B, UUID_C } from '../__fixtures__/fixtures';
import {
  deskSchema,
  employeeSyncRunSchema,
  employeeSyncSummarySchema,
  hiveSchema,
  officeSchema,
  zoneSchema,
} from '../schemas/entities';
import {
  adminBulkUpdateDesksInputSchema,
  adminDeskStatsOutputSchema,
  adminDeskStatusSchema,
  adminSetDeskGrantInputSchema,
  adminUpdateDeskInputSchema,
} from './admin-desks';
import { deskSeriesInputSchema, myDeskReleasesOutputSchema, releaseDeskInputSchema } from './desks';
import { adminEmployeeSyncOutputSchema } from './employee-sync';
import { adminCreateHiveInputSchema } from './hives';
import { adminCreateZoneInputSchema } from './offices';

const days = (count: number, from = DATE_A) =>
  Array.from({ length: count }, (_, index) => addDays(from, index));

describe('desk series input', () => {
  it('accepts 1 to 20 distinct dates in any order', () => {
    expect(deskSeriesInputSchema.safeParse({ deskId: UUID_A, dates: [DATE_A] }).success).toBe(true);
    expect(
      deskSeriesInputSchema.safeParse({ deskId: UUID_A, dates: days(20).reverse() }).success
    ).toBe(true);
  });

  it.each([
    ['no date', []],
    ['21 dates', days(21)],
    ['a duplicate', [DATE_A, DATE_A]],
  ])('rejects %s', (_case, dates) => {
    expect(deskSeriesInputSchema.safeParse({ deskId: UUID_A, dates }).success).toBe(false);
  });

  it('allows the last date 34 days after the first, not 35', () => {
    const ok = [addDays(DATE_A, 34), DATE_A];
    const tooFar = [addDays(DATE_A, 35), DATE_A];
    expect(deskSeriesInputSchema.safeParse({ deskId: UUID_A, dates: ok }).success).toBe(true);
    expect(deskSeriesInputSchema.safeParse({ deskId: UUID_A, dates: tooFar }).success).toBe(false);
  });
});

describe('desk releases', () => {
  it('accepts 1 to 60 distinct dates', () => {
    expect(releaseDeskInputSchema.safeParse({ dates: days(60) }).success).toBe(true);
    expect(releaseDeskInputSchema.safeParse({ dates: days(61) }).success).toBe(false);
    expect(releaseDeskInputSchema.safeParse({ dates: [] }).success).toBe(false);
    expect(releaseDeskInputSchema.safeParse({ dates: [DATE_A, DATE_A] }).success).toBe(false);
  });

  it('answers null for a caller without a permanent desk', () => {
    expect(myDeskReleasesOutputSchema.parse(null)).toBeNull();
  });
});

describe('admin desk edits', () => {
  it('distinguishes "unchanged" (absent) from "no hive" (null)', () => {
    expect(adminUpdateDeskInputSchema.parse({ deskId: UUID_A })).toEqual({ deskId: UUID_A });
    expect(adminUpdateDeskInputSchema.parse({ deskId: UUID_A, hiveId: null })).toEqual({
      deskId: UUID_A,
      hiveId: null,
    });
  });

  it('bounds a bulk edit to 1..500 distinct desks and at least one change', () => {
    const ids = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      );
    expect(
      adminBulkUpdateDesksInputSchema.safeParse({ deskIds: ids(500), active: false }).success
    ).toBe(true);
    expect(
      adminBulkUpdateDesksInputSchema.safeParse({ deskIds: ids(501), active: false }).success
    ).toBe(false);
    expect(adminBulkUpdateDesksInputSchema.safeParse({ deskIds: [], active: false }).success).toBe(
      false
    );
    expect(
      adminBulkUpdateDesksInputSchema.safeParse({ deskIds: [UUID_A, UUID_A], active: false })
        .success
    ).toBe(false);
    expect(adminBulkUpdateDesksInputSchema.safeParse({ deskIds: [UUID_A] }).success).toBe(false);
    expect(
      adminBulkUpdateDesksInputSchema.safeParse({ deskIds: [UUID_A], hiveId: null }).success
    ).toBe(true);
    expect(
      adminSetDeskGrantInputSchema.safeParse({ deskIds: ids(501), userId: UUID_B, granted: true })
        .success
    ).toBe(false);
  });

  it('never reports the viewer-relative status to an admin', () => {
    expect(adminDeskStatusSchema.safeParse('RESERVED_BY_ME').success).toBe(false);
    expect(adminDeskStatusSchema.safeParse('RESERVED').success).toBe(true);
  });

  it('caps occupancy at 100 %', () => {
    const stats = {
      date: DATE_A,
      totalDesks: 1,
      activeDesks: 1,
      inactiveDesks: 0,
      permanentAssignments: 0,
      bookableOnDate: 1,
      reservedOnDate: 1,
      freeOnDate: 0,
      occupancyPercent: 100,
      hiveCount: 0,
      pendingApprovals: 0,
      byZone: [],
      byOffice: [],
    };
    expect(adminDeskStatsOutputSchema.safeParse(stats).success).toBe(true);
    expect(adminDeskStatsOutputSchema.safeParse({ ...stats, occupancyPercent: 101 }).success).toBe(
      false
    );
  });
});

describe('desk entities', () => {
  const desk = {
    id: UUID_A,
    officeId: UUID_B,
    zoneId: UUID_C,
    code: 'D-001',
    active: true,
    hiveId: null,
    permanentAssigneeId: null,
    x: 10,
    y: 20,
    width: 300,
    height: 150,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };

  it('accepts a desk and rejects a zero-sized one', () => {
    expect(deskSchema.safeParse(desk).success).toBe(true);
    expect(deskSchema.safeParse({ ...desk, width: 0 }).success).toBe(false);
  });

  it('knows only the bundled floor plans', () => {
    const office = {
      id: UUID_A,
      name: 'Praha',
      active: true,
      floorPlan: 'praha',
      floorPlanWidth: 22473,
      floorPlanHeight: 5835,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };
    expect(officeSchema.safeParse(office).success).toBe(true);
    expect(officeSchema.safeParse({ ...office, floorPlan: null }).success).toBe(true);
    expect(officeSchema.safeParse({ ...office, floorPlan: 'brno' }).success).toBe(false);
  });

  it.each(['#2563EB', '#abcdef'])('accepts the colour %s', (color) => {
    expect(
      adminCreateHiveInputSchema.safeParse({ name: 'Data', color, ownerId: UUID_A }).success
    ).toBe(true);
  });

  it.each(['2563EB', '#2563E', '#GGGGGG', 'red'])('rejects the colour %s', (color) => {
    expect(hiveSchema.shape.color.safeParse(color).success).toBe(false);
  });

  it('bounds names to 1..100 characters', () => {
    expect(hiveSchema.shape.name.safeParse('x'.repeat(100)).success).toBe(true);
    expect(hiveSchema.shape.name.safeParse('x'.repeat(101)).success).toBe(false);
    expect(hiveSchema.shape.name.safeParse('   ').success).toBe(false);
  });

  it.each([
    ['engineering1', true],
    ['finance_ops', true],
    ['Finance', false],
    ['a-b', false],
    ['', false],
    ['x'.repeat(41), false],
  ])('zone key %p valid: %p', (key, valid) => {
    expect(adminCreateZoneInputSchema.safeParse({ officeId: UUID_A, key, name: 'Z' }).success).toBe(
      valid
    );
    expect(zoneSchema.shape.key.safeParse(key).success).toBe(valid);
  });

  it('rejects a non-uuid office on a zone', () => {
    expect(
      adminCreateZoneInputSchema.safeParse({ officeId: NOT_A_UUID, key: 'data', name: 'Data' })
        .success
    ).toBe(false);
  });
});

describe('employee sync', () => {
  const summary = {
    received: 2,
    activeBefore: 2,
    created: [],
    renamed: [{ email: 'a@team.blue', from: 'A', to: 'B' }],
    deactivated: [
      {
        email: 'c@team.blue',
        name: 'C',
        freedDeskReservations: 1,
        freedParkingReservations: 0,
        removedWaitlistEntries: 0,
        rejectedRequests: 0,
        permanentDesks: ['D-001'],
        ownedHives: [],
      },
    ],
    reactivated: [],
    linked: 0,
    unchanged: 1,
    warnings: [],
  };

  it('accepts a summary and rejects an unknown key, so a writer cannot drift', () => {
    expect(employeeSyncSummarySchema.safeParse(summary).success).toBe(true);
    expect(employeeSyncSummarySchema.safeParse({ ...summary, extra: 1 }).success).toBe(false);
    expect(
      employeeSyncSummarySchema.safeParse({
        ...summary,
        deactivated: [{ ...summary.deactivated[0], freedDeskBookings: 1 }],
      }).success
    ).toBe(false);
  });

  it('caps each list at 500 entries', () => {
    const warnings = Array.from({ length: 501 }, () => 'w');
    expect(employeeSyncSummarySchema.safeParse({ ...summary, warnings }).success).toBe(false);
  });

  it('shows at most 12 runs', () => {
    const run = {
      id: UUID_A,
      createdAt: TIMESTAMP,
      source: 'keboola',
      mode: 'DRY',
      status: 'OK',
      reason: null,
      summary,
    };
    expect(employeeSyncRunSchema.safeParse(run).success).toBe(true);
    const answer = (count: number) => ({
      liveMode: false,
      configured: true,
      runs: Array.from({ length: count }, () => run),
    });
    expect(adminEmployeeSyncOutputSchema.safeParse(answer(12)).success).toBe(true);
    expect(adminEmployeeSyncOutputSchema.safeParse(answer(13)).success).toBe(false);
  });
});
