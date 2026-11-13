'use client';

import { useId } from 'react';
import type { ParkingSpot } from '@sit-and-park/contract';
import { Text } from '@shoptet/ui';
import { Chip } from '../../../ui/chip/chip';
import { useTranslations } from '@sit-and-park/i18n';
import styles from './category-band.module.css';
import { toCategoryCounts } from './spots-view';

/**
 * The band under the table header: one chip per category with its count.
 *
 * What is counted, and why inactive spots are in it, is
 * {@link toCategoryCounts}.
 */
export function CategoryBand({ spots }: { readonly spots: readonly ParkingSpot[] }) {
  const t = useTranslations('admin');
  const labelId = useId();

  return (
    // A named group, so the band is distinguishable from the table's own
    // "Kategorie" column heading — to a screen reader as much as to a test.
    <div role="group" aria-labelledby={labelId} className={styles.band}>
      <span id={labelId} className={styles.label}>
        <Text appearance="strong-sm" variant="tertiary">
          {t('spotsCategories')}
        </Text>
      </span>
      {toCategoryCounts(spots).map(({ group, count }) => (
        <Chip key={group} size="sm" tone="muted" weight="medium">
          {group}
          <Text variant="tertiary">{count}</Text>
        </Chip>
      ))}
      <Text appearance="sm" variant="tertiary">
        {t('spotsCategoriesFixed')}
      </Text>
    </div>
  );
}
