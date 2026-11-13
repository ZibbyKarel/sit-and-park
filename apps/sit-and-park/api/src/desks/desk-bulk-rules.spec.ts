import type { BulkDesk, BulkFacts, BulkPerson } from './desk-bulk-rules';
import { allocateBulk, allocationOrder, bulkRowVerdict, dayKey } from './desk-bulk-rules';

const OFFICE = 'office-a';
const TODAY = '2099-01-05';
const D1 = '2099-01-05';
const D2 = '2099-01-06';
const D3 = '2099-01-07';

function person(id: string, overrides: Partial<BulkPerson> = {}): BulkPerson {
  return {
    id,
    name: id,
    active: true,
    officeId: OFFICE,
    isAdmin: false,
    hiveId: null,
    grantedDeskIds: new Set(),
    permanentDeskId: null,
    preferredDeskId: null,
    ...overrides,
  };
}

/** Desks on a line, 10 units apart, zone `z1` unless told otherwise. */
function desk(code: string, x: number, overrides: Partial<BulkDesk> = {}): BulkDesk {
  return {
    id: code,
    code,
    officeId: OFFICE,
    zoneId: 'z1',
    zoneName: 'Zone 1',
    hiveId: null,
    active: true,
    permanentAssigneeId: null,
    x,
    y: 0,
    width: 4,
    height: 4,
    ...overrides,
  };
}

function facts(
  taken: [string, string, string][] = [],
  released: [string, string][] = []
): BulkFacts {
  return {
    holderByDeskDay: new Map(taken.map(([deskId, date, userId]) => [dayKey(deskId, date), userId])),
    deskByPersonDay: new Map(taken.map(([deskId, date, userId]) => [dayKey(userId, date), deskId])),
    releasedDeskDays: new Set(released.map(([deskId, date]) => dayKey(deskId, date))),
  };
}

const DESKS = [desk('A', 0), desk('B', 10), desk('C', 20), desk('Z', 15, { zoneId: 'z2' })];

function assigned(rows: ReturnType<typeof allocateBulk>) {
  return rows.map((row) =>
    row.outcome === 'ASSIGNED'
      ? `${row.userId} ${row.date} ${row.deskId}${row.isPreferred ? '*' : ''}`
      : `${row.userId} ${row.date} ${row.outcome === 'UNAVAILABLE' ? row.reason : row.outcome}`
  );
}

describe('allocationOrder', () => {
  it('puts people with a preferred desk first, stable within each group', () => {
    const people = [
      person('p1'),
      person('p2', { preferredDeskId: 'B' }),
      person('p3'),
      person('p4', { preferredDeskId: 'A' }),
    ];
    expect(allocationOrder(people).map((p) => p.id)).toEqual(['p2', 'p4', 'p1', 'p3']);
  });
});

