import type {
  DeskApprovalStatus,
  MyDeskReleasesOutput,
  MyDeskRequest,
  MyDeskReservation,
  MyParkingReservation,
} from '@sit-and-park/contract';
import {
  buildReservationsCalendar,
  mergeMyReservations,
  releaseRange,
  shiftMonth,
  splitReservations,
  type CalendarSources,
} from './my-reservations-view';

const TODAY = '2026-09-15'; // a Tuesday

function reservation(id: string, date: string): MyDeskReservation {
  return {
    id,
    deskId: 'desk-1',
    userId: 'user-1',
    date,
    createdAt: '2026-09-01T08:00:00.000Z',
    deskCode: 'A-01',
    zoneName: 'Zóna A',
    hiveName: null,
  };
}

describe('splitReservations', () => {
  it('counts today as upcoming, orders upcoming ascending and history newest first', () => {
    const { upcoming, history } = splitReservations(
      [
        reservation('late', '2026-09-30'),
        reservation('yesterday', '2026-09-14'),
        reservation('today', TODAY),
        reservation('old', '2026-08-01'),
      ],
      TODAY
    );
    expect(upcoming.map((r) => r.id)).toEqual(['today', 'late']);
    expect(history.map((r) => r.id)).toEqual(['yesterday', 'old']);
  });
});

