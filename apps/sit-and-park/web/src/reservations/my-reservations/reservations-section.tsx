'use client';

/**
 * "Moje rezervace stolů": upcoming and past reservations as a list, with
 * single and bulk cancel. (The month calendar is `reservations-calendar.tsx`.)
 *
 * Bulk cancel loops `desk.cancel` — the contract has no bulk procedure — and
 * keeps the ones that failed selected so a retry is one click.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@sit-and-park/auth/client';
import { todayInPrague, useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import type { MyDeskReservation } from '@sit-and-park/contract';
import { Button, CheckboxField, H2, Stack, Text, Strong } from '@shoptet/ui';
import { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { ScreenDataGuard, screenDataOf } from '../../shell/screen-state/screen-state';
import { useCurrentUser } from '../../shell/use-current-user';
import { useDeskWriteError } from './my-reservations-errors';
import { reservationDetail, splitReservations } from './my-reservations-view';
import styles from './my-reservations.module.css';

type ConfirmTarget = MyDeskReservation | 'bulk' | null;

export function ReservationsSection() {
  const t = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const viewer = useCurrentUser();
  const describe = useDeskWriteError();

  const reservationsQuery = useQuery({
    ...api.desk.myReservations.queryOptions(),
    enabled: status === 'authenticated',
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useNotify(notice, 'success');
  useNotify(failure, 'danger');

  const cancel = useMutation(api.desk.cancel.mutationOptions());
  const isAdmin = viewer.data?.role === 'ADMIN';

  async function run(ids: readonly string[]) {
    setNotice(null);
    setFailure(null);
    setBusy(true);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const reservationId of ids) {
      try {
        await cancel.mutateAsync({ reservationId });
      } catch (error) {
        failed.push(reservationId);
        lastError = error;
      }
    }
    setBusy(false);
    setConfirm(null);
    setSelected(new Set(failed));
    void queryClient.invalidateQueries({ queryKey: api.desk.key() });
    if (failed.length === 0) {
      setNotice(ids.length === 1 ? t('cancelledOne') : t('cancelledMany', { count: ids.length }));
    } else if (ids.length === 1) {
      setFailure(describe(lastError, 'cancel'));
    } else {
      setFailure(t('bulkPartial', { failed: failed.length, total: ids.length }));
    }
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

  function reservationLabel(reservation: MyDeskReservation) {
    return `${reservation.deskCode} · ${f.dayMonthAndYear(reservation.date)}`;
  }

  return (
    <section className={styles.section} aria-labelledby="my-desks-reservations">
      <Stack gap="lg">
        <H2 id="my-desks-reservations">{t('reservationsTitle')}</H2>
        <ScreenDataGuard
          state={screenDataOf(reservationsQuery)}
          onRetry={() => void reservationsQuery.refetch()}
          headingLevel={3}
        >
          {({ reservations }) => {
            const today = todayInPrague();
            const { upcoming, history } = splitReservations(reservations, today);

            if (reservations.length === 0) {
              return <Text variant="tertiary">{t('emptyAll')}</Text>;
            }

            const allSelected =
              upcoming.length > 0 && upcoming.every((reservation) => selected.has(reservation.id));
            const selectedIds = upcoming
              .filter((reservation) => selected.has(reservation.id))
              .map((reservation) => reservation.id);

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
                          setSelected(
                            allSelected
                              ? new Set()
                              : new Set(upcoming.map((reservation) => reservation.id))
                          )
                        }
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={selectedIds.length === 0}
                        onClick={() => setConfirm('bulk')}
                      >
                        {t('cancelSelected', { count: selectedIds.length })}
                      </Button>
                    </div>
                    <ul className={styles.rows}>
                      {upcoming.map((reservation) => (
                        <li key={reservation.id} className={styles.row}>
                          <CheckboxField
                            label={t('selectRow', {
                              code: reservation.deskCode,
                              date: f.dayMonthAndYear(reservation.date),
                            })}
                            labelHidden
                            checked={selected.has(reservation.id)}
                            onChange={() => toggle(reservation.id)}
                          />
                          <div className={styles.rowMain}>
                            <Strong>{reservation.deskCode}</Strong>
                            <Text appearance="sm" variant="tertiary">
                              {t('reservationDetail', {
                                date: f.fullDate(reservation.date),
                                detail: reservationDetail(reservation),
                              })}
                            </Text>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            aria-label={t('cancelOneLabel', {
                              code: reservation.deskCode,
                              date: f.dayMonthAndYear(reservation.date),
                            })}
                            onClick={() => setConfirm(reservation)}
                          >
                            {t('cancelOne')}
                          </Button>
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
                        {history.map((reservation) => (
                          <li key={reservation.id} className={styles.row}>
                            <div className={styles.rowMain}>
                              <Strong>{reservation.deskCode}</Strong>
                              <Text appearance="sm" variant="tertiary">
                                {t('reservationDetail', {
                                  date: f.fullDate(reservation.date),
                                  detail: reservationDetail(reservation),
                                })}
                              </Text>
                            </div>
                            {isAdmin ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                aria-label={t('cancelOneLabel', {
                                  code: reservation.deskCode,
                                  date: f.dayMonthAndYear(reservation.date),
                                })}
                                onClick={() => setConfirm(reservation)}
                              >
                                {t('cancelOne')}
                              </Button>
                            ) : null}
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
                      ? t('bulkDialogTitle', { count: selectedIds.length })
                      : confirm === null
                        ? ''
                        : t('cancelDialogTitle', { code: confirm.deskCode })
                  }
                  description={
                    confirm === null || confirm === 'bulk'
                      ? undefined
                      : t('cancelDialogDescription', {
                          date: f.fullDate(confirm.date),
                          detail: reservationDetail(confirm),
                        })
                  }
                  confirmLabel={
                    confirm === 'bulk' ? t('bulkDialogConfirm') : t('cancelDialogConfirm')
                  }
                  cancelLabel={t('cancelDialogKeep')}
                  onCancel={() => setConfirm(null)}
                  onConfirm={() =>
                    void run(
                      confirm === 'bulk' ? selectedIds : confirm === null ? [] : [confirm.id]
                    )
                  }
                >
                  {confirm === 'bulk' ? (
                    <ul>
                      {upcoming
                        .filter((reservation) => selected.has(reservation.id))
                        .map((reservation) => (
                          <li key={reservation.id}>{reservationLabel(reservation)}</li>
                        ))}
                    </ul>
                  ) : undefined}
                </ConfirmDialog>
              </Stack>
            );
          }}
        </ScreenDataGuard>
      </Stack>
    </section>
  );
}
