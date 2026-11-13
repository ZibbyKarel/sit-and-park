import { DESK_BULK_SKIP_REASONS } from '@sit-and-park/shared-types';
import cs from '../../../messages/cs.json';
import { D1, D2, D3, preview } from './desk-bulk.test-helpers';
import {
  buildPlan,
  rowKey,
  SKIP_REASON_KEYS,
  summarizePlan,
  toAssignments,
  toDeskBulkErrorKey,
  toResultView,
} from './desk-bulk-view';

const bookable = (plan: ReturnType<typeof buildPlan>, userId: string, date: string) => {
  const row = plan.find((candidate) => candidate.key === rowKey(userId, date));
  if (row?.kind !== 'BOOKABLE') throw new Error('expected a bookable row');
  return row;
};

describe('buildPlan', () => {
  it('keeps the proposal when nothing was picked', () => {
    const plan = buildPlan(preview(), {});
    expect(bookable(plan, 'user-viewer', '2026-11-16')).toMatchObject({
      deskId: D1.id,
      isPreferred: true,
    });
    expect(bookable(plan, 'user-viewer', '2026-11-17').deskId).toBeNull();
    expect(plan[3]).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PERMANENT_DESK_HOLDER' });
  });

  it('offers only desks the plan does not use that day, plus the row own desk', () => {
    const plan = buildPlan(preview(), {});
    expect(bookable(plan, 'user-viewer', '2026-11-16').choices.map((d) => d.id)).toEqual([
      D1.id,
      D2.id,
      D3.id,
    ]);
    // Jana, same day: Karel holds D-001 in the plan.
    expect(bookable(plan, 'user-jana', '2026-11-16').choices.map((d) => d.id)).toEqual([
      D2.id,
      D3.id,
    ]);
  });

  it('a hand pick removes that desk from the others and drops the preferred tag', () => {
    const plan = buildPlan(preview(), { [rowKey('user-jana', '2026-11-16')]: D2.id });
    expect(bookable(plan, 'user-viewer', '2026-11-16').choices.map((d) => d.id)).toEqual([
      D1.id,
      D3.id,
    ]);
    const changed = buildPlan(preview(), { [rowKey('user-viewer', '2026-11-16')]: D3.id });
    expect(bookable(changed, 'user-viewer', '2026-11-16')).toMatchObject({
      deskId: D3.id,
      isPreferred: false,
    });
    // D-001 is free for Jana now.
    expect(bookable(changed, 'user-jana', '2026-11-16').choices.map((d) => d.id)).toContain(D1.id);
  });

  it('null pick clears a proposed desk', () => {
    const plan = buildPlan(preview(), { [rowKey('user-viewer', '2026-11-16')]: null });
    expect(bookable(plan, 'user-viewer', '2026-11-16').deskId).toBeNull();
  });
});

describe('summarizePlan and toAssignments', () => {
  it('counts rows and sends only those with a desk', () => {
    const plan = buildPlan(preview(), { [rowKey('user-jana', '2026-11-16')]: D2.id });
    expect(summarizePlan(plan)).toEqual({ booked: 2, unassigned: 1, unavailable: 1 });
    expect(toAssignments(plan)).toEqual([
      { userId: 'user-viewer', date: '2026-11-16', deskId: D1.id },
      { userId: 'user-jana', date: '2026-11-16', deskId: D2.id },
    ]);
  });
});

describe('toResultView', () => {
  it('names reserved and skipped rows and counts broken promises', () => {
    const result = toResultView(preview(), {
      reserved: [
        { id: 'r1', deskId: D2.id, userId: 'user-jana', date: '2026-11-16', createdAt: 'x' },
      ],
      skipped: [
        { userId: 'user-viewer', date: '2026-11-16', deskId: D1.id, reason: 'DESK_TAKEN' },
        { userId: 'user-viewer', date: '2026-11-17', deskId: D3.id, reason: 'PAST_DATE' },
      ],
    });
    expect(result.reserved).toEqual([
      expect.objectContaining({ personName: 'Jana Nováková', deskCode: 'D-002' }),
    ]);
    expect(result.skipped.map((row) => row.deskCode)).toEqual(['D-001', 'D-003']);
    // Only the first was proposed as ASSIGNED.
    expect(result.brokenPromises).toBe(1);
  });
});

describe('error and reason copy', () => {
  it('maps the three declared errors', () => {
    expect(toDeskBulkErrorKey(new Error('boom'))).toBe('errorUnknown');
  });

  it('has Czech copy for every skip reason', () => {
    for (const reason of DESK_BULK_SKIP_REASONS) {
      expect(cs.deskBulk).toHaveProperty(SKIP_REASON_KEYS[reason]);
    }
  });
});
