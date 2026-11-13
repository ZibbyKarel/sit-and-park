'use client';

/**
 * Parking and desk reservations as one list (tab "Seznam"): upcoming and past,
 * with single and bulk cancel. (The month calendar is `reservations-calendar.tsx`.)
 *
 * Cancelling goes through `useCancelReservations` (shared with the calendar's
 * detail dialog); the list keeps the ones that failed selected so a retry is
 * one click. Either query failing fails the whole list: a half list
 * that silently omits one kind would be worse than the error.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRequireAuth } from '@sit-and-park/auth/client';
import { todayInPrague, useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import { Button, CheckboxField, Stack, Text, Strong } from '@shoptet/ui';
import { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog';
import { useApi } from '../../shell/api-provider/api-provider';
import { ScreenDataGuard } from '../../shell/screen-state/screen-state';
import type { ScreenData } from '../../shell/screen-state/screen-state';
import { CarIcon, DeskIcon } from '../../ui/icons/icons';
import { useCurrentUser } from '../../shell/use-current-user';
import {
  mergeMyReservations,
  reservationDetail,
  splitReservations,
  type MyListEntry,
} from './my-reservations-view';
import { useCancelReservations } from './use-cancel-reservations';
import styles from './my-reservations.module.css';

type ConfirmTarget = MyListEntry | 'bulk' | null;

const entryTitle = (entry: MyListEntry) =>
  entry.kind === 'desk' ? entry.reservation.deskCode : entry.reservation.parkingSpotLabel;

export function ReservationsSection() {
  const t = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const { status } = useRequireAuth();
  const viewer = useCurrentUser();

  const enabled = status === 'authenticated';
  const desksQuery = useQuery({ ...api.desk.myReservations.queryOptions(), enabled });
  const parkingQuery = useQuery({ ...api.reservation.myReservations.queryOptions(), enabled });
  const queries = [desksQuery, parkingQuery];
  const failed = queries.find((query) => query.isError);
  const state: ScreenData<MyListEntry[]> = failed
    ? { kind: 'error', error: failed.error }
    : desksQuery.data === undefined || parkingQuery.data === undefined
      ? { kind: 'loading' }
      : {
          kind: 'ready',
          data: mergeMyReservations(parkingQuery.data.reservations, desksQuery.data.reservations),
        };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const { busy, cancel } = useCancelReservations();
  const isAdmin = viewer.data?.role === 'ADMIN';

  async function run(entries: readonly MyListEntry[]) {
    const failedKeys = await cancel(
      entries.map((entry) => ({
        kind: entry.kind,
        key: entry.key,
        reservationId: entry.reservation.id,
      }))
    );
    setConfirm(null);
    setSelected(failedKeys);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  function entryLabel(entry: MyListEntry) {
    return `${entryTitle(entry)} · ${f.dayMonthAndYear(entry.date)}`;
  }

  function entryDetail(entry: MyListEntry) {
    return entry.kind === 'desk'
      ? t('reservationDetail', {
          date: f.fullDate(entry.date),
          detail: reservationDetail(entry.reservation),
        })
      : f.fullDate(entry.date);
  }

  function cancelButton(entry: MyListEntry) {
    return (
      <Button
        variant="destructive"
        size="sm"
        aria-label={t('cancelOneLabel', {
          code: entryTitle(entry),
          date: f.dayMonthAndYear(entry.date),
        })}
        onClick={() => setConfirm(entry)}
      >
        {t('cancelOne')}
      </Button>
    );
  }

  function rowHead(entry: MyListEntry) {
    return (
      <>
        {entry.kind === 'parking' ? (
          <CarIcon label={t('kindParking')} />
        ) : (
          <DeskIcon label={t('kindDesk')} />
        )}
        <div className={styles.rowMain}>
          <Strong>{entryTitle(entry)}</Strong>
          <Text appearance="sm" variant="tertiary">
            {entryDetail(entry)}
          </Text>
        </div>
      </>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="my-reservations-title">
      <ScreenDataGuard state={state} onRetry={() => queries.forEach((q) => void q.refetch())}>
        {(entries) => {
          const today = todayInPrague();
          const { upcoming, history } = splitReservations(entries, today);

          if (entries.length === 0) {
            return <Text variant="tertiary">{t('emptyAll')}</Text>;
          }

          const allSelected = upcoming.length > 0 && upcoming.every((e) => selected.has(e.key));
          const selectedEntries = upcoming.filter((entry) => selected.has(entry.key));

          return (
            <Stack gap="lg">
              {upcoming.length === 0 ? (
                <Text variant="tertiary">{t('emptyUpcoming')}</Text>
              ) : (
                <Stack gap="sm">
                  <div className={styles.toolbar}>
                    <CheckboxField
                      label={t('selectAll')}
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(upcoming.map((e) => e.key)))
                      }
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={selectedEntries.length === 0}
                      onClick={() => setConfirm('bulk')}
                    >
                      {t('cancelSelected', { count: selectedEntries.length })}
                    </Button>
                  </div>
                  <ul className={styles.rows}>
                    {upcoming.map((entry) => (
                      <li key={entry.key} className={styles.row}>
                        <CheckboxField
                          label={t('selectRow', {
                            code: entryTitle(entry),
                            date: f.dayMonthAndYear(entry.date),
                          })}
                          labelHidden
                          checked={selected.has(entry.key)}
                          onChange={() => toggle(entry.key)}
                        />
                        {rowHead(entry)}
                        {cancelButton(entry)}
                      </li>
                    ))}
                  </ul>
                </Stack>
              )}

              {history.length === 0 ? null : (
                <Stack gap="sm">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={historyOpen}
                    onClick={() => setHistoryOpen(!historyOpen)}
                  >
                    {t('historyToggle', { count: history.length })}
                  </Button>
                  {historyOpen ? (
                    <ul className={styles.rows}>
                      {history.map((entry) => (
                        <li key={entry.key} className={styles.row}>
                          {rowHead(entry)}
                          {isAdmin ? cancelButton(entry) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Stack>
              )}

              <ConfirmDialog
                open={confirm !== null}
                tone="danger"
                loading={busy}
                title={
                  confirm === 'bulk'
                    ? t('bulkDialogTitle', { count: selectedEntries.length })
                    : confirm === null
                      ? ''
                      : t('cancelDialogTitle', { code: entryTitle(confirm) })
                }
                description={
                  confirm === null || confirm === 'bulk'
                    ? undefined
                    : confirm.kind === 'desk'
                      ? t('cancelDialogDescription', {
                          date: f.fullDate(confirm.date),
                          detail: reservationDetail(confirm.reservation),
                        })
                      : t('cancelDialogDescriptionParking', { date: f.fullDate(confirm.date) })
                }
                confirmLabel={
                  confirm === 'bulk' ? t('bulkDialogConfirm') : t('cancelDialogConfirm')
                }
                cancelLabel={t('cancelDialogKeep')}
                onCancel={() => setConfirm(null)}
                onConfirm={() =>
                  void run(confirm === 'bulk' ? selectedEntries : confirm === null ? [] : [confirm])
                }
              >
                {confirm === 'bulk' ? (
                  <ul>
                    {selectedEntries.map((entry) => (
                      <li key={entry.key}>{entryLabel(entry)}</li>
                    ))}
                  </ul>
                ) : undefined}
              </ConfirmDialog>
            </Stack>
          );
        }}
      </ScreenDataGuard>
    </section>
  );
}
