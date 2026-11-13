'use client';

/**
 * The "Přehled parkoviště" tab: an admin's read of one day
 * (`doc/design/screens/06-admin-overview.png`).
 *
 * ## What this renders, and what it deliberately does not
 *
 * The design for this tab is the **lot screen** — a page of its own, with the
 * painted car grid, the date bar along the bottom and no tab strip on it. That
 * screen belongs to Task 24 and is the only place the grid is drawn; building a
 * second one here would give the product two implementations of the same canvas
 * that could disagree about the same day. See
 * `doc/decision/0161-the-admin-day-tab-summarises-the-lot-it-does-not-redraw-it.md`.
 *
 * What is here instead is the part of that screen an admin actually needs while
 * they are in `/admin`, drawn out of pieces that already exist: the date, the
 * free/taken counts, the window banner, and one `DataTable` row per spot saying
 * who holds it and how many people are queued. The link at the top opens the lot
 * screen for the grid itself.
 *
 * Presentational: every value arrives as a prop, and nothing here fetches. The
 * connected half is `../admin-day-panel.tsx`, the same split as
 * `settings-screen.tsx` / `settings-page.tsx`.
 */

import type { DayOverviewOutput, DaySpotOverview } from '@sit-and-park/contract';
import { Button, H3, Stack, Tag, Text } from '@shoptet/ui';
import { Chip } from '../../../ui/chip/chip';
import { DataTable } from '../../../ui/data-table/data-table';
import type { DataTableColumn } from '../../../ui/data-table/data-table';
import { useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import type { DateOnly } from '@sit-and-park/i18n';
import { formatTimeRange } from '../../../lot/lot-view';
import { ScreenDataGuard } from '../../screen-state/screen-state';
import type { ScreenData } from '../../screen-state/screen-state';
import { WindowBanner } from '../window-banner/window-banner';
import styles from './admin-day-screen.module.css';

export interface AdminDayScreenProps {
  /** The day being shown, `YYYY-MM-DD` in Europe/Prague. */
  readonly date: DateOnly;
  /** The day itself, or the reason it is not on screen yet. */
  readonly day: ScreenData<DayOverviewOutput>;
  readonly onRetry: () => void;
  /**
   * Navigates to the lot screen, where the painted grid lives. A callback
   * rather than an `href` because this component stays free of the router —
   * see the split described at the top of the file.
   */
  readonly onOpenLot: () => void;
}

export function AdminDayScreen({ date, day, onRetry, onOpenLot }: AdminDayScreenProps) {
  const t = useTranslations('admin');
  const f = useDateFormatters();
  // `guestHolder` lives in the `lot` catalogue — the same badge the spot
  // dialog renders — because that is where the guest concept was introduced;
  // this table reuses the key rather than duplicating the copy under a second
  // one, in both catalogues.
  const tLot = useTranslations('lot');

  const columns: DataTableColumn<DaySpotOverview>[] = [
    {
      id: 'label',
      header: t('dayColumnLabel'),
      sortValue: (row) => row.spot.label,
      cell: (row) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Text appearance="strong-md">{row.spot.label}</Text>
          {row.spot.hidden ? (
            <Tag size="sm" level="default">
              {tLot('hiddenSpot')}
            </Tag>
          ) : null}
        </Stack>
      ),
    },
    {
      id: 'group',
      header: t('dayColumnGroup'),
      sortValue: (row) => row.spot.group,
      cell: (row) => <Text variant="secondary">{row.spot.group}</Text>,
    },
    {
      id: 'status',
      header: t('dayColumnStatus'),
      // Free sorts first, then a spot with guest blocks but no full-day
      // reservation, then taken rows sorted by holder — a plain boolean
      // would put every occupied-or-blocked spot in one undifferentiated
      // block.
      sortValue: (row) =>
        row.reservation !== null
          ? `2 ${row.reservation.holder.name.toLocaleLowerCase('cs-CZ')}`
          : row.timedReservations.length > 0
            ? '1'
            : '',
      cell: (row) =>
        row.reservation !== null ? (
          <Stack orientation="horizontal" align="center" gap="sm">
            <Text>{t('dayStatusTaken', { name: row.reservation.holder.name })}</Text>
            {row.reservation.holder.kind === 'GUEST' ? (
              <Tag size="sm" level="default" variant="secondary">
                {tLot('guestHolder')}
              </Tag>
            ) : null}
          </Stack>
        ) : row.timedReservations.length > 0 ? (
          <Text>
            {t('dayStatusTimed', {
              times: row.timedReservations.map((block) => formatTimeRange(block)).join(', '),
            })}
          </Text>
        ) : (
          <Text variant="tertiary">{t('dayStatusFree')}</Text>
        ),
    },
    {
      id: 'queue',
      header: t('dayColumnQueue'),
      align: 'end',
      sortValue: (row) => row.waitlistCount,
      cell: (row) =>
        row.waitlistCount === 0 ? (
          <Text variant="tertiary">{t('dayQueueNone')}</Text>
        ) : (
          <Tag level="alert">{t('dayQueueCount', { count: row.waitlistCount })}</Tag>
        ),
    },
  ];

  return (
    <ScreenDataGuard state={day} onRetry={onRetry} headingLevel={3}>
      {(overview) => {
        const free = overview.spots.filter(
          (row) => row.reservation === null && row.timedReservations.length === 0
        ).length;
        const taken = overview.spots.length - free;

        return (
          <Stack gap="xl">
            <div className={styles.header}>
              <Stack gap="xs">
                <span className={styles.eyebrow}>
                  <Text appearance="strong-sm" variant="tertiary">
                    {t('dayEyebrow')}
                  </Text>
                </span>
                <H3 appearance="h2">{f.fullDate(date)}</H3>
              </Stack>
              <div className={styles.summary}>
                <Chip size="lg" dot="green">
                  {t('dayFree', { count: free })}
                </Chip>
                <Chip size="lg" dot="blue">
                  {t('dayTaken', { count: taken })}
                </Chip>
                <Button variant="primary" onClick={onOpenLot}>
                  {t('dayOpenLot')}
                </Button>
              </div>
            </div>

            <WindowBanner window={overview.window} />

            <DataTable
              columns={columns}
              data={overview.spots}
              getRowId={(row) => row.spot.id}
              title={t('dayTableTitle')}
              description={t('dayTableDescription')}
              defaultSort={{ columnId: 'label', direction: 'asc' }}
              minWidth="640px"
              emptyTitle={t('dayEmpty')}
              emptyDescription={t('dayEmptyDescription')}
            />
          </Stack>
        );
      }}
    </ScreenDataGuard>
  );
}
