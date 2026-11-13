'use client';

/**
 * Admin desks: every desk of an office on its floor plan and in a table,
 * toned by the day's status; select one desk (plain click) or several
 * (Ctrl/Cmd+click, or the table's checkboxes) and edit them in the side panel.
 * Every rule is a pure function in `./admin-desks-view`.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, CheckboxField, Tabs } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import { useSession } from '@sit-and-park/auth/client';
import type { AdminDesk } from '@sit-and-park/contract';
import { useApi } from '../../api-provider/api-provider';
import { EmptyState, ScreenError, ScreenLoading } from '../../screen-state/screen-state';
import { useDateInUrl } from '../../../lot/lot-screen/use-date-in-url';
import { toFloorPlanView } from '../../../desks/desk-view';
import { FloorPlan } from '../../../ui/floor-plan/floor-plan';
import { DataTable, type DataTableColumn } from '../../../ui/data-table/data-table';
import { Chip } from '../../../ui/chip/chip';
import { VisuallyHidden } from '../../../ui/visually-hidden/visually-hidden';
import {
  ADMIN_DESK_TONES,
  ADMIN_STATUS_KEYS,
  ADMIN_STATUS_ORDER,
  EMPTY_ADMIN_FILTER,
  holderName,
  matchesAdminFilter,
  pruneSelection,
  selectDesk,
  selectZone,
  toAdminShapes,
  toggleDesk,
  type AdminDeskFilter,
} from './admin-desks-view';
import { AdminDayBar } from './admin-day-bar';
import { BulkEditor } from './bulk-editor';
import { DeskEditor } from './desk-editor';
import { OptionSelect, type Option } from './option-select';
import styles from './admin-desks-screen.module.css';

/** The "every office" / "any zone" option of a select. */
const ALL = 'all';

type View = 'plan' | 'list';