describe('allocateBulk', () => {
  const base = { desks: DESKS, pool: null, today: TODAY };

  it('gives the preferred desk when free and marks it', () => {
    const rows = allocateBulk({
      ...base,
      people: [person('p', { preferredDeskId: 'B' })],
      dates: [D2, D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} B*`, `p ${D2} B*`]);
  });

  it('falls back to the nearest free desk in the preferred desk’s zone', () => {
    const rows = allocateBulk({
      ...base,
      people: [person('p', { preferredDeskId: 'C' })],
      dates: [D1],
      // C taken; B (10 away) beats A (20 away); Z is nearer but in another zone.
      facts: facts([['C', D1, 'other']]),
    });
    expect(assigned(rows)).toEqual([`p ${D1} B`]);
  });

  it('leaves the day unassigned when the anchor zone has nothing free', () => {
    const rows = allocateBulk({
      ...base,
      people: [person('p', { preferredDeskId: 'Z' })],
      dates: [D1],
      facts: facts([['Z', D1, 'other']]),
    });
    expect(assigned(rows)).toEqual([`p ${D1} UNASSIGNED`]);
  });

  it('anchors a person without preference on the desk free on most days (ties: code)', () => {
    const rows = allocateBulk({
      ...base,
      people: [person('p')],
      dates: [D1, D2, D3],
      // A is taken on D1, so B (free all three days) is the anchor and is kept.
      facts: facts([['A', D1, 'x']]),
    });
    expect(assigned(rows)).toEqual([`p ${D1} B`, `p ${D2} B`, `p ${D3} B`]);
  });

  it('never gives one desk twice a day and serves preferred people first', () => {
    const rows = allocateBulk({
      ...base,
      people: [person('first'), person('pref', { preferredDeskId: 'A' })],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`pref ${D1} A*`, `first ${D1} B`]);
  });

  it('uses only the pool, and the preferred desk only when it is in the pool', () => {
    const rows = allocateBulk({
      ...base,
      pool: new Set(['C']),
      people: [person('p', { preferredDeskId: 'A' })],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} C`]);
  });

  it('anchors in the pool’s zone when the preferred desk is outside the pool', () => {
    const rows = allocateBulk({
      ...base,
      pool: new Set(['Z']),
      people: [person('p', { preferredDeskId: 'A' })],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} Z`]);
  });

  it('ignores a preferred desk in another office and falls back to the most-free anchor', () => {
    const rows = allocateBulk({
      ...base,
      desks: [...DESKS, desk('F', 0, { officeId: 'office-b', zoneId: 'z1' })],
      people: [person('p', { preferredDeskId: 'F' })],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} A`]);
  });

  it('ignores a preferred hive desk without direct access', () => {
    const rows = allocateBulk({
      ...base,
      desks: [
        desk('A', 0),
        desk('H', 5, { hiveId: 'h1', zoneId: 'z2' }),
        desk('Z', 50, { zoneId: 'z2' }),
      ],
      people: [person('p', { preferredDeskId: 'H' })],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} A`]);
  });

  it('keeps the anchor and takes the nearest same-zone desk on the day it is occupied', () => {
    const rows = allocateBulk({
      ...base,
      desks: [desk('A', 0), desk('B', 10), desk('C', 25)],
      people: [person('p')],
      dates: [D1, D2, D3],
      // Every desk is free on two days: tie by code → anchor A; on D1 B is nearest.
      facts: facts([
        ['A', D1, 'x'],
        ['B', D2, 'y'],
        ['C', D3, 'z'],
      ]),
    });
    expect(assigned(rows)).toEqual([`p ${D1} B`, `p ${D2} A`, `p ${D3} A`]);
  });

  it('auto-allocates direct access only: a hive desk of somebody else’s hive is skipped', () => {
    const rows = allocateBulk({
      ...base,
      desks: [desk('A', 0, { hiveId: 'h1' }), desk('B', 10)],
      people: [person('p')],
      dates: [D1],
      facts: facts(),
    });
    expect(assigned(rows)).toEqual([`p ${D1} B`]);
  });

  it('skips assigned desks unless released that day', () => {
    const rows = allocateBulk({
      ...base,
      desks: [desk('A', 0, { permanentAssigneeId: 'holder' }), desk('B', 50, { zoneId: 'z9' })],
      people: [person('p', { preferredDeskId: 'A' })],
      dates: [D1, D2],
      facts: facts([], [['A', D2]]),
    });
    expect(assigned(rows)).toEqual([`p ${D1} UNASSIGNED`, `p ${D2} A*`]);
  });

  it('reports person-level and per-day unavailability', () => {
    const rows = allocateBulk({
      ...base,
      people: [
        person('past'),
        person('booked'),
        person('holder', { permanentDeskId: 'A' }),
        person('nooffice', { officeId: null }),
        person('gone', { active: false }),
      ],
      dates: ['2099-01-04', D1],
      facts: facts([['A', D1, 'booked']]),
    });
    expect(assigned(rows)).toEqual([
      'past 2099-01-04 PAST_DATE',
      `past ${D1} B`,
      'booked 2099-01-04 PAST_DATE',
      `booked ${D1} ALREADY_RESERVED_OTHER_DESK`,
      'holder 2099-01-04 PAST_DATE',
      `holder ${D1} PERMANENT_DESK_HOLDER`,
      'nooffice 2099-01-04 PAST_DATE',
      `nooffice ${D1} NO_OFFICE_ASSIGNED`,
      'gone 2099-01-04 PAST_DATE',
      `gone ${D1} USER_INACTIVE`,
    ]);
  });
});

describe('bulkRowVerdict', () => {
  const p = person('p');

  it('lets an admin override hive access by hand, never another office or a taken desk', () => {
    const hiveDesk = desk('H', 0, { hiveId: 'h1' });
    expect(bulkRowVerdict(p, hiveDesk, D1, facts(), TODAY)).toBe('DESK_ACCESS_DENIED');
    expect(bulkRowVerdict(p, hiveDesk, D1, facts(), TODAY, true)).toBeNull();
    expect(
      bulkRowVerdict(p, desk('F', 0, { officeId: 'office-b' }), D1, facts(), TODAY, true)
    ).toBe('DESK_NOT_AVAILABLE');
    expect(bulkRowVerdict(p, hiveDesk, D1, facts([['H', D1, 'x']]), TODAY, true)).toBe(
      'DESK_TAKEN'
    );
  });

  it('tells this desk from another one the person already holds', () => {
    const f = facts([['A', D1, 'p']]);
    expect(bulkRowVerdict(p, desk('A', 0), D1, f, TODAY)).toBe('ALREADY_RESERVED_THIS_DESK');
    expect(bulkRowVerdict(p, desk('B', 0), D1, f, TODAY)).toBe('ALREADY_RESERVED_OTHER_DESK');
  });

  it('reports an inactive desk and an assigned one', () => {
    expect(bulkRowVerdict(p, desk('A', 0, { active: false }), D1, facts(), TODAY)).toBe(
      'DESK_NOT_AVAILABLE'
    );
    expect(bulkRowVerdict(p, desk('A', 0, { permanentAssigneeId: 'h' }), D1, facts(), TODAY)).toBe(
      'DESK_ASSIGNED'
    );
  });
});
