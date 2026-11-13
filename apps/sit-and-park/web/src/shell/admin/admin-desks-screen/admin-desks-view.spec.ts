import { adminDesk } from './admin-desk.test-helpers';
import {
  ADMIN_DESK_TONES,
  bulkImpact,
  EMPTY_ADMIN_FILTER,
  holderName,
  matchesAdminFilter,
  patchImpact,
  pruneSelection,
  selectDesk,
  selectZone,
  toAdminShapes,
  toDeskPatch,
  toggleDesk,
} from './admin-desks-view';

const A = adminDesk({ id: 'a', code: 'A', zoneId: 'z1' });
const B = adminDesk({ id: 'b', code: 'B', zoneId: 'z1', hiveId: 'h1', hiveColor: '#336' });
const C = adminDesk({ id: 'c', code: 'C', zoneId: 'z2', active: false, status: 'INACTIVE' });

describe('selection', () => {
  it('a plain click selects only that desk, a second plain click clears it', () => {
    expect([...selectDesk(new Set(['a', 'b']), 'c', false)]).toEqual(['c']);
    expect([...selectDesk(new Set(['a']), 'a', false)]).toEqual([]);
    expect([...selectDesk(new Set(['a', 'b']), 'a', false)]).toEqual(['a']);
  });

  it('Ctrl/Cmd click toggles one desk and keeps the rest', () => {
    expect([...selectDesk(new Set(['a']), 'b', true)]).toEqual(['a', 'b']);
    expect([...selectDesk(new Set(['a', 'b']), 'a', true)]).toEqual(['b']);
    expect([...toggleDesk(new Set(), 'a')]).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const before = new Set(['a']);
    selectDesk(before, 'b', true);
    expect([...before]).toEqual(['a']);
  });

  it('selects a whole zone on top of what is selected', () => {
    expect([...selectZone(new Set(['c']), [A, B, C], 'z1')].sort()).toEqual(['a', 'b', 'c']);
  });

  it('prunes ids that are no longer listed, and keeps the same set when none drop', () => {
    const same = new Set(['a']);
    expect(pruneSelection(same, [A, B])).toBe(same);
    expect([...pruneSelection(new Set(['a', 'gone']), [A, B])]).toEqual(['a']);
  });
});

describe('filter and shapes', () => {
  it('matches by zone and hive, "" meaning any', () => {
    expect(matchesAdminFilter(A, EMPTY_ADMIN_FILTER)).toBe(true);
    expect(matchesAdminFilter(A, { zoneId: 'z2', hiveId: '' })).toBe(false);
    expect(matchesAdminFilter(B, { zoneId: 'z1', hiveId: 'h1' })).toBe(true);
    expect(matchesAdminFilter(A, { zoneId: '', hiveId: 'h1' })).toBe(false);
  });

  it('draws one shape per desk, toned by status, hive colour as outline, filtered ones dimmed', () => {
    const shapes = toAdminShapes([A, B, C], { zoneId: 'z1', hiveId: '' }, (d) => `aria ${d.code}`);

    expect(shapes.map((s) => [s.id, s.tone, s.outlineColor, s.dimmed])).toEqual([
      ['a', 'FREE', undefined, false],
      ['b', 'FREE', '#336', false],
      ['c', 'INACTIVE', undefined, true],
    ]);
    expect(shapes[0]?.ariaLabel).toBe('aria A');
    for (const status of ['FREE', 'RESERVED', 'ASSIGNED', 'INACTIVE'] as const) {
      expect(ADMIN_DESK_TONES[status]).toBeTruthy();
    }
  });

  it('names the permanent holder for an assigned desk and the reserver otherwise', () => {
    expect(holderName(adminDesk({ status: 'ASSIGNED', permanentAssigneeName: 'Eva' }))).toBe('Eva');
    expect(holderName(adminDesk({ status: 'RESERVED', reservedByName: 'Petr' }))).toBe('Petr');
    expect(holderName(A)).toBe('');
  });
});

describe('what a change sets off', () => {
  const draft = { active: true, hiveId: null, officeId: 'office-1', zoneId: 'z1' };

  it('patches only what differs', () => {
    expect(toDeskPatch(A, draft)).toEqual({});
    expect(toDeskPatch(A, { ...draft, active: false, hiveId: 'h1' })).toEqual({
      active: false,
      hiveId: 'h1',
    });
  });

  it('a zone move inside the office touches no booking', () => {
    expect(patchImpact({ zoneId: 'zone-b' })).toBeNull();
  });

  it('deactivating or moving cancels reservations and rejects requests; a hive change only rejects', () => {
    expect(patchImpact({ active: false })).toEqual({
      cancelsReservations: true,
      rejectsRequests: true,
    });
    expect(patchImpact({ officeId: 'o2', zoneId: 'z9' })).toEqual({
      cancelsReservations: true,
      rejectsRequests: true,
    });
    expect(patchImpact({ hiveId: null })).toEqual({
      cancelsReservations: false,
      rejectsRequests: true,
    });
    expect(patchImpact({ active: true })).toBeNull();
  });

  it('looks only at the desks a bulk change would really change', () => {
    expect(bulkImpact([C], { active: false })).toBeNull();
    expect(bulkImpact([A, C], { active: false })).toEqual({
      cancelsReservations: true,
      rejectsRequests: true,
    });
    expect(bulkImpact([C], { active: true })).toBeNull();
    expect(bulkImpact([B], { hiveId: 'h1' })).toBeNull();
    expect(bulkImpact([A], { hiveId: 'h1' })?.rejectsRequests).toBe(true);
    expect(bulkImpact([B], { hiveId: null })?.cancelsReservations).toBe(false);
  });
});
