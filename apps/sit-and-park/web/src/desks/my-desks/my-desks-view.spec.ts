import type { MyDeskReleasesOutput, MyDeskReservation } from '@sit-and-park/contract';
import { buildBookingsCalendar, releaseRange, splitReservations } from './my-desks-view';

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

describe('buildBookingsCalendar', () => {
  const permanent: MyDeskReleasesOutput = {
    deskId: 'desk-9',
    code: 'P-09',
    releases: [{ id: 'rel-1', date: '2026-09-17', reservedByName: null }],
  };

  it('lays out Monday to Friday only and drops weeks with no weekday', () => {
    // 1 Aug 2026 is a Saturday: the first row would hold only weekend days.
    const { weeks } = buildBookingsCalendar('2026-08-10', [], null, TODAY);
    expect(weeks.every((week) => week.slots.length === 5)).toBe(true);
    expect(weeks[0]?.slots.every((slot) => slot.day === null)).toBe(false);
    const days = weeks.flatMap((week) =>
      week.slots.flatMap((slot) => (slot.day ? [slot.day.date] : []))
    );
    expect(days[0]).toBe('2026-08-03');
    expect(days).toHaveLength(21);
  });

  it('puts reservation chips on their day, flags today and past, counts the month', () => {
    const { weeks, monthCount } = buildBookingsCalendar(
      TODAY,
      [reservation('r1', '2026-09-16'), reservation('r2', '2026-10-01')],
      null,
      TODAY
    );
    const cells = weeks.flatMap((week) =>
      week.slots.flatMap((slot) => (slot.day ? [slot.day] : []))
    );
    expect(cells.find((cell) => cell.date === '2026-09-16')?.chips).toEqual([
      { kind: 'reservation', id: 'r1', code: 'A-01' },
    ]);
    expect(cells.find((cell) => cell.date === TODAY)?.isToday).toBe(true);
    expect(cells.find((cell) => cell.date === '2026-09-14')?.isPast).toBe(true);
    expect(monthCount).toBe(1);
  });

  it('shows the permanent desk from today on, released on released days', () => {
    const { weeks } = buildBookingsCalendar(TODAY, [], permanent, TODAY);
    const byDate = new Map(
      weeks.flatMap((week) =>
        week.slots.flatMap((slot) => (slot.day ? [[slot.day.date, slot.day]] : []))
      )
    );
    expect(byDate.get('2026-09-14')?.chips).toEqual([]);
    expect(byDate.get(TODAY)?.chips).toEqual([{ kind: 'permanent', code: 'P-09' }]);
    expect(byDate.get('2026-09-17')?.chips).toEqual([{ kind: 'released', code: 'P-09' }]);
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
