'use client';

/**
 * The map: asphalt, painted lines, and one bay per parking spot.
 *
 * **Presentational.** Props in, callbacks out, no fetching and no query cache
 * — every decision arrived already made, as a `SpotGroupView` from
 * `./lot-view`. The map's paint and geometry are the `.lot-*` classes and
 * `--lot-*` custom properties in `app/global.css`.
 */

import { useTranslations } from '@garage/i18n';
import type { SpotGroupView } from '../lot-view';
import { SpotTile } from './spot-tile';
import styles from './lot-grid.module.css';

export interface LotGridProps {
  readonly groups: readonly SpotGroupView[];
  readonly onOpenSpot: (spotId: string) => void;
  readonly onAdminOpenSpot: (spotId: string) => void;
}

/** The whole map: one labelled band per group, then the legend. */
export function LotGrid({ groups, onOpenSpot, onAdminOpenSpot }: LotGridProps) {
  const t = useTranslations('lot');

  return (
    <div className="lot-asphalt">
      {groups.map((group) => (
        <section
          key={group.group}
          aria-label={t('groupLabel', { group: group.group })}
          className="lot-group-panel"
        >
          <div className={styles.band}>
            <div className={styles.heading}>
              <h2 className={styles.groupName}>{group.group}</h2>
              <span aria-hidden="true" className="lot-group-rule" />
              <span className={styles.free}>
                {t('groupFree', { free: group.freeCount, total: group.totalCount })}
              </span>
            </div>

            <div className="lot-bay-row">
              {group.spots.map((spot) => (
                <SpotTile
                  key={spot.spotId}
                  spot={spot}
                  onOpen={onOpenSpot}
                  onAdminOpen={onAdminOpenSpot}
                />
              ))}
            </div>
          </div>
        </section>
      ))}

      <ul className={styles.legend}>
        <li className={styles.legendItem}>
          <span aria-hidden="true" className="lot-swatch lot-swatch--taken" />
          <span className={styles.legendText}>{t('legendTaken')}</span>
        </li>
        <li className={styles.legendItem}>
          <span aria-hidden="true" className="lot-swatch lot-swatch--free" />
          <span className={styles.legendText}>{t('legendFree')}</span>
        </li>
        <li className={styles.legendItem}>
          <span aria-hidden="true" className="lot-swatch lot-swatch--waitlist" />
          <span className={styles.legendText}>{t('legendWaitlist')}</span>
        </li>
      </ul>
    </div>
  );
}
