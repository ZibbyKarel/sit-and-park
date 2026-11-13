'use client';

/**
 * "Moje rezervace stolů": upcoming and past reservations, as a list or a
 * Monday-to-Friday month calendar, with single and bulk cancel.
 *
 * Bulk cancel loops `desk.cancel` — the contract has no bulk procedure — and
 * keeps the ones that failed selected so a retry is one click.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@garage/auth/client';
import { addMonths, todayInPrague, useDateFormatters, useTranslations } from '@garage/i18n';
import type { DateOnly } from '@garage/i18n';
import type { MyDeskReservation } from '@garage/contract';
import { Button, CheckboxField, H2, SegmentedControl, Stack, Text, Strong } from '@shoptet/ui';
import { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { ScreenDataGuard, screenDataOf } from '../../shell/screen-state/screen-state';
import { useCurrentUser } from '../../shell/use-current-user';
import { useDeskWriteError } from './my-desks-errors';
import { buildBookingsCalendar, reservationDetail, splitReservations } from './my-desks-view';
import styles from './my-desks.module.css';

type View = 'list' | 'calendar';
type ConfirmTarget = MyDeskReservation | 'bulk' | null;

export function ReservationsSection() {
  const t = useTranslations('myDesks');
  const bulk = useTranslations('bulk');
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
  const releasesQuery = useQuery({
    ...api.desk.myReleases.queryOptions(),
    enabled: status === 'authenticated',
  });

  const [view, setView] = useState<View>('list');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [anchor, setAnchor] = useState<DateOnly>(() => todayInPrague());
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
        <div className={styles.sectionHeader}>
          <H2 id="my-desks-reservations">{t('reservationsTitle')}</H2>
          <SegmentedControl
            aria-label={t('viewLabel')}
            size="sm"
            options={[
              { value: 'list', label: t('viewList') },
              { value: 'calendar', label: t('viewCalendar') },
            ]}
            getOptionValue={(option) => option.value}
            getOptionLabel={(option) => option.label}
            value={view}
            onChange={(value) => setView(value as View)}
          />
        </div>
        <ScreenDataGuard
          state={screenDataOf(reservationsQuery)}
          onRetry={() => void reservationsQuery.refetch()}
          headingLevel={3}
        >
          {({ reservations }) => {
            const today = todayInPrague();
            const { upcoming, history } = splitReservations(reservations, today);

            if (view === 'calendar') {
              const calendar = buildBookingsCalendar(
                anchor,
                reservations,
                releasesQuery.data ?? null,
                today
              );
              const weekdays = [
                bulk('weekdayMon'),
                bulk('weekdayTue'),
                bulk('weekdayWed'),
                bulk('weekdayThu'),
                bulk('weekdayFri'),
              ];
              return (
                <Stack gap="md">
                  <div className={styles.calendarNav}>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={t('calPrev')}
                      onClick={() => setAnchor(addMonths(anchor, -1))}
                    >
                      ‹
                    </Button>
                    <Strong>{f.monthAndYear(anchor)}</Strong>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={t('calNext')}
                      onClick={() => setAnchor(addMonths(anchor, 1))}
                    >
                      ›
                    </Button>
                    <Text appearance="sm" variant="tertiary">
                      {t('calCount', { count: calendar.monthCount })}
                    </Text>
                  </div>
                  <div role="grid" aria-label={t('calendarLabel')} className={styles.calendar}>
                    <div role="row" className={styles.calendarRow}>
                      {weekdays.map((name) => (
                        <div key={name} role="columnheader" className={styles.weekday}>
                          {name}
                        </div>
                      ))}
                    </div>
                    {calendar.weeks.map((week) => (
                      <div key={week.key} role="row" className={styles.calendarRow}>
                        {week.slots.map((slot) => (
                          <div
                            key={slot.key}
                            role="gridcell"
                            className={styles.cell}
                            data-empty={slot.day === null}
                            data-today={slot.day?.isToday}
                            data-past={slot.day?.isPast}
                          >
                            {slot.day === null ? null : (
                              <>
                                <span className={styles.cellDay}>{slot.day.day}</span>
                                {slot.day.chips.map((chip) => (
                                  <span
                                    key={chip.kind === 'reservation' ? chip.id : chip.kind}
                                    className={styles.chip}
                                    data-kind={chip.kind}
                                  >
                                    {chip.kind === 'reservation'
                                      ? chip.code
                                      : chip.kind === 'permanent'
                                        ? t('calPermanent')
                                        : t('calReleased', { code: chip.code })}
                                  </span>
                                ))}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <Text appearance="sm" variant="tertiary">
                    {t('calendarHint')}
                  </Text>
                </Stack>
              );
            }

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
