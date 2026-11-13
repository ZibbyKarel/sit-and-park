'use client';

/** Previous / date / next / today for the two desk admin screens; the date picker is the lot's. */

import { useState } from 'react';
import { Button } from '@shoptet/ui';
import {
  nextWeekday,
  parseDateOnly,
  previousWeekday,
  todayInPrague,
  useDateFormatters,
  type DateOnly,
} from '@sit-and-park/i18n';
import { DatePickerDialog } from '../../../lot/date-picker-dialog/date-picker-dialog';
import styles from './admin-desks-screen.module.css';

const YEAR_PICKER_RADIUS = 1;

export interface AdminDayBarProps {
  readonly date: DateOnly;
  readonly onChange: (date: DateOnly) => void;
  readonly labels: { previous: string; next: string; today: string };
}

export function AdminDayBar({ date, onChange, labels }: AdminDayBarProps) {
  const f = useDateFormatters();
  const [open, setOpen] = useState(false);
  const year = parseDateOnly(date).year;
  const years = Array.from(
    { length: YEAR_PICKER_RADIUS * 2 + 1 },
    (_unused, index) => year - YEAR_PICKER_RADIUS + index
  );

  return (
    <div className={styles.group}>
      <Button
        variant="secondary"
        size="sm"
        aria-label={labels.previous}
        onClick={() => onChange(previousWeekday(date))}
      >
        ‹
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {f.fullDate(date)}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        aria-label={labels.next}
        onClick={() => onChange(nextWeekday(date))}
      >
        ›
      </Button>
      <Button variant="secondary" size="sm" onClick={() => onChange(todayInPrague())}>
        {labels.today}
      </Button>
      <DatePickerDialog
        open={open}
        onClose={() => setOpen(false)}
        selectedDate={date}
        years={years}
        onSelect={(selected) => {
          onChange(selected);
          setOpen(false);
        }}
      />
    </div>
  );
}
