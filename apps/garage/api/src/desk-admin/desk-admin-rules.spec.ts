import { computeDeskStats, deskChangeEffects, percent } from './desk-admin-rules';
import type { StatsDesk, StatsInput } from './desk-admin-rules';

describe('deskChangeEffects', () => {
  const desk = { active: true, hiveId: 'hive-a', officeId: 'office-a' };

  it('changes nothing for an unchanged desk or a reactivation', () => {
    const none = { cancelReservations: null, rejectRequests: null };

    expect(deskChangeEffects(desk, desk)).toEqual(none);
    expect(deskChangeEffects({ ...desk, active: false }, desk)).toEqual(none);
  });

  it('cancels reservations and rejects requests when the desk is deactivated', () => {
    expect(deskChangeEffects(desk, { ...desk, active: false })).toEqual({
      cancelReservations: 'DESK_DEACTIVATED',
      rejectRequests: 'DESK_DEACTIVATED',
    });
  });

  it('cancels reservations and rejects requests when the desk moves office', () => {
    expect(deskChangeEffects(desk, { ...desk, officeId: 'office-b' })).toEqual({
      cancelReservations: 'DESK_OFFICE_CHANGED',
      rejectRequests: 'DESK_OFFICE_CHANGED',
    });
  });

  it('only rejects requests when the hive changes or is cleared', () => {
    const effects = { cancelReservations: null, rejectRequests: 'DESK_HIVE_CHANGED' };

    expect(deskChangeEffects(desk, { ...desk, hiveId: 'hive-b' })).toEqual(effects);
    expect(deskChangeEffects(desk, { ...desk, hiveId: null })).toEqual(effects);
    expect(deskChangeEffects({ ...desk, hiveId: null }, desk)).toEqual(effects);
  });

  it('names the most drastic change when several happen at once', () => {
    expect(
      deskChangeEffects(desk, { active: false, hiveId: null, officeId: 'office-b' })
    ).toMatchObject({ cancelReservations: 'DESK_DEACTIVATED' });
    expect(deskChangeEffects(desk, { ...desk, hiveId: null, officeId: 'office-b' })).toMatchObject({
      rejectRequests: 'DESK_OFFICE_CHANGED',
    });
  });
});

describe('percent', () => {
  it('rounds, is 0 for an empty whole and never leaves 0–100', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBe(0);
    expect(percent(5, 4)).toBe(100);
  });
});

describe('computeDeskStats', () => {
  function desk(id: string, overrides: Partial<StatsDesk> = {}): StatsDesk {
    return {
      id,
      officeId: 'office-a',
      zoneId: 'zone-1',
      active: true,
      permanentAssigneeId: null,
      ...overrides,
    };
  }

  function input(overrides: Partial<StatsInput>): StatsInput {
    return {
      date: '2026-10-05',
      desks: [],
      reservedDeskIds: new Set(),
      releasedDeskIds: new Set(),
      zones: new Map([
        ['zone-1', { name: 'North', officeId: 'office-a' }],
        ['zone-2', { name: 'South', officeId: 'office-a' }],
        ['zone-3', { name: 'Brno', officeId: 'office-b' }],
      ]),
      offices: new Map([
        ['office-a', 'Praha'],
        ['office-b', 'Brno'],
      ]),
      hiveCount: 2,
      pendingApprovals: 3,
      ...overrides,
    };
  }

  it('is all zeros, and 0 %, with no desk', () => {
    expect(computeDeskStats(input({}))).toMatchObject({
      totalDesks: 0,
      bookableOnDate: 0,
      reservedOnDate: 0,
      occupancyPercent: 0,
      byZone: [],
      byOffice: [],
    });
  });

  it('counts only reservations of bookable desks, so occupancy stays within 100 %', () => {
    const stats = computeDeskStats(
      input({
        desks: [
          desk('free'),
          desk('reserved'),
          desk('inactive', { active: false }),
          desk('held', { permanentAssigneeId: 'u1' }),
          desk('released', { permanentAssigneeId: 'u2' }),
        ],
        // The inactive and the held desk carry a reservation too (made before
        // the change); neither is occupancy of a bookable desk.
        reservedDeskIds: new Set(['reserved', 'inactive', 'held', 'released']),
        releasedDeskIds: new Set(['released']),
      })
    );

    expect(stats).toMatchObject({
      totalDesks: 5,
      activeDesks: 4,
      inactiveDesks: 1,
      permanentAssignments: 2,
      bookableOnDate: 3,
      reservedOnDate: 2,
      freeOnDate: 1,
      occupancyPercent: 67,
      hiveCount: 2,
      pendingApprovals: 3,
    });
  });

  it('is 100 % and no more when every bookable desk is reserved', () => {
    const stats = computeDeskStats(
      input({
        desks: [desk('a'), desk('b', { active: false })],
        reservedDeskIds: new Set(['a', 'b']),
      })
    );

    expect(stats.occupancyPercent).toBe(100);
    expect(stats.reservedOnDate).toBe(1);
  });

  it('splits per zone and per office, largest first', () => {
    const stats = computeDeskStats(
      input({
        desks: [
          desk('n1'),
          desk('s1', { zoneId: 'zone-2' }),
          desk('s2', { zoneId: 'zone-2', active: false }),
          desk('s3', { zoneId: 'zone-2' }),
          desk('b1', { zoneId: 'zone-3', officeId: 'office-b' }),
        ],
        reservedDeskIds: new Set(['s1', 'b1']),
      })
    );

    expect(stats.byZone).toEqual([
      {
        zoneId: 'zone-2',
        zoneName: 'South',
        officeId: 'office-a',
        desks: 3,
        free: 1,
        reserved: 1,
        unavailable: 1,
      },
      {
        zoneId: 'zone-3',
        zoneName: 'Brno',
        officeId: 'office-b',
        desks: 1,
        free: 0,
        reserved: 1,
        unavailable: 0,
      },
      {
        zoneId: 'zone-1',
        zoneName: 'North',
        officeId: 'office-a',
        desks: 1,
        free: 1,
        reserved: 0,
        unavailable: 0,
      },
    ]);
    expect(stats.byOffice).toEqual([
      { officeId: 'office-a', officeName: 'Praha', desks: 4, reservedOnDate: 1 },
      { officeId: 'office-b', officeName: 'Brno', desks: 1, reservedOnDate: 1 },
    ]);
  });
});
