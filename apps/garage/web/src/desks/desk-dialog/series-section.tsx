'use client';

/**
 * Picking several days for one desk: a weekday repeat for N weeks and/or
 * single days, a live `desk.previewSeries` per day, and the submit.
 *
 * The date list is `toSeriesView`'s; the preview is asked only for a list the
 * contract accepts, so a shape error never reaches the API.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, CheckboxField, CounterField, DateField, SystemMessage } from '@shoptet/ui';
import {
  addDays,
  dayOfWeek,
  isDateOnly,
  MAX_DESK_SERIES_DATES,
  MAX_DESK_SERIES_SPAN_DAYS,
  useDateFormatters,
  useTranslations,
  type DateOnly,
} from '@garage/i18n';
import { useApi } from '../../shell/api-provider/api-provider';
import {
  DESK_SKIP_REASON_KEYS,
  MAX_SERIES_WEEKS,
  SERIES_WEEKDAYS,
  toSeriesView,
  type SeriesProblem,
} from '../desk-view';
import { useErrorCopy } from './use-error-copy';
import styles from './desk-dialog.module.css';

const PROBLEM_KEYS = {
  empty: 'seriesProblemEmpty',
  tooMany: 'seriesProblemTooMany',
  tooLong: 'seriesProblemTooLong',
} as const satisfies Record<SeriesProblem, string>;

export interface SeriesSectionProps {
  readonly deskId: string;
  readonly start: DateOnly;
  readonly pending: boolean;
  readonly onSubmit: (dates: DateOnly[]) => void;
}

export function SeriesSection({ deskId, start, pending, onSubmit }: SeriesSectionProps) {
  const t = useTranslations('desks');
  const f = useDateFormatters();
  const errorCopy = useErrorCopy();
  const api = useApi();

  const [weekdays, setWeekdays] = useState<number[]>(() =>
    dayOfWeek(start) <= 5 ? [dayOfWeek(start)] : []
  );
  const [weeks, setWeeks] = useState(1);
  const [extraDates, setExtraDates] = useState<DateOnly[]>([]);
  const [extraInput, setExtraInput] = useState<string | null>(null);

  const series = useMemo(
    () => toSeriesView({ start, weekdays, weeks, extraDates }),
    [start, weekdays, weeks, extraDates]
  );

  const preview = useQuery({
    ...api.desk.previewSeries.queryOptions({ input: { deskId, dates: series.dates } }),
    enabled: series.problem === null,
  });

  const okCount = preview.data?.days.filter((day) => day.ok).length ?? 0;

  return (
    <section className={styles.section} aria-labelledby="desk-series-heading">
      <h3 id="desk-series-heading" className={styles.heading}>
        {t('seriesHeading')}
      </h3>

      <fieldset className={styles.weekdays}>
        <legend className={styles.legend}>{t('seriesWeekdays')}</legend>
        {SERIES_WEEKDAYS.map((weekday) => (
          <CheckboxField
            key={weekday}
            label={f.weekdayName(addDays(start, (weekday - dayOfWeek(start) + 7) % 7))}
            checked={weekdays.includes(weekday)}
            onChange={(checked) =>
              setWeekdays((current) =>
                checked ? [...current, weekday] : current.filter((day) => day !== weekday)
              )
            }
          />
        ))}
      </fieldset>

      <CounterField
        label={t('seriesWeeks')}
        value={weeks}
        min={1}
        max={MAX_SERIES_WEEKS}
        onChange={(next) => setWeeks(Math.min(Math.max(next ?? 1, 1), MAX_SERIES_WEEKS))}
      />

      <div className={styles.extra}>
        <DateField
          label={t('seriesExtraDate')}
          value={extraInput}
          onChange={(value) => setExtraInput(value)}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!isDateOnly(extraInput)}
          onClick={() => {
            if (!isDateOnly(extraInput)) return;
            setExtraDates((current) =>
              current.includes(extraInput) ? current : [...current, extraInput]
            );
            setExtraInput(null);
          }}
        >
          {t('seriesAddDate')}
        </Button>
      </div>
      {extraDates.length > 0 ? (
        <ul className={styles.list}>
          {extraDates.map((date) => (
            <li key={date} className={styles.row}>
              {f.fullDate(date)}
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('seriesRemoveDate', { date: f.fullDate(date) })}
                onClick={() => setExtraDates((current) => current.filter((d) => d !== date))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {series.problem !== null ? (
        <SystemMessage
          level="alert"
          description={t(PROBLEM_KEYS[series.problem], {
            max: series.problem === 'tooLong' ? MAX_DESK_SERIES_SPAN_DAYS : MAX_DESK_SERIES_DATES,
          })}
        />
      ) : preview.isError ? (
        <SystemMessage level="alert" description={errorCopy(preview.error)} />
      ) : (
        <>
          <h4 className={styles.heading}>{t('seriesPreviewHeading')}</h4>
          <ul className={styles.list} aria-busy={preview.isPending}>
            {(preview.data?.days ?? []).map((day) => (
              <li key={day.date} className={styles.row} data-ok={day.ok ? '' : undefined}>
                <span>{f.fullDate(day.date)}</span>
                <span className={styles.muted}>
                  {day.reason === null ? t('seriesDayOk') : t(DESK_SKIP_REASON_KEYS[day.reason])}
                </span>
              </li>
            ))}
          </ul>
          <Button
            isLoading={pending}
            disabled={preview.isPending || okCount === 0}
            onClick={() => onSubmit(series.dates)}
          >
            {t('seriesSubmit', { count: okCount })}
          </Button>
        </>
      )}
    </section>
  );
}
