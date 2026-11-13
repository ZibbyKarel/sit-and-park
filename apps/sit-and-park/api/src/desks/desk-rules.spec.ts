import { DomainError } from '../common/errors/domain-error';
import type { DeskCaller, DeskFacts, SeriesDayFacts } from './desk-rules';
import {
  assertSeriesAllowed,
  deskAccess,
  deskStatus,
  isAssignedOn,
  planSeries,
  seriesDayVerdict,
} from './desk-rules';

const OFFICE = 'office-a';
const OTHER_OFFICE = 'office-b';
const HIVE = 'hive-1';
const OTHER_HIVE = 'hive-2';
const ME = 'me';
const SOMEBODY = 'somebody';
const TODAY = '2099-01-05';

function desk(overrides: Partial<DeskFacts> = {}): DeskFacts {
  return {
    id: 'desk-1',
    officeId: OFFICE,
    hiveId: null,
    active: true,
    permanentAssigneeId: null,
    ...overrides,
  };
}

function caller(overrides: Partial<DeskCaller> = {}): DeskCaller {
  return {
    id: ME,
    officeId: OFFICE,
    isAdmin: false,
    hiveId: null,
    grantedDeskIds: new Set(),
    permanentDeskId: null,
    ...overrides,
  };
}

function day(overrides: Partial<SeriesDayFacts> = {}): SeriesDayFacts {
  return {
    date: TODAY,
    reservedByUserId: null,
    released: false,
    callerReservedDeskId: null,
    ...overrides,
  };
}

function codeOf(work: () => void): string | null {
  try {
    work();
    return null;
  } catch (error) {
    if (error instanceof DomainError) {
      return error.code;
    }
    throw error;
  }
}

describe('deskAccess', () => {
  /**
   * Every combination of the five inputs: office match, hive present, admin,
   * member of the desk's hive, grant. DIRECT iff same office and any of (no
   * hive, admin, member, grant); APPROVAL iff same office and a hive; else NONE.
   */
  const bools = [false, true];
  const cases = bools.flatMap((sameOffice) =>
    bools.flatMap((hasHive) =>
      bools.flatMap((isAdmin) =>
        bools.flatMap((isMember) =>
          bools.map((granted) => ({ sameOffice, hasHive, isAdmin, isMember, granted }))
        )
      )
    )
  );

  it.each(cases)('%o', ({ sameOffice, hasHive, isAdmin, isMember, granted }) => {
    const subject = desk({
      officeId: sameOffice ? OFFICE : OTHER_OFFICE,
      hiveId: hasHive ? HIVE : null,
    });
    const viewer = caller({
      isAdmin,
      hiveId: isMember ? HIVE : OTHER_HIVE,
      grantedDeskIds: new Set(granted ? [subject.id] : ['another-desk']),
    });
    const expected = !sameOffice
      ? 'NONE'
      : !hasHive || isAdmin || isMember || granted
        ? 'DIRECT'
        : 'APPROVAL';
    expect(deskAccess(subject, viewer)).toBe(expected);
  });

  it('is NONE for a caller without an office, admin included', () => {
    expect(deskAccess(desk(), caller({ officeId: null, isAdmin: true }))).toBe('NONE');
  });

  it('a grant for another desk does not count', () => {
    expect(
      deskAccess(desk({ hiveId: HIVE }), caller({ grantedDeskIds: new Set(['desk-2']) }))
    ).toBe('APPROVAL');
  });
});

describe('isAssignedOn', () => {
  it.each([
    [null, false, false],
    [null, true, false],
    [SOMEBODY, false, true],
    [SOMEBODY, true, false],
  ])('holder %s, released %s → %s', (permanentAssigneeId, released, expected) => {
    expect(isAssignedOn({ permanentAssigneeId }, { released })).toBe(expected);
  });
});

describe('deskStatus', () => {
  it.each([
    [
      'inactive beats everything',
      { active: false, permanentAssigneeId: SOMEBODY },
      { reservedByUserId: ME, released: false },
      'INACTIVE',
    ],
    [
      'assigned masks a reservation',
      { active: true, permanentAssigneeId: SOMEBODY },
      { reservedByUserId: ME, released: false },
      'ASSIGNED',
    ],
    [
      'assigned to the viewer is still ASSIGNED',
      { active: true, permanentAssigneeId: ME },
      { reservedByUserId: null, released: false },
      'ASSIGNED',
    ],
    [
      'released and reserved by me',
      { active: true, permanentAssigneeId: SOMEBODY },
      { reservedByUserId: ME, released: true },
      'RESERVED_BY_ME',
    ],
    [
      'released and reserved by another',
      { active: true, permanentAssigneeId: SOMEBODY },
      { reservedByUserId: SOMEBODY, released: true },
      'RESERVED',
    ],
    [
      'released and free',
      { active: true, permanentAssigneeId: SOMEBODY },
      { reservedByUserId: null, released: true },
      'FREE',
    ],
    [
      'reserved by me',
      { active: true, permanentAssigneeId: null },
      { reservedByUserId: ME, released: false },
      'RESERVED_BY_ME',
    ],
    [
      'reserved by another',
      { active: true, permanentAssigneeId: null },
      { reservedByUserId: SOMEBODY, released: false },
      'RESERVED',
    ],
    [
      'free',
      { active: true, permanentAssigneeId: null },
      { reservedByUserId: null, released: false },
      'FREE',
    ],
  ] as const)('%s', (_label, subject, facts, expected) => {
    expect(deskStatus(subject, facts, ME)).toBe(expected);
  });
});

