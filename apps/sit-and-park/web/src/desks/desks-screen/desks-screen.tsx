'use client';

/**
 * Desks for one day — the connected screen. Owns the day (in the URL, like
 * the parking overview), reads `desk.directory`, keeps it live through the
 * day room, and hands plain data to the floor plan, the list and the dialog.
 * Every rule is a pure function in `../desk-view`.
 */

import { useCallback, useMemo, useState } from 'react';
import NextLink from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, CheckboxField, SystemMessage, Tabs } from '@shoptet/ui';
import { SingleSelectField } from '../../ui/client-select/client-select';
import {
  compareDateOnly,
  nextWeekday,
  parseDateOnly,
  previousWeekday,
  todayInPrague,
  useDateFormatters,
  useTranslations,
} from '@sit-and-park/i18n';
import { useSession } from '@sit-and-park/auth/client';
import { toContractError } from '@sit-and-park/api-client';
import type { DirectoryDesk } from '@sit-and-park/contract';
import { useApi } from '../../shell/api-provider/api-provider';
import { useCurrentUser } from '../../shell/use-current-user';
import { EmptyState, ScreenError, ScreenLoading } from '../../shell/screen-state/screen-state';
import { useDateInUrl } from '../../lot/lot-screen/use-date-in-url';
import { DatePickerDialog } from '../../lot/date-picker-dialog/date-picker-dialog';
import { FloorPlan } from '../../ui/floor-plan/floor-plan';
import { DataTable, type DataTableColumn } from '../../ui/data-table/data-table';
import { Chip } from '../../ui/chip/chip';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import { MY_RESERVATIONS_ROUTE } from '../../routes';
import { DeskDialog } from '../desk-dialog/desk-dialog';
import { DeskBulkModal } from '../desk-bulk-modal/desk-bulk-modal';
import { useErrorCopy } from '../desk-dialog/use-error-copy';
import {
  DESK_STATUS_KEYS,
  DESK_STATUS_ORDER,
  DESK_TONES,
  EMPTY_DESK_FILTER,
  matchesDeskFilter,
  toDeskBannerView,
  toDeskShapes,
  toFloorPlanView,
  type DeskFilter,
} from '../desk-view';
import { useDeskRealtime } from './use-desk-realtime';
import styles from './desks-screen.module.css';

const YEAR_PICKER_RADIUS = 1;
/** The "any" option of a select; a filter stores it as `''`. */
const ALL = 'all';

type View = 'plan' | 'list';

interface Option {
  readonly value: string;
  readonly label: string;
}

