'use client';

/**
 * {@link DatePickerDialog} — the calendar the header's date pill opens.
 *
 * The grid itself borrows `../bulk-modal/bulk-modal.tsx`'s table: a `<caption>` for the
 * accessible name, weekday heads, and a button per day. What differs is the
 * rule a cell obeys — since this dialog only navigates the lot screen and
 * never books, a past day or a Czech holiday is pickable here, with weekends
 * the one exception (see `./date-picker-view.ts`) — which is exactly why the
 * layout moved to `../calendar-grid.ts` rather than this file reaching into
 * `../bulk-modal/bulk-view.ts` for a grid shaped by booking rules that do not apply here.
 *
 * Picking a day calls `onSelect` with nothing further: the caller (`../lot-header/lot-header.tsx`
 * via `../lot-screen/lot-screen.tsx`) decides that choosing a day also closes the dialog,
 * the same way a click in `../bulk-modal/bulk-modal.tsx`'s grid never closes anything —
 * the two dialogs simply differ on that point, and neither should guess the
 * other's convention.
 */

import { useState } from 'react';
import { Modal } from '@shoptet/ui';
import { MonthNav } from '../../ui/month-nav/month-nav';
import { ToggleTile } from '../../ui/toggle-tile/toggle-tile';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import {
  startOfMonth,
  todayInPrague,
  useDateFormatters,
  useTranslations,
  type DateOnly,
} from '@sit-and-park/i18n';
import { buildDatePickerGrid } from './date-picker-view';
import styles from './date-picker-dialog.module.css';

export interface DatePickerDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The lot screen's own day — seeds the month on open and marks its cell. */
  readonly selectedDate: DateOnly;
  /** Years offered in the year selector, ascending. */
  readonly years: readonly number[];
  readonly onSelect: (date: DateOnly) => void;
}

/**
 * Keyed on `open` and `selectedDate` for the same reason
 * `BulkReservationModal` keys its content on opening: a passive effect
 * resetting the browsed month would still see the previous state in the
 * render where `open` flips back to `true`, and re-mounting avoids that class
 * of bug by construction instead of by effect ordering.
 */
export function DatePickerDialog(props: DatePickerDialogProps) {
  return <DatePickerDialogContent key={`${String(props.open)}-${props.selectedDate}`} {...props} />;
}

function DatePickerDialogContent({
  open,
  onClose,
  selectedDate,
  years,
  onSelect,
}: DatePickerDialogProps) {
  const t = useTranslations('lot');
  const f = useDateFormatters();
  const [viewAnchor, setViewAnchor] = useState<DateOnly>(() => startOfMonth(selectedDate));

  const today = todayInPrague();
  const grid = buildDatePickerGrid(viewAnchor, selectedDate);

  const WEEKDAY_KEYS = [
    'weekdayMon',
    'weekdayTue',
    'weekdayWed',
    'weekdayThu',
    'weekdayFri',
    'weekdaySat',
    'weekdaySun',
  ] as const;

  return (
    <Modal isOpen={open} onClose={onClose}>
      <Modal.Header>{t('datePickerTitle')}</Modal.Header>
      <Modal.Content>
        <div className={styles.nav}>
          <MonthNav
            anchor={viewAnchor}
            years={years}
            onChange={setViewAnchor}
            previousLabel={t('previousDay')}
            nextLabel={t('nextDay')}
            monthLabel={t('monthLabel')}
            yearLabel={t('yearLabel')}
          />
        </div>

        <table className="calendar-grid">
          <VisuallyHidden as="caption">{t('gridLabel')}</VisuallyHidden>
          <thead>
            <tr>
              {WEEKDAY_KEYS.map((key) => (
                <th key={key} scope="col">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.weeks.map((week) => (
              <tr key={week.key}>
                {week.slots.map(({ key, day }) =>
                  day === null ? (
                    <td key={key} />
                  ) : (
                    <td key={key}>
                      <ToggleTile
                        shape="cell"
                        today={day.date === today}
                        selected={day.selected}
                        selectable={day.selectable}
                        aria-pressed={day.selectable ? day.selected : undefined}
                        aria-label={
                          day.selectable
                            ? t('dayCell', { date: f.fullDate(day.date) })
                            : t('dayCellBlocked', { date: f.fullDate(day.date) })
                        }
                        onClick={() => {
                          onSelect(day.date);
                        }}
                      >
                        {day.dayOfMonth}
                      </ToggleTile>
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Modal.Content>
    </Modal>
  );
}