export function AdminDesksScreen() {
  const t = useTranslations('adminDesks');
  const api = useApi();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const enabled = sessionStatus === 'authenticated';

  const [date, setDate] = useDateInUrl();
  /** `null` = the first office (so a plan shows at once); {@link ALL} = every office. */
  const [officeChoice, setOfficeChoice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminDeskFilter>(EMPTY_ADMIN_FILTER);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<View>('plan');

  const officesQuery = useQuery({ ...api.admin.office.list.queryOptions(), enabled });
  const hivesQuery = useQuery({ ...api.admin.hive.list.queryOptions(), enabled });
  const usersQuery = useQuery({
    ...api.admin.user.list.queryOptions({ input: { active: true } }),
    enabled,
  });

  const offices = useMemo(() => officesQuery.data?.offices ?? [], [officesQuery.data]);
  const office =
    officeChoice === ALL
      ? null
      : (offices.find((o) => o.id === officeChoice) ??
        offices.find((o) => o.active) ??
        offices[0] ??
        null);

  const desksQuery = useQuery({
    ...api.admin.desk.list.queryOptions({
      input: { date, ...(office === null ? {} : { officeId: office.id }) },
    }),
    // Not before the offices are known, or the first request would list every office.
    enabled: enabled && officesQuery.isSuccess,
  });
  const desks = useMemo(() => desksQuery.data?.desks ?? [], [desksQuery.data]);
  const selected = useMemo(() => pruneSelection(selection, desks), [selection, desks]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: api.admin.desk.key() });
    void queryClient.invalidateQueries({ queryKey: api.desk.key() });
  }, [api, queryClient]);

  const ariaLabel = useCallback(
    (desk: AdminDesk) =>
      desk.hiveName === null
        ? t('deskAria', { code: desk.code, status: t(ADMIN_STATUS_KEYS[desk.status]) })
        : t('deskAriaHive', {
            code: desk.code,
            status: t(ADMIN_STATUS_KEYS[desk.status]),
            hive: desk.hiveName,
          }),
    [t]
  );
  const shapes = useMemo(() => toAdminShapes(desks, filter, ariaLabel), [desks, filter, ariaLabel]);
  const listed = useMemo(
    () => desks.filter((desk) => matchesAdminFilter(desk, filter)),
    [desks, filter]
  );

  const pending = [officesQuery, hivesQuery, usersQuery, desksQuery].find((q) => q.isPending);
  const failed = [officesQuery, hivesQuery, usersQuery, desksQuery].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <ScreenError
        error={failed.error}
        onRetry={() =>
          void Promise.all(
            [officesQuery, hivesQuery, usersQuery, desksQuery].map((q) => q.refetch())
          )
        }
        headingLevel={3}
      />
    );
  }
  if (pending !== undefined || desksQuery.data === undefined) return <ScreenLoading />;

  const hives = hivesQuery.data?.hives ?? [];
  const users = usersQuery.data?.users ?? [];
  const plan = office === null ? null : toFloorPlanView(office);
  const selectedDesks = desks.filter((desk) => selected.has(desk.id));
  // A zone list for the filter and "select the zone": the zones the listed desks sit in.
  const zones = [...new Map(desks.map((desk) => [desk.zoneId, desk.zoneName])).entries()];

  const officeOptions: Option[] = [
    ...offices.map((o) => ({ value: o.id, label: o.name })),
    { value: ALL, label: t('officeAll') },
  ];
  const zoneOptions: Option[] = [
    { value: ALL, label: t('filterAll') },
    ...zones.map(([value, label]) => ({ value, label })),
  ];
  const hiveOptions: Option[] = [
    { value: ALL, label: t('filterAll') },
    ...hives.map((hive) => ({ value: hive.id, label: hive.name })),
  ];

  const columns: DataTableColumn<AdminDesk>[] = [
    {
      id: 'select',
      header: <VisuallyHidden>{t('columnSelect')}</VisuallyHidden>,
      width: '48px',
      cell: (desk) => (
        <CheckboxField
          label={t('selectDesk', { code: desk.code })}
          checked={selected.has(desk.id)}
          onChange={() => setSelection(toggleDesk(selected, desk.id))}
        />
      ),
    },
    { id: 'code', header: t('columnCode'), cell: (d) => d.code, sortValue: (d) => d.code },
    { id: 'zone', header: t('columnZone'), cell: (d) => d.zoneName, sortValue: (d) => d.zoneName },
    {
      id: 'hive',
      header: t('columnHive'),
      cell: (d) => d.hiveName ?? '',
      sortValue: (d) => d.hiveName,
    },
    {
      id: 'status',
      header: t('columnStatus'),
      cell: (desk) => (
        <span className={styles.status}>
          <span
            className={styles.swatch}
            style={{ background: ADMIN_DESK_TONES[desk.status] }}
            aria-hidden="true"
          />
          {t(ADMIN_STATUS_KEYS[desk.status])}
        </span>
      ),
      sortValue: (d) => ADMIN_STATUS_ORDER.indexOf(d.status),
    },
    { id: 'holder', header: t('columnHolder'), cell: holderName, sortValue: holderName },
    {
      id: 'active',
      header: t('columnActive'),
      cell: (d) => (d.active ? t('yes') : t('no')),
      sortValue: (d) => d.active,
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
      <VisuallyHidden as="h2">{t('title')}</VisuallyHidden>
      <div className={styles.header}>
        <AdminDayBar
          date={date}
          onChange={setDate}
          labels={{ previous: t('previousDay'), next: t('nextDay'), today: t('today') }}
        />
        <OptionSelect
          label={t('officeFilter')}
          options={officeOptions}
          value={officeChoice === ALL ? ALL : (office?.id ?? null)}
          onChange={(value) => {
            setOfficeChoice(value);
            setFilter(EMPTY_ADMIN_FILTER);
          }}
        />
        <OptionSelect
          label={t('zoneFilter')}
          options={zoneOptions}
          value={filter.zoneId || ALL}
          onChange={(value) =>
            setFilter((c) => ({ ...c, zoneId: value === null || value === ALL ? '' : value }))
          }
        />
        <OptionSelect
          label={t('hiveFilter')}
          options={hiveOptions}
          value={filter.hiveId || ALL}
          onChange={(value) =>
            setFilter((c) => ({ ...c, hiveId: value === null || value === ALL ? '' : value }))
          }
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={filter.zoneId === ''}
          onClick={() => setSelection(selectZone(selected, desks, filter.zoneId))}
        >
          {t('selectZone')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={selected.size === 0}
          onClick={() => setSelection(new Set())}
        >
          {t('clearSelection')}
        </Button>
        <Chip size="md" tone="outline" as="p">
          {t('selectedCount', { count: selected.size, total: desks.length })}
        </Chip>
      </div>

      {desks.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} headingLevel={3} />
      ) : (
        <div className={styles.layout}>
          <div className={styles.main}>
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
                      <div className={styles.main}>
                        <FloorPlan
                          backgroundSrc={plan.src}
                          width={plan.width}
                          height={plan.height}
                          shapes={shapes}
                          tones={ADMIN_DESK_TONES}
                          selectedIds={selected}
                          onShapeActivate={(id, { multi }) =>
                            setSelection(selectDesk(selected, id, multi))
                          }
                          labels={{
                            zoomIn: t('planZoomIn'),
                            zoomOut: t('planZoomOut'),
                            reset: t('planReset'),
                            hint: t('planHint'),
                          }}
                        />
                        <section aria-label={t('legendTitle')} className={styles.legend}>
                          {ADMIN_STATUS_ORDER.map((status) => (
                            <span key={status} className={styles.status}>
                              <span
                                className={styles.swatch}
                                style={{ background: ADMIN_DESK_TONES[status] }}
                                aria-hidden="true"
                              />
                              {t(ADMIN_STATUS_KEYS[status])}
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
            {plan === null ? null : <p className={styles.muted}>{t('selectHint')}</p>}
          </div>

          {selectedDesks.length === 0 ? (
            <p className={styles.muted}>{t('nothingSelected')}</p>
          ) : selectedDesks.length === 1 && selectedDesks[0] !== undefined ? (
            <DeskEditor
              // A fresh editor per desk: drafts never carry over.
              key={selectedDesks[0].id}
              desk={selectedDesks[0]}
              offices={offices}
              hives={hives}
              users={users}
              onChanged={refresh}
            />
          ) : (
            <BulkEditor desks={selectedDesks} hives={hives} users={users} onChanged={refresh} />
          )}
        </div>
      )}
    </>
  );
}
