'use client';

/** Admin desk statistics for one day: stat tiles, a per-zone and a per-office table. */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from '@garage/i18n';
import { useSession } from '@garage/auth/client';
import type { AdminDeskStatsOutput } from '@garage/contract';
import { useApi } from '../../api-provider/api-provider';
import { ScreenError, ScreenLoading } from '../../screen-state/screen-state';
import { useDateInUrl } from '../../../lot/lot-screen/use-date-in-url';
import { DataTable } from '../../../ui/data-table/data-table';
import { VisuallyHidden } from '../../../ui/visually-hidden/visually-hidden';
import { AdminDayBar } from '../admin-desks-screen/admin-day-bar';
import { OptionSelect, type Option } from '../admin-desks-screen/option-select';
import styles from './admin-desk-stats-screen.module.css';

const ALL = 'all';

type TileKey =
  | 'tileOccupancy'
  | 'tileBookable'
  | 'tileReserved'
  | 'tileFree'
  | 'tileInactive'
  | 'tilePermanent'
  | 'tileHives'
  | 'tilePending';
type ByZone = AdminDeskStatsOutput['byZone'][number];
type ByOffice = AdminDeskStatsOutput['byOffice'][number];

export function AdminDeskStatsScreen() {
  const t = useTranslations('adminDeskStats');
  const api = useApi();
  const { status } = useSession();
  const [date, setDate] = useDateInUrl();
  const [officeId, setOfficeId] = useState<string>(ALL);

  const officesQuery = useQuery({
    ...api.admin.office.list.queryOptions(),
    enabled: status === 'authenticated',
  });
  const statsQuery = useQuery({
    ...api.admin.desk.stats.queryOptions({
      input: { date, ...(officeId === ALL ? {} : { officeId }) },
    }),
    enabled: status === 'authenticated',
  });

  const header = (
    <div className={styles.header}>
      <AdminDayBar
        date={date}
        onChange={setDate}
        labels={{ previous: t('previousDay'), next: t('nextDay'), today: t('today') }}
      />
      <OptionSelect
        label={t('officeFilter')}
        options={[
          { value: ALL, label: t('officeAll') },
          ...(officesQuery.data?.offices ?? []).map(
            (o): Option => ({ value: o.id, label: o.name })
          ),
        ]}
        value={officeId}
        onChange={(value) => setOfficeId(value ?? ALL)}
      />
    </div>
  );

  if (statsQuery.isError) {
    return (
      <>
        {header}
        <ScreenError
          error={statsQuery.error}
          onRetry={() => void statsQuery.refetch()}
          headingLevel={3}
        />
      </>
    );
  }
  const stats = statsQuery.data;
  if (stats === undefined) return <ScreenLoading />;

  const tiles: [key: TileKey, value: string][] = [
    ['tileOccupancy', t('percent', { value: stats.occupancyPercent })],
    ['tileBookable', String(stats.bookableOnDate)],
    ['tileReserved', String(stats.reservedOnDate)],
    ['tileFree', String(stats.freeOnDate)],
    ['tileInactive', String(stats.inactiveDesks)],
    ['tilePermanent', String(stats.permanentAssignments)],
    ['tileHives', String(stats.hiveCount)],
    ['tilePending', String(stats.pendingApprovals)],
  ];
  const officeName = (id: string) =>
    stats.byOffice.find((o) => o.officeId === id)?.officeName ?? '';
  const showOffice = stats.byOffice.length > 1;

  return (
    <>
      <VisuallyHidden as="h2">{t('title')}</VisuallyHidden>
      {header}

      <dl className={styles.tiles}>
        {tiles.map(([key, value]) => (
          <div key={key} className={styles.tile}>
            <dt>{t(key)}</dt>
            <dd>{value}</dd>
            {key === 'tileOccupancy' ? (
              <div
                className={styles.bar}
                role="progressbar"
                aria-label={t('tileOccupancy')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={stats.occupancyPercent}
              >
                <div className={styles.barFill} style={{ width: `${stats.occupancyPercent}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </dl>

      <div className={styles.tables}>
        <DataTable<ByZone>
          title={t('zonesTitle')}
          columns={[
            {
              id: 'zone',
              header: t('columnZone'),
              cell: (z) => z.zoneName,
              sortValue: (z) => z.zoneName,
            },
            ...(showOffice
              ? [
                  {
                    id: 'office',
                    header: t('columnOffice'),
                    cell: (z: ByZone) => officeName(z.officeId),
                    sortValue: (z: ByZone) => officeName(z.officeId),
                  },
                ]
              : []),
            {
              id: 'desks',
              header: t('columnDesks'),
              align: 'end',
              cell: (z) => z.desks,
              sortValue: (z) => z.desks,
            },
            {
              id: 'free',
              header: t('columnFree'),
              align: 'end',
              cell: (z) => z.free,
              sortValue: (z) => z.free,
            },
            {
              id: 'reserved',
              header: t('columnReserved'),
              align: 'end',
              cell: (z) => z.reserved,
              sortValue: (z) => z.reserved,
            },
            {
              id: 'unavailable',
              header: t('columnUnavailable'),
              align: 'end',
              cell: (z) => z.unavailable,
              sortValue: (z) => z.unavailable,
            },
          ]}
          data={stats.byZone}
          getRowId={(zone) => zone.zoneId}
          emptyTitle={t('zonesEmpty')}
        />
        <DataTable<ByOffice>
          title={t('officesTitle')}
          columns={[
            {
              id: 'office',
              header: t('columnOffice'),
              cell: (o) => o.officeName,
              sortValue: (o) => o.officeName,
            },
            {
              id: 'desks',
              header: t('columnDesks'),
              align: 'end',
              cell: (o) => o.desks,
              sortValue: (o) => o.desks,
            },
            {
              id: 'reserved',
              header: t('columnReserved'),
              align: 'end',
              cell: (o) => o.reservedOnDate,
              sortValue: (o) => o.reservedOnDate,
            },
          ]}
          data={stats.byOffice}
          getRowId={(office) => office.officeId}
          emptyTitle={t('officesEmpty')}
        />
      </div>
    </>
  );
}
