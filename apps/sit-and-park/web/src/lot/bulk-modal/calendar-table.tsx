'use client';

import { useDateFormatters, type DateOnly } from '@sit-and-park/i18n';
import type { useTranslations } from '@sit-and-park/i18n';
import { Tag } from '@shoptet/ui';
import type { PreviewBulkOutput } from '@sit-and-park/contract';
import { SingleSelect } from '../../ui/client-select/client-select';
import {
  toBadgeMessage,
  toScheduleRows,
  type BulkBadgeView,
  type BulkScheduleRowView,
  type BulkDayOutcomeView,
} from './bulk-view';
import styles from './bulk-modal.module.css';

const BADGE_LEVELS = {
  ASSIGNED_PREFERRED: 'success',
  ASSIGNED: 'notice',
  QUEUED: 'alert',
  UNAVAILABLE: 'default',
} as const satisfies Record<BulkBadgeView['kind'], 'default' | 'success' | 'notice' | 'alert'>;

export function badgeLabel(badge: BulkBadgeView, t: ReturnType<typeof useTranslations>): string {
  const message = toBadgeMessage(badge);
  return t(message.messageKey, message.values);
}

/**
 * The schedule a batch of days resolves to — `reservation.previewBulk`'s
 * proposal and `reservation.confirmBulk`'s result both print the same rows
 * through this component, so the two steps of the bulk-reservation modal
 * (`./bulk-modal.tsx`) quote the same rendering rather than each keeping
 * its own copy.
 */
export interface CalendarTableProps {
  readonly days: readonly BulkDayOutcomeView[];
  readonly t: ReturnType<typeof useTranslations>;
  /**
   * Turns the spot label of an assigned or queued row into a select. Only the
   * proposal step passes it; the result step prints plain text.
   */
  readonly picker?: {
    readonly isAdmin: boolean;
    readonly freeSpots: PreviewBulkOutput['freeSpots'];
    /** Date → chosen spot id, for days the admin changed. */
    readonly choices: Readonly<Record<DateOnly, string>>;
    readonly onChoose: (date: DateOnly, parkingSpotId: string) => void;
  };
}

export function CalendarTable({ days, t, picker }: CalendarTableProps) {
  const f = useDateFormatters();
  // No empty-list branch: both procedures answer one entry per requested day
  // and the call to action is disabled at zero selection, so `rows` cannot be
  // empty. A branch that cannot render is copy nobody will ever proof-read
  // (`doc/decision/0021-*`'s unreachable-member rule, applied to a catalog).
  // Only a preview that filtered days out of its response would change that.
  const rows = toScheduleRows(days);
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <li key={row.date} className={styles.row}>
          <span>
            {f.dayAndMonth(row.date)} · {f.weekdayName(row.date)}
          </span>
          <span className={styles.rowSide}>
            {row.spotLabel === null ? null : picker === undefined ? (
              <strong className={styles.spotLabel}>{row.spotLabel}</strong>
            ) : (
              <SpotSelect row={row} days={days} picker={picker} t={t} />
            )}
            <Tag level={BADGE_LEVELS[row.badge.kind]}>{badgeLabel(row.badge, t)}</Tag>
          </span>
        </li>
      ))}
    </ul>
  );
}

function SpotSelect({
  row,
  days,
  picker,
  t,
}: {
  readonly row: BulkScheduleRowView;
  readonly days: readonly BulkDayOutcomeView[];
  readonly picker: NonNullable<CalendarTableProps['picker']>;
  readonly t: ReturnType<typeof useTranslations>;
}) {
  const f = useDateFormatters();
  const day = days.find((d) => d.date === row.date);
  if (day === undefined || day.outcome === 'UNAVAILABLE') {
    return null;
  }
  // For assigned days the proposed spot is already in `freeSpots` (the
  // allocator lists free spots before allocating); for queued days it is not.
  // Putting it first and filtering it out of the rest covers both without a
  // duplicate option.
  const options = [
    { id: day.parkingSpotId, label: day.parkingSpotLabel },
    ...(picker.freeSpots.find((entry) => entry.date === row.date)?.spots ?? []).filter(
      (spot) => spot.id !== day.parkingSpotId
    ),
  ];
  return (
    <SingleSelect
      label={t('spotSelectLabel', { date: f.fullDate(row.date) })}
      options={options}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.label}
      value={picker.choices[row.date] ?? day.parkingSpotId}
      disabled={!picker.isAdmin}
      onChange={(value) => {
        if (value !== null) {
          picker.onChoose(row.date, value);
        }
      }}
    />
  );
}
