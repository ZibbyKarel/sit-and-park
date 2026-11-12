import { directoryDesk } from './desk.test-helpers';
import {
  deskPlanLabel,
  EMPTY_DESK_FILTER,
  matchesDeskFilter,
  MAX_SERIES_WEEKS,
  toDeskBannerView,
  toDeskDialogView,
  toDeskShapes,
  toFloorPlanView,
  toSeriesView,
} from './desk-view';

const NO_CONTEXT = { holdsPermanentDesk: false, myDeskToday: null };

describe('deskPlanLabel', () => {
  it.each([
    ['D-001', '1'],
    ['D-037', '37'],
    ['D-221', '221'],
    ['D-000', '0'],
    ['X-7', 'X-7'],
  ])('%s -> %s', (code, label) => expect(deskPlanLabel(code)).toBe(label));
});

describe('toFloorPlanView', () => {
  const office = {
    id: 'office-1',
    name: 'Praha',
    floorPlan: 'praha' as const,
    floorPlanWidth: 22473,
    floorPlanHeight: 5835,
  };

  it('maps the plan key to the bundled asset, never anything else', () => {
    expect(toFloorPlanView(office)).toEqual({
      src: '/floorplans/praha.svg',
      width: 22473,
      height: 5835,
    });
  });

  it('draws no plan without a key or a size', () => {
    expect(toFloorPlanView({ ...office, floorPlan: null })).toBeNull();
    expect(toFloorPlanView({ ...office, floorPlanHeight: null })).toBeNull();
  });
});

describe('matchesDeskFilter', () => {
  const desk = directoryDesk({
    zoneId: 'zone-a',
    hiveId: 'hive-1',
    status: 'RESERVED',
    access: 'APPROVAL',
  });

  it('matches everything when empty', () => {
    expect(matchesDeskFilter(desk, EMPTY_DESK_FILTER)).toBe(true);
  });

  it.each([
    [{ zoneId: 'zone-b' }],
    [{ hiveId: 'hive-2' }],
    [{ onlyFree: true }],
    [{ onlyDirect: true }],
  ])('rejects on %j', (part) => {
    expect(matchesDeskFilter(desk, { ...EMPTY_DESK_FILTER, ...part })).toBe(false);
  });

  it('accepts a matching zone and hive', () => {
    expect(
      matchesDeskFilter(desk, { ...EMPTY_DESK_FILTER, zoneId: 'zone-a', hiveId: 'hive-1' })
    ).toBe(true);
  });
});

describe('toDeskShapes', () => {
  it('turns each desk into a shape toned by status, outlined by hive, dimmed when filtered out', () => {
    const desks = [
      directoryDesk({ id: 'a', status: 'FREE', hiveColor: '#FF0000' }),
      directoryDesk({ id: 'b', code: 'D-002', status: 'RESERVED' }),
    ];
    const shapes = toDeskShapes(
      desks,
      { ...EMPTY_DESK_FILTER, onlyFree: true },
      (d) => `aria ${d.code}`
    );

    expect(shapes).toEqual([
      expect.objectContaining({
        id: 'a',
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        label: '1',
        ariaLabel: 'aria D-001',
        tone: 'FREE',
        outlineColor: '#FF0000',
        dimmed: false,
      }),
      expect.objectContaining({ id: 'b', tone: 'RESERVED', outlineColor: undefined, dimmed: true }),
    ]);
  });
});

describe('toDeskBannerView', () => {
  it('is nothing on an ordinary day', () => {
    expect(toDeskBannerView([directoryDesk()])).toEqual({ kind: 'none' });
  });

  it('names the desk the viewer has that day', () => {
    expect(
      toDeskBannerView([
        directoryDesk(),
        directoryDesk({ code: 'D-014', status: 'RESERVED_BY_ME', myReservationId: 'res-1' }),
      ])
    ).toEqual({ kind: 'today', code: 'D-014', reservationId: 'res-1' });
  });

  it('puts a permanent desk first', () => {
    expect(
      toDeskBannerView([
        directoryDesk({ code: 'D-014', status: 'RESERVED_BY_ME', myReservationId: 'res-1' }),
        directoryDesk({ code: 'D-100', status: 'ASSIGNED', assignedToMe: true }),
      ])
    ).toEqual({ kind: 'permanent', code: 'D-100' });
  });
});