describe('seriesDayVerdict', () => {
  const subject = desk();

  it('is null for a free day, today included', () => {
    expect(seriesDayVerdict(subject, day(), TODAY)).toBeNull();
  });

  it('PAST_DATE first, before any other reason', () => {
    expect(
      seriesDayVerdict(
        desk({ permanentAssigneeId: SOMEBODY }),
        day({ date: '2099-01-04', callerReservedDeskId: subject.id, reservedByUserId: ME }),
        TODAY
      )
    ).toBe('PAST_DATE');
  });

  it('DESK_ASSIGNED before the caller’s own reservations', () => {
    expect(
      seriesDayVerdict(
        desk({ permanentAssigneeId: SOMEBODY }),
        day({ callerReservedDeskId: 'desk-2', reservedByUserId: SOMEBODY }),
        TODAY
      )
    ).toBe('DESK_ASSIGNED');
  });

  it('a released day of a permanent desk is bookable', () => {
    expect(
      seriesDayVerdict(desk({ permanentAssigneeId: SOMEBODY }), day({ released: true }), TODAY)
    ).toBeNull();
  });

  it('ALREADY_RESERVED_THIS_DESK when the caller holds this desk', () => {
    expect(
      seriesDayVerdict(
        subject,
        day({ callerReservedDeskId: subject.id, reservedByUserId: ME }),
        TODAY
      )
    ).toBe('ALREADY_RESERVED_THIS_DESK');
  });

  it('ALREADY_RESERVED_OTHER_DESK before DESK_TAKEN', () => {
    expect(
      seriesDayVerdict(
        subject,
        day({ callerReservedDeskId: 'desk-2', reservedByUserId: SOMEBODY }),
        TODAY
      )
    ).toBe('ALREADY_RESERVED_OTHER_DESK');
  });

  it('DESK_TAKEN when somebody else holds it', () => {
    expect(seriesDayVerdict(subject, day({ reservedByUserId: SOMEBODY }), TODAY)).toBe(
      'DESK_TAKEN'
    );
  });
});

describe('planSeries', () => {
  it('returns one entry per date, ascending, with reason null exactly when ok', () => {
    const plan = planSeries(
      desk(),
      [
        day({ date: '2099-01-07', reservedByUserId: SOMEBODY }),
        day({ date: '2099-01-04' }),
        day({ date: '2099-01-06' }),
      ],
      TODAY
    );
    expect(plan).toEqual([
      { date: '2099-01-04', ok: false, reason: 'PAST_DATE' },
      { date: '2099-01-06', ok: true, reason: null },
      { date: '2099-01-07', ok: false, reason: 'DESK_TAKEN' },
    ]);
  });
});

describe('assertSeriesAllowed', () => {
  it('passes a directly bookable active desk', () => {
    expect(codeOf(() => assertSeriesAllowed(desk(), caller()))).toBeNull();
  });

  it('NO_OFFICE_ASSIGNED first, even for a missing desk', () => {
    expect(
      codeOf(() => assertSeriesAllowed(null, caller({ officeId: null, permanentDeskId: 'd' })))
    ).toBe('NO_OFFICE_ASSIGNED');
  });

  it('PERMANENT_DESK_HOLDER next, before the desk is even looked at', () => {
    expect(codeOf(() => assertSeriesAllowed(null, caller({ permanentDeskId: 'own' })))).toBe(
      'PERMANENT_DESK_HOLDER'
    );
  });

  it('a permanent holder is blocked from their own desk too', () => {
    expect(
      codeOf(() =>
        assertSeriesAllowed(
          desk({ permanentAssigneeId: ME }),
          caller({ permanentDeskId: 'desk-1' })
        )
      )
    ).toBe('PERMANENT_DESK_HOLDER');
  });

  it('NOT_FOUND for a missing desk', () => {
    expect(codeOf(() => assertSeriesAllowed(null, caller()))).toBe('NOT_FOUND');
  });

  it('DESK_NOT_AVAILABLE for an inactive desk, before access', () => {
    expect(
      codeOf(() => assertSeriesAllowed(desk({ active: false, officeId: OTHER_OFFICE }), caller()))
    ).toBe('DESK_NOT_AVAILABLE');
  });

  it('DESK_ACCESS_DENIED for a hive desk without direct access', () => {
    expect(codeOf(() => assertSeriesAllowed(desk({ hiveId: HIVE }), caller()))).toBe(
      'DESK_ACCESS_DENIED'
    );
  });

  it('DESK_ACCESS_DENIED for another office, admin included', () => {
    expect(
      codeOf(() => assertSeriesAllowed(desk({ officeId: OTHER_OFFICE }), caller({ isAdmin: true })))
    ).toBe('DESK_ACCESS_DENIED');
  });
});