export function DesksScreen() {
  const t = useTranslations('desks');
  const errors = useTranslations('errors');
  const mine = useTranslations('myDesks');
  const f = useDateFormatters();
  const errorCopy = useErrorCopy();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const currentUser = useCurrentUser().data;
  const isAdmin = currentUser?.role === 'ADMIN';
  const viewerUserId = currentUser?.id ?? null;

  const [date, setDate] = useDateInUrl();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filter, setFilter] = useState<DeskFilter>(EMPTY_DESK_FILTER);
  const [openDeskId, setOpenDeskId] = useState<string | null>(null);
  const [view, setView] = useState<View>('plan');
  const [bulkOpen, setBulkOpen] = useState(false);
  // Admin only: desks ticked for bulk booking (Ctrl/Cmd-click or the list checkbox).
  const [pool, setPool] = useState<readonly string[]>([]);

  const directoryQuery = useQuery({
    ...api.desk.directory.queryOptions({ input: { date } }),
    // Same gate and reason as `LotScreen`'s day query.
    enabled: sessionStatus === 'authenticated',
  });
  const directory = directoryQuery.data ?? null;
  useDeskRealtime(date);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: api.desk.key() });
  }, [api, queryClient]);

  const cancelToday = useMutation({
    ...api.desk.cancel.mutationOptions(),
    onSuccess: refresh,
  });

  const desks = useMemo(() => directory?.desks ?? [], [directory]);
  const ariaLabel = useCallback(
    (desk: DirectoryDesk) => {
      const status = t(DESK_STATUS_KEYS[desk.status]);
      return desk.hiveName === null
        ? t('deskAria', { code: desk.code, status })
        : t('deskAriaHive', { code: desk.code, status, hive: desk.hiveName });
    },
    [t]
  );
  const shapes = useMemo(() => toDeskShapes(desks, filter, ariaLabel), [desks, filter, ariaLabel]);
  const listed = useMemo(
    () => desks.filter((desk) => matchesDeskFilter(desk, filter)),
    [desks, filter]
  );
  const banner = useMemo(() => toDeskBannerView(desks), [desks]);
  // A ticked id that left the directory (other day, deactivated) is not a selection.
  const poolIds = useMemo(
    () => pool.filter((id) => desks.some((desk) => desk.id === id)),
    [pool, desks]
  );
  const selectedIds = useMemo(
    () => (openDeskId === null ? poolIds : [...poolIds, openDeskId]),
    [openDeskId, poolIds]
  );
  const togglePool = useCallback((id: string) => {
    setPool((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
    );
  }, []);
  const isPast = compareDateOnly(date, todayInPrague()) < 0;
  const openDesk = desks.find((desk) => desk.id === openDeskId) ?? null;

  if (directoryQuery.isPending) return <ScreenLoading />;
  if (toContractError(directoryQuery.error)?.code === 'NO_OFFICE_ASSIGNED') {
    return <EmptyState title={t('noOfficeTitle')} description={errors('NO_OFFICE_ASSIGNED')} />;
  }
  if (directoryQuery.isError || directory === null) {
    return (
      <ScreenError error={directoryQuery.error} onRetry={() => void directoryQuery.refetch()} />
    );
  }

  const plan = toFloorPlanView(directory.office);
  const free = desks.filter((desk) => desk.status === 'FREE').length;
  const year = parseDateOnly(date).year;
  const years = Array.from(
    { length: YEAR_PICKER_RADIUS * 2 + 1 },
    (_unused, index) => year - YEAR_PICKER_RADIUS + index
  );
  const zoneOptions: Option[] = [
    { value: ALL, label: t('filterAll') },
    ...directory.zones.map((zone) => ({ value: zone.id, label: zone.name })),
  ];
  const hiveOptions: Option[] = [
    { value: ALL, label: t('filterAll') },
    ...directory.hives.map((hive) => ({ value: hive.id, label: hive.name })),
  ];

  const columns: DataTableColumn<DirectoryDesk>[] = [
    ...(isAdmin
      ? [
          {
            id: 'select',
            header: <VisuallyHidden>{t('columnSelect')}</VisuallyHidden>,
            width: '48px',
            cell: (desk: DirectoryDesk) => (
              <input
                type="checkbox"
                aria-label={t('selectDesk', { code: desk.code })}
                checked={poolIds.includes(desk.id)}
                onChange={() => togglePool(desk.id)}
              />
            ),
          },
        ]
      : []),
    { id: 'code', header: t('columnCode'), cell: (desk) => desk.code, sortValue: (d) => d.code },
    {
      id: 'zone',
      header: t('columnZone'),
      cell: (desk) => desk.zoneName,
      sortValue: (d) => d.zoneName,
    },
    {
      id: 'hive',
      header: t('columnHive'),
      cell: (desk) => desk.hiveName ?? '',
      sortValue: (d) => d.hiveName,
    },
    {
      id: 'status',
      header: t('columnStatus'),
      cell: (desk) => (
        <span className={styles.status}>
          <span
            className={styles.swatch}
            style={{ background: DESK_TONES[desk.status] }}
            aria-hidden="true"
          />
          {t(DESK_STATUS_KEYS[desk.status])}
        </span>
      ),
      sortValue: (d) => DESK_STATUS_ORDER.indexOf(d.status),
    },
    {
      id: 'holder',
      header: t('columnHolder'),
      cell: (desk) =>
        (desk.status === 'ASSIGNED' ? desk.permanentAssigneeName : desk.reservedByName) ?? '',
    },
    {
      id: 'action',
      header: t('columnAction'),
      align: 'end',
      cell: (desk) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('listOpenDesk', { code: desk.code })}
          onClick={() => setOpenDeskId(desk.id)}
        >
          {t('listOpen')}
        </Button>
      ),
    },
  ];

  const list = (
    <DataTable
      title={t('listTitle')}
      columns={columns}
      data={listed}
      getRowId={(desk) => desk.id}
      defaultSort={{ columnId: 'code', direction: 'asc' }}
      emptyTitle={desks.length === 0 ? t('emptyTitle') : t('filteredEmpty')}
    />
  );

  return (
    <>
      <VisuallyHidden as="h1">{t('title')}</VisuallyHidden>

      <div className={styles.header}>
        <div className={styles.group}>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('previousDay')}
            onClick={() => setDate(previousWeekday(date))}
          >
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDatePickerOpen(true)}>
            {f.fullDate(date)}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('nextDay')}
            onClick={() => setDate(nextWeekday(date))}
          >
            ›
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(todayInPrague())}>
            {t('today')}
          </Button>
        </div>
        <div className={styles.group}>
          <Chip size="md" tone="outline" as="p">
            {t('freeCount', { free, total: desks.length })}
          </Chip>
          <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
            {t('bulkOpen')}
          </Button>
        </div>
      </div>

      {isAdmin && poolIds.length > 0 ? (
        <div role="status" className={styles.selection}>
          <span>{t('selectionCount', { count: poolIds.length })}</span>
          <Button variant="secondary" size="sm" onClick={() => setPool([])}>
            {t('selectionClear')}
          </Button>
        </div>
      ) : null}

      <DatePickerDialog
        open={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        selectedDate={date}
        years={years}
        onSelect={(selected) => {
          setDate(selected);
          setDatePickerOpen(false);
        }}
      />

      {banner.kind === 'none' ? null : (
        <div role="status" className={styles.notice}>
          {banner.kind === 'permanent' ? (
            <SystemMessage
              level="notice"
              description={t('bannerPermanent', { code: banner.code })}
              controls={
                <NextLink href={MY_RESERVATIONS_ROUTE} className={styles.link}>
                  {t('bannerPermanentLink')}
                </NextLink>
              }
            />
          ) : (
            <SystemMessage
              level="success"
              description={t('bannerToday', { code: banner.code })}
              controls={
                isPast && !isAdmin ? undefined : (
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={cancelToday.isPending}
                    onClick={() => cancelToday.mutate({ reservationId: banner.reservationId })}
                  >
                    {t('bannerTodayCancel')}
                  </Button>
                )
              }
            />
          )}
        </div>
      )}
      {cancelToday.error === null ? null : (
        <div className={styles.notice}>
          <SystemMessage
            level="alert"
            description={errorCopy(cancelToday.error, { PAST_DATE: mine('errCancelPast') })}
          />
        </div>
      )}

      {desks.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <div className={styles.filters}>
            <SingleSelectField
              label={t('filterZone')}
              options={zoneOptions}
              getOptionValue={(option) => option.value}
              getOptionLabel={(option) => option.label}
              value={filter.zoneId || ALL}
              onChange={(value) =>
                setFilter((current) => ({ ...current, zoneId: value === ALL ? '' : (value ?? '') }))
              }
            />
            <SingleSelectField
              label={t('filterHive')}
              options={hiveOptions}
              getOptionValue={(option) => option.value}
              getOptionLabel={(option) => option.label}
              value={filter.hiveId || ALL}
              onChange={(value) =>
                setFilter((current) => ({ ...current, hiveId: value === ALL ? '' : (value ?? '') }))
              }
            />
            <CheckboxField
              label={t('filterOnlyFree')}
              checked={filter.onlyFree}
              onChange={(checked) => setFilter((current) => ({ ...current, onlyFree: checked }))}
            />
            <CheckboxField
              label={t('filterOnlyDirect')}
              checked={filter.onlyDirect}
              onChange={(checked) => setFilter((current) => ({ ...current, onlyDirect: checked }))}
            />
          </div>

          {plan === null ? (
            <>
              <p className={styles.muted}>{t('noPlan')}</p>
              {list}
            </>
          ) : (
            <Tabs
              tabs={[
                {
                  id: 'plan',
                  title: t('viewPlan'),
                  content: (
                    <div className={styles.plan}>
                      <FloorPlan
                        backgroundSrc={plan.src}
                        width={plan.width}
                        height={plan.height}
                        shapes={shapes}
                        tones={DESK_TONES}
                        selectedIds={selectedIds}
                        onShapeActivate={(id, { multi }) =>
                          isAdmin && multi ? togglePool(id) : setOpenDeskId(id)
                        }
                        labels={{
                          zoomIn: t('planZoomIn'),
                          zoomOut: t('planZoomOut'),
                          reset: t('planReset'),
                          hint: t('planHint'),
                          enterFullscreen: t('planEnterFullscreen'),
                          exitFullscreen: t('planExitFullscreen'),
                        }}
                      />
                      {isAdmin ? <p className={styles.muted}>{t('planMultiHint')}</p> : null}
                      <section aria-label={t('legendTitle')} className={styles.legend}>
                        {DESK_STATUS_ORDER.map((status) => (
                          <span key={status} className={styles.status}>
                            <span
                              className={styles.swatch}
                              style={{ background: DESK_TONES[status] }}
                              aria-hidden="true"
                            />
                            {t(DESK_STATUS_KEYS[status])}
                          </span>
                        ))}
                        <span className={styles.muted}>{t('legendHive')}</span>
                      </section>
                    </div>
                  ),
                },
                { id: 'list', title: t('viewList'), content: list },
              ]}
              activeTabId={view}
              onTabChange={setView}
              autoActivate
            />
          )}
        </>
      )}

      {bulkOpen ? (
        <DeskBulkModal
          onClose={() => setBulkOpen(false)}
          anchorDate={date}
          isAdmin={isAdmin}
          viewerUserId={viewerUserId}
          deskIds={isAdmin && poolIds.length > 0 ? poolIds : undefined}
        />
      ) : null}

      {openDesk === null ? null : (
        <DeskDialog
          // A fresh dialog per desk: series picks and results never carry over.
          key={`${openDesk.id}:${date}`}
          desk={openDesk}
          date={date}
          context={{
            holdsPermanentDesk: banner.kind === 'permanent',
            myDeskToday:
              banner.kind === 'today' && banner.code !== openDesk.code ? banner.code : null,
            isPast,
            isAdmin,
          }}
          onClose={() => setOpenDeskId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
