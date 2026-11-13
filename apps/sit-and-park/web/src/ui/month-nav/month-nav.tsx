'use client';

/**
 * ‹ / month select / year select / › — one month switcher for every calendar.
 * Domain-free: labels arrive as props, and `onChange` receives the new anchor
 * (the old one moved by whole months, so the day-of-month is whatever
 * `addMonths` keeps).
 */

import { Button } from '@shoptet/ui';
import { addMonths, parseDateOnly, useDateFormatters, type DateOnly } from '@sit-and-park/i18n';
import { SingleSelect } from '../client-select/client-select';
import styles from './month-nav.module.css';

export interface MonthNavProps {
  /** Any day in the shown month. */
  readonly anchor: DateOnly;
  readonly years: readonly number[];
  /** Receives `addMonths(anchor, delta)`. */
  readonly onChange: (anchor: DateOnly) => void;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly monthLabel: string;
  readonly yearLabel: string;
}

const MONTHS_IN_YEAR = 12;

interface NumberOption {
  readonly value: number;
  readonly label: string;
}

const getOptionValue = (option: NumberOption) => option.value;
const getOptionLabel = (option: NumberOption) => option.label;

export function MonthNav({
  anchor,
  years,
  onChange,
  previousLabel,
  nextLabel,
  monthLabel,
  yearLabel,
}: MonthNavProps) {
  const f = useDateFormatters();
  const parts = parseDateOnly(anchor);
  const monthOptions = Array.from({ length: MONTHS_IN_YEAR }, (_unused, index) => ({
    value: index + 1,
    label: f.monthName(index + 1),
  }));
  const yearOptions = years.map((year) => ({ value: year, label: String(year) }));

  return (
    <div className={styles.nav}>
      <Button
        variant="secondary"
        size="sm"
        aria-label={previousLabel}
        onClick={() => {
          onChange(addMonths(anchor, -1));
        }}
      >
        ‹
      </Button>
      <div className={styles.grow}>
        <SingleSelect
          label={monthLabel}
          value={parts.month}
          options={monthOptions}
          getOptionValue={getOptionValue}
          getOptionLabel={getOptionLabel}
          onChange={(month) => {
            if (month === null) return;
            onChange(addMonths(anchor, month - parts.month));
          }}
        />
      </div>
      <SingleSelect
        label={yearLabel}
        value={parts.year}
        options={yearOptions}
        getOptionValue={getOptionValue}
        getOptionLabel={getOptionLabel}
        onChange={(year) => {
          if (year === null) return;
          onChange(addMonths(anchor, (year - parts.year) * MONTHS_IN_YEAR));
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        aria-label={nextLabel}
        onClick={() => {
          onChange(addMonths(anchor, 1));
        }}
      >
        ›
      </Button>
    </div>
  );
}
