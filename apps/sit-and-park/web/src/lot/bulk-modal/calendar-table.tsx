'use client';

import { useDateFormatters } from '@sit-and-park/i18n';
import type { useTranslations } from '@sit-and-park/i18n';
import { Tag } from '@shoptet/ui';
import {
  toBadgeMessage,
  toScheduleRows,
  type BulkBadgeView,
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
}

export function CalendarTable({ days, t }: CalendarTableProps) {
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
            {row.spotLabel === null ? null : (
              <strong className={styles.spotLabel}>{row.spotLabel}</strong>
            )}
            <Tag level={BADGE_LEVELS[row.badge.kind]}>{badgeLabel(row.badge, t)}</Tag>
          </span>
        </li>
      ))}
    </ul>
  );
}