describe('toDeskDialogView', () => {
  it('offers a free direct desk for the day and as a series', () => {
    expect(toDeskDialogView(directoryDesk(), NO_CONTEXT)).toEqual({
      canBookDay: true,
      canSeries: true,
      canCancel: false,
      canRequest: false,
      canCancelRequest: false,
      note: null,
      holderName: null,
    });
  });

  it('offers only a series when the viewer already has a desk that day', () => {
    const view = toDeskDialogView(directoryDesk(), { ...NO_CONTEXT, myDeskToday: 'D-009' });
    expect(view).toMatchObject({ canBookDay: false, canSeries: true, note: 'noteHasDeskToday' });
  });

  it('offers cancel on the viewer’s own booking', () => {
    const view = toDeskDialogView(
      directoryDesk({ status: 'RESERVED_BY_ME', myReservationId: 'res-1' }),
      NO_CONTEXT
    );
    expect(view).toMatchObject({ canCancel: true, canBookDay: false, note: null });
  });

  it('names the holder of a taken desk and still offers other days', () => {
    const view = toDeskDialogView(
      directoryDesk({ status: 'RESERVED', reservedByName: 'Petr Novák' }),
      NO_CONTEXT
    );
    expect(view).toMatchObject({
      canBookDay: false,
      canSeries: true,
      holderName: 'Petr Novák',
      note: 'noteReserved',
    });
  });

  it('names the permanent holder of an assigned desk', () => {
    const view = toDeskDialogView(
      directoryDesk({ status: 'ASSIGNED', permanentAssigneeName: 'Jana' }),
      NO_CONTEXT
    );
    expect(view).toMatchObject({ canBookDay: false, holderName: 'Jana', note: 'noteAssigned' });
  });

  it('offers an approval request for a free hive desk without direct access', () => {
    const view = toDeskDialogView(directoryDesk({ access: 'APPROVAL' }), NO_CONTEXT);
    expect(view).toMatchObject({
      canRequest: true,
      canSeries: false,
      canBookDay: false,
      note: 'noteApproval',
    });
  });

  it('offers withdrawing, not re-filing, while the viewer’s request is pending', () => {
    const view = toDeskDialogView(
      directoryDesk({ access: 'APPROVAL', myPendingRequestId: 'req-1' }),
      NO_CONTEXT
    );
    expect(view).toMatchObject({
      canRequest: false,
      canCancelRequest: true,
      note: 'notePendingRequest',
    });
  });

  it('explains an approval desk that is not free', () => {
    const view = toDeskDialogView(
      directoryDesk({ access: 'APPROVAL', status: 'RESERVED' }),
      NO_CONTEXT
    );
    expect(view).toMatchObject({ canRequest: false, note: 'noteReserved' });
  });

  it.each([
    ['an inactive desk', directoryDesk({ status: 'INACTIVE' }), NO_CONTEXT, 'noteInactive'],
    ['no access', directoryDesk({ access: 'NONE' }), NO_CONTEXT, 'noteNoAccess'],
    [
      'a permanent holder',
      directoryDesk(),
      { holdsPermanentDesk: true, myDeskToday: null },
      'notePermanentHolder',
    ],
  ])('offers nothing for %s', (_label, desk, ctx, note) => {
    expect(toDeskDialogView(desk, ctx)).toMatchObject({
      canBookDay: false,
      canSeries: false,
      canRequest: false,
      canCancel: false,
      note,
    });
  });
});

describe('toSeriesView', () => {
  // 2026-11-16 is a Monday.
  const MONDAY = '2026-11-16';

  it('repeats the chosen weekdays for N weeks from the start day', () => {
    expect(toSeriesView({ start: MONDAY, weekdays: [1, 3], weeks: 2, extraDates: [] })).toEqual({
      dates: ['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25'],
      problem: null,
    });
  });

  it('starts mid-week from the start day, not from Monday', () => {
    expect(
      toSeriesView({ start: '2026-11-18', weekdays: [1], weeks: 1, extraDates: [] }).dates
    ).toEqual(['2026-11-23']);
  });

  it('merges extra days, sorted and without duplicates', () => {
    expect(
      toSeriesView({
        start: MONDAY,
        weekdays: [1],
        weeks: 1,
        extraDates: ['2026-11-20', '2026-11-16'],
      }).dates
    ).toEqual(['2026-11-16', '2026-11-20']);
  });

  it('reports an empty pick', () => {
    expect(toSeriesView({ start: MONDAY, weekdays: [], weeks: 3, extraDates: [] }).problem).toBe(
      'empty'
    );
  });

  it('reports more than 20 dates', () => {
    expect(
      toSeriesView({
        start: MONDAY,
        weekdays: [1, 2, 3, 4, 5],
        weeks: MAX_SERIES_WEEKS,
        extraDates: [],
      })
    ).toMatchObject({ problem: 'tooMany' });
  });

  it('allows every weekday for the maximum number of weeks only within 20 dates', () => {
    expect(MAX_SERIES_WEEKS).toBe(5);
    expect(
      toSeriesView({ start: MONDAY, weekdays: [1, 2, 3, 4, 5], weeks: 4, extraDates: [] })
    ).toEqual(expect.objectContaining({ problem: null }));
  });

  it('reports a span over 34 days', () => {
    expect(
      toSeriesView({ start: MONDAY, weekdays: [1], weeks: 1, extraDates: ['2026-12-21'] }).problem
    ).toBe('tooLong');
    expect(
      toSeriesView({ start: MONDAY, weekdays: [1], weeks: 1, extraDates: ['2026-12-20'] }).problem
    ).toBeNull();
  });
});