describe('shiftMonth', () => {
  it('moves to the first of the neighbouring month, across year ends and from a month end', () => {
    expect(shiftMonth('2026-09-15', 1)).toBe('2026-10-01');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftMonth('2026-12-20', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-05', -1)).toBe('2025-12-01');
  });
});

describe('buildReservationsCalendar', () => {
  const park = (dates: string[]) => dates.map((date) => ({ date, parkingSpotLabel: 'A1' }));
  const permanent: MyDeskReleasesOutput = {
    deskId: 'desk-9',
    code: 'P-09',
    releases: [{ id: 'rel-1', date: '2026-09-17', reservedByName: null }],
  };
  const none: CalendarSources = {
    parking: [],
    waitlist: [],
    reservations: [],
    requests: [],
    permanent: null,
  };
  const request = (date: string, status: DeskApprovalStatus): MyDeskRequest => ({
    id: `req-${date}`,
    deskId: 'd',
    userId: 'u',
    date,
    status,
    decidedById: null,
    decidedAt: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    deskCode: 'H-07',
    zoneName: 'Zóna H',
  });
  const days = (sources: CalendarSources, anchor = TODAY) =>
    new Map(
      buildReservationsCalendar(anchor, sources, TODAY).weeks.flatMap((week) =>
        week.slots.flatMap((slot) => (slot.day ? [[slot.day.date, slot.day] as const] : []))
      )
    );

  it('lays the month out in Monday-first weeks of seven', () => {
    // 1 Aug 2026 is a Saturday.
    const { weeks } = buildReservationsCalendar('2026-08-10', none, TODAY);
    expect(weeks.every((week) => week.slots.length === 7)).toBe(true);
    expect(weeks[0]?.slots.slice(0, 5).every((slot) => slot.day === null)).toBe(true);
    expect(weeks[0]?.slots[5]?.day?.date).toBe('2026-08-01');
  });

  it('puts parking, desk and request events on their day and flags today, past and off days', () => {
    const byDate = days({
      ...none,
      parking: park(['2026-09-16']),
      reservations: [reservation('r1', '2026-09-16'), reservation('r2', '2026-10-01')],
      requests: [request('2026-09-18', 'PENDING'), request('2026-09-18', 'REJECTED')],
    });
    expect(byDate.get('2026-09-16')?.events).toEqual([
      { kind: 'parking', label: 'A1' },
      { kind: 'desk', code: 'A-01' },
    ]);
    expect(byDate.get('2026-09-18')?.events).toEqual([
      { kind: 'request', code: 'H-07', status: 'PENDING' },
      { kind: 'request', code: 'H-07', status: 'REJECTED' },
    ]);
    expect(byDate.get('2026-10-01')).toBeUndefined();
    expect(byDate.get(TODAY)?.isToday).toBe(true);
    expect(byDate.get('2026-09-14')?.isPast).toBe(true);
    expect(byDate.get('2026-09-19')?.isOff).toBe(true);
    expect(byDate.get('2026-09-16')?.isOff).toBe(false);
  });

  it('lists only days with events in the agenda, in order', () => {
    const { agenda } = buildReservationsCalendar(
      TODAY,
      { ...none, parking: park(['2026-09-22', '2026-09-16']) },
      TODAY
    );
    expect(agenda.map((day) => day.date)).toEqual(['2026-09-16', '2026-09-22']);
  });

  it('shows a waitlist entry on its day without counting it as parking', () => {
    const byDate = days({
      ...none,
      waitlist: [{ date: '2026-09-16', parkingSpotLabel: 'B2', position: 3 }],
    });
    expect(byDate.get('2026-09-16')?.events).toEqual([
      { kind: 'waitlist', label: 'B2', position: 3 },
    ]);
    expect(byDate.get('2026-09-16')?.parkingWithoutDesk).toBe(false);
  });

  it('warns about parking without a desk on a business day, today or later', () => {
    const byDate = days({
      ...none,
      // 14 past, 15 today, 16 has a desk, 19 is a Saturday
      parking: park(['2026-09-14', TODAY, '2026-09-16', '2026-09-19']),
      reservations: [reservation('r1', '2026-09-16')],
    });
    expect(byDate.get('2026-09-14')?.parkingWithoutDesk).toBe(false);
    expect(byDate.get(TODAY)?.parkingWithoutDesk).toBe(true);
    expect(byDate.get('2026-09-16')?.parkingWithoutDesk).toBe(false);
    expect(byDate.get('2026-09-19')?.parkingWithoutDesk).toBe(false);
  });

  it('does not warn on a public holiday', () => {
    // 28 Sep 2026: St. Wenceslas Day
    const byDate = days({ ...none, parking: park(['2026-09-28']) });
    expect(byDate.get('2026-09-28')?.isOff).toBe(true);
    expect(byDate.get('2026-09-28')?.parkingWithoutDesk).toBe(false);
  });

  it('does not count a request as a desk, but a kept permanent desk', () => {
    const byDate = days({
      ...none,
      parking: park(['2026-09-16', '2026-09-17']),
      requests: [request('2026-09-16', 'APPROVED')],
      permanent,
    });
    expect(byDate.get('2026-09-16')?.parkingWithoutDesk).toBe(false); // permanent desk kept
    expect(byDate.get('2026-09-17')?.parkingWithoutDesk).toBe(true); // released
  });

  it('shows the permanent desk from today on, released on released days', () => {
    const byDate = days({ ...none, permanent });
    expect(byDate.get('2026-09-14')?.events).toEqual([]);
    expect(byDate.get(TODAY)?.events).toEqual([{ kind: 'permanent', code: 'P-09' }]);
    expect(byDate.get('2026-09-17')?.events).toEqual([{ kind: 'released', code: 'P-09' }]);
    expect(byDate.get('2026-09-19')?.events).toEqual([]);
  });
});

describe('releaseRange', () => {
  it('lists the working days of the range, skipping the weekend', () => {
    const { dates, truncated } = releaseRange('2026-09-18', '2026-09-22', TODAY);
    expect(dates).toEqual(['2026-09-18', '2026-09-21', '2026-09-22']);
    expect(truncated).toBe(false);
  });

  it('never starts before today and is empty for an inverted range', () => {
    expect(releaseRange('2026-09-01', '2026-09-15', TODAY).dates).toEqual([TODAY]);
    expect(releaseRange('2026-09-20', '2026-09-16', TODAY).dates).toEqual([]);
  });

  it('caps at 60 working days and reports the truncation (never 61)', () => {
    const { dates, truncated } = releaseRange(TODAY, '2028-01-01', TODAY);
    expect(dates).toHaveLength(60);
    expect(truncated).toBe(true);
  });

  it('is not truncated at exactly 60 working days', () => {
    const { dates: sixtyOne } = releaseRange(TODAY, '2027-01-01', TODAY);
    const last = sixtyOne[59] as string;
    const exact = releaseRange(TODAY, last, TODAY);
    expect(exact.dates).toHaveLength(60);
    expect(exact.truncated).toBe(false);
  });
});

function parkingReservation(id: string, date: string): MyParkingReservation {
  return {
    id,
    parkingSpotId: 'spot-1',
    userId: 'user-1',
    date,
    status: 'CONFIRMED',
    createdAt: '2026-09-01T08:00:00.000Z',
    parkingSpotLabel: 'P1',
  } as unknown as MyParkingReservation;
}

describe('mergeMyReservations', () => {
  it('keys entries by kind and id so equal ids of the two kinds do not collide', () => {
    const merged = mergeMyReservations([parkingReservation('x', TODAY)], [reservation('x', TODAY)]);
    expect(merged.map((e) => e.key)).toEqual(['parking:x', 'desk:x']);
  });

  it('puts parking before the desk on the same day after splitting', () => {
    const parking = [
      parkingReservation('p16', '2026-09-16'),
      parkingReservation('p12', '2026-09-12'),
    ];
    const desks = [
      reservation('d16', '2026-09-16'),
      reservation('d15', '2026-09-15'),
      reservation('d10', '2026-09-10'),
    ];
    const { upcoming, history } = splitReservations(mergeMyReservations(parking, desks), TODAY);
    expect(upcoming.map((e) => e.key)).toEqual(['desk:d15', 'parking:p16', 'desk:d16']);
    expect(history.map((e) => e.key)).toEqual(['parking:p12', 'desk:d10']);
  });
});
