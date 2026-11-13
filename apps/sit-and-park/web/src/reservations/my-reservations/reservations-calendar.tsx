'use client';

/**
 * The month calendar of "Moje rezervace": parking days, waitlist places, desk
 * reservations, desk requests, the permanent desk and its released days on one
 * Monday-first grid.
 *
 * On a narrow screen the grid gives way to an agenda: the same events, one
 * day per row, only days that have something. Both are in the DOM and CSS
 * picks one (`display: none` also hides it from assistive technology).
 *
 * An event's type is carried by its icon's accessible name (and colour,
 * `data-type`); the visible text is the place id plus any status. Only the
 * warning icon is decorative.
 * Cancelling stays in the list view.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRequireAuth } from '@sit-and-park/auth/client';
import { todayInPrague, toYearMonth, useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import type { DateOnly } from '@sit-and-park/i18n';
import { Button, Stack, Strong, Text } from '@shoptet/ui';
import { useApi } from '../../shell/api-provider/api-provider';
import { ScreenDataGuard } from '../../shell/screen-state/screen-state';
import type { ScreenData } from '../../shell/screen-state/screen-state';
import { CarIcon, DeskIcon, WarningIcon } from '../../ui/icons/icons';
import {
  buildReservationsCalendar,
  shiftMonth,
  type CalendarDay,
  type CalendarEvent,
} from './my-reservations-view';
import styles from './my-reservations.module.css';

const WEEKDAY_KEYS = [
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
  'weekdaySun',
] as const;

function eventType(event: CalendarEvent): 'parking' | 'desk' {
  switch (event.kind) {
    case 'parking':
    case 'waitlist':
      return 'parking';
    case 'desk':
    case 'permanent':
    case 'released':
    case 'request':
      return 'desk';
  }
}

export function ReservationsCalendar() {
  const t = useTranslations('myReservations');
  const kinds = useTranslations('myDesks');
  const bulk = useTranslations('bulk');
  const shell = useTranslations('shell');
  const f = useDateFormatters();
  const api = useApi();
  const { status } = useRequireAuth();
  const enabled = status === 'authenticated';
  const today = todayInPrague();
  const [anchor, setAnchor] = useState<DateOnly>(() => shiftMonth(today, 0));

  const month = useQuery({
    ...api.reservation.myMonth.queryOptions({ input: { month: toYearMonth(anchor) } }),
    enabled,
  });
  const desks = useQuery({ ...api.desk.myReservations.queryOptions(), enabled });
  const requests = useQuery({ ...api.desk.myRequests.queryOptions(), enabled });
  const releases = useQuery({ ...api.desk.myReleases.queryOptions(), enabled });

  // Parking month and desk reservations are what the calendar is about, so they block it.
  // Desk requests and releases only add events: if they fail the calendar still renders,
  // with a notice. Month navigation stays outside the guard so a failed month can be left.
  const blocking = [month, desks];
  const failed = blocking.find((query) => query.isError);
  const optional = [requests, releases];
  const optionalFailed = optional.some((query) => query.isError);
  const state: ScreenData<null> = failed
    ? { kind: 'error', error: failed.error }
    : [...blocking, ...optional].some((query) => query.data === undefined && !query.isError)
      ? { kind: 'loading' }
      : { kind: 'ready', data: null };

  function eventLabel(event: CalendarEvent): string {
    switch (event.kind) {
      case 'parking':
        return event.label;
      case 'waitlist':
        return t('eventWaitlist', { label: event.label, position: event.position });
      case 'desk':
      case 'permanent':
        return event.code;
      case 'released':
        return t('eventReleased', { code: event.code });
      case 'request':
        return t('eventRequest', { code: event.code, status: t(`request${event.status}`) });
    }
  }

  function renderEvents(day: CalendarDay) {
    return (
      <ul className={styles.events}>
        {day.events.map((event, index) => (
          <li
            key={`${event.kind}-${String(index)}`}
            className={styles.event}
            data-kind={event.kind}
            data-type={eventType(event)}
          >
            {eventType(event) === 'parking' ? (
              <CarIcon label={kinds('kindParking')} />
            ) : (
              <DeskIcon label={kinds('kindDesk')} />
            )}
            <span>{eventLabel(event)}</span>
          </li>
        ))}
        {day.parkingWithoutDesk ? (
          <li className={styles.event} data-kind="warning">
            <WarningIcon />
            <span>{t('warningNoDesk')}</span>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <Stack gap="md">
      <div className={styles.calendarNav}>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('calPrev')}
          onClick={() => setAnchor(shiftMonth(anchor, -1))}
        >
          ‹
        </Button>
        <Strong>{f.monthAndYear(anchor)}</Strong>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('calNext')}
          onClick={() => setAnchor(shiftMonth(anchor, 1))}
        >
          ›
        </Button>
      </div>
      <ScreenDataGuard
        state={state}
        onRetry={() => [...blocking, ...optional].forEach((query) => void query.refetch())}
        headingLevel={3}
      >
        {() => {
          const calendar = buildReservationsCalendar(
            anchor,
            {
              parking: month.data?.reservations ?? [],
              waitlist: month.data?.waitlist ?? [],
              reservations: desks.data?.reservations ?? [],
              requests: requests.data?.requests ?? [],
              permanent: releases.data ?? null,
              // Without the releases we cannot tell whether a permanent holder has a desk.
              warnNoDesk: !releases.isError,
            },
            today
          );
          return (
            <Stack gap="md">
              {optionalFailed ? (
                <Text appearance="sm" variant="tertiary" role="status">
                  {t('calendarPartialError')}{' '}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => optional.forEach((query) => void query.refetch())}
                  >
                    {shell('retry')}
                  </Button>
                </Text>
              ) : null}

              <div role="grid" aria-label={t('calendarLabel')} className={styles.calendar}>
                <div role="row" className={styles.calendarRow}>
                  {WEEKDAY_KEYS.map((key) => (
                    <div key={key} role="columnheader" className={styles.weekday}>
                      {bulk(key)}
                    </div>
                  ))}
                </div>
                {calendar.weeks.map((week) => (
                  <div key={week.key} role="row" className={styles.calendarRow}>
                    {week.slots.map((slot) => (
                      <div
                        key={slot.key}
                        role="gridcell"
                        className={styles.cell}
                        data-empty={slot.day === null}
                        data-today={slot.day?.isToday}
                        data-off={slot.day?.isOff}
                        data-past={slot.day?.isPast}
                        data-warning={slot.day?.parkingWithoutDesk}
                      >
                        {slot.day === null ? null : (
                          <>
                            <span className={styles.cellDay}>{slot.day.day}</span>
                            {renderEvents(slot.day)}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className={styles.agenda} aria-label={t('agendaLabel')} role="region">
                {calendar.agenda.length === 0 ? (
                  <Text variant="tertiary">{t('agendaEmpty')}</Text>
                ) : (
                  <ul className={styles.rows}>
                    {calendar.agenda.map((day) => (
                      <li
                        key={day.date}
                        className={styles.row}
                        data-today={day.isToday}
                        data-warning={day.parkingWithoutDesk}
                      >
                        <div className={styles.rowMain}>
                          <Strong>{f.fullDate(day.date)}</Strong>
                          {renderEvents(day)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Text appearance="sm" variant="tertiary">
                {t('calendarHint')}
              </Text>
            </Stack>
          );
        }}
      </ScreenDataGuard>
    </Stack>
  );
}
