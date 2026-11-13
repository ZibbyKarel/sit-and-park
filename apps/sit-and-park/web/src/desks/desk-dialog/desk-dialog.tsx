'use client';

/**
 * The dialog behind one desk on one day: who holds it, and whatever the
 * viewer may do with it — book the day, book a series, cancel their own
 * booking, ask for approval, or withdraw their pending request. What is offered is `toDeskDialogView`'s;
 * this file only draws it and runs the writes.
 *
 * Connected (unlike `../../lot/spot-dialog`), because the series preview is a
 * query of its own and the reserve result is shown in place; the screen only
 * learns that something changed, through `onChanged`.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal, Spacer, SystemMessage } from '@shoptet/ui';
import { useDateFormatters, useTranslations, type DateOnly } from '@sit-and-park/i18n';
import type { DirectoryDesk, ReserveDeskOutput } from '@sit-and-park/contract';
import { useApi } from '../../shell/api-provider/api-provider';
import {
  DESK_SKIP_REASON_KEYS,
  DESK_STATUS_KEYS,
  toDeskDialogView,
  type DeskDialogContext,
} from '../desk-view';
import { SeriesSection } from './series-section';
import { useErrorCopy } from './use-error-copy';
import styles from './desk-dialog.module.css';

export interface DeskDialogProps {
  readonly desk: DirectoryDesk;
  readonly date: DateOnly;
  readonly context: DeskDialogContext;
  readonly onClose: () => void;
  /** A write succeeded; refetch whatever shows desks. */
  readonly onChanged: () => void;
}

export function DeskDialog({ desk, date, context, onClose, onChanged }: DeskDialogProps) {
  const t = useTranslations('desks');
  const mine = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const errorCopy = useErrorCopy();
  const view = toDeskDialogView(desk, context);

  const [seriesOpen, setSeriesOpen] = useState(false);
  const [result, setResult] = useState<ReserveDeskOutput | null>(null);
  const [requested, setRequested] = useState(false);

  const reserve = useMutation({
    ...api.desk.reserve.mutationOptions(),
    onSuccess: (output) => {
      setResult(output);
      onChanged();
    },
  });
  const cancel = useMutation({
    ...api.desk.cancel.mutationOptions(),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  const request = useMutation({
    ...api.desk.requestApproval.mutationOptions(),
    onSuccess: () => {
      setRequested(true);
      onChanged();
    },
  });

  const cancelRequest = useMutation({
    ...api.desk.cancelRequest.mutationOptions(),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const failure = reserve.error ?? cancel.error ?? request.error ?? cancelRequest.error;
  const pending =
    reserve.isPending || cancel.isPending || request.isPending || cancelRequest.isPending;
  const done = result !== null || requested;

  const holder = desk.status === 'RESERVED_BY_ME' ? t('dialogMe') : (view.holderName ?? null);

  return (
    <Modal isOpen onClose={onClose}>
      <Modal.Header subheader={f.fullDate(date)}>
        {t('dialogTitle', { code: desk.code })}
      </Modal.Header>
      <Modal.Content>
        <dl className={styles.facts}>
          <dt>{t('dialogZone')}</dt>
          <dd>{desk.zoneName}</dd>
          <dt>{t('dialogHive')}</dt>
          <dd>
            {desk.hiveName === null ? (
              t('dialogNoHive')
            ) : (
              <span className={styles.hive}>
                <span
                  className={styles.swatch}
                  style={{ borderColor: desk.hiveColor ?? undefined }}
                  aria-hidden="true"
                />
                {desk.hiveName}
              </span>
            )}
          </dd>
          <dt>{t('dialogStatus')}</dt>
          <dd>{t(DESK_STATUS_KEYS[desk.status])}</dd>
          {holder === null ? null : (
            <>
              <dt>{t('dialogHolder')}</dt>
              <dd>{holder}</dd>
            </>
          )}
        </dl>

        {view.note === null || done ? null : (
          <div className={styles.section}>
            <SystemMessage level="notice" description={t(view.note)} />
          </div>
        )}

        {result === null ? null : (
          <section className={styles.section} aria-labelledby="desk-result-heading">
            <h3 id="desk-result-heading" className={styles.heading}>
              {t('seriesResultHeading')}
            </h3>
            <p>{t('seriesResultReserved', { count: result.reserved.length })}</p>
            <ul className={styles.list}>
              {result.reserved.map((reservation) => (
                <li key={reservation.id} className={styles.row} data-ok="">
                  {f.fullDate(reservation.date)}
                </li>
              ))}
            </ul>
            {result.skipped.length === 0 ? null : (
              <>
                <p>{t('seriesResultSkipped', { count: result.skipped.length })}</p>
                <ul className={styles.list}>
                  {result.skipped.map((day) => (
                    <li key={day.date} className={styles.row}>
                      <span>{f.fullDate(day.date)}</span>
                      <span className={styles.muted}>{t(DESK_SKIP_REASON_KEYS[day.reason])}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {requested ? (
          <div className={styles.section}>
            <SystemMessage level="success" description={t('requestSent')} />
          </div>
        ) : null}

        {seriesOpen && view.canSeries && !done ? (
          <SeriesSection
            deskId={desk.id}
            start={date}
            pending={reserve.isPending}
            onSubmit={(dates) => reserve.mutate({ deskId: desk.id, dates })}
          />
        ) : null}

        {failure === null ? null : (
          <div className={styles.section}>
            <SystemMessage
              level="alert"
              description={errorCopy(failure, {
                // `requestApproval`'s VALIDATION_FAILED is "this desk cannot be
                // requested"; the catalogue sentence is parking's.
                ...(request.error === null ? {} : { VALIDATION_FAILED: t('errRequestNotAllowed') }),
                // `cancel`'s PAST_DATE is "only an admin may cancel a past reservation".
                ...(cancel.error === null ? {} : { PAST_DATE: mine('errCancelPast') }),
              })}
            />
          </div>
        )}
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            {view.canCancel && !done ? (
              <>
                <Button
                  {...primaryButtonProps}
                  variant="destructive"
                  isLoading={cancel.isPending}
                  disabled={pending}
                  onClick={() => {
                    if (desk.myReservationId !== null) {
                      cancel.mutate({ reservationId: desk.myReservationId });
                    }
                  }}
                >
                  {t('cancelReservation')}
                </Button>
                <Spacer grow />
              </>
            ) : null}
            {view.canCancelRequest && !done ? (
              <>
                <Button
                  {...primaryButtonProps}
                  variant="destructive"
                  isLoading={cancelRequest.isPending}
                  disabled={pending}
                  onClick={() => {
                    if (desk.myPendingRequestId !== null) {
                      cancelRequest.mutate({ requestId: desk.myPendingRequestId });
                    }
                  }}
                >
                  {t('cancelRequest')}
                </Button>
                <Spacer grow />
              </>
            ) : null}
            <Button {...secondaryButtonProps} onClick={onClose}>
              {t('close')}
            </Button>
            {done ? null : (
              <>
                {view.canSeries && !seriesOpen ? (
                  <Button {...secondaryButtonProps} onClick={() => setSeriesOpen(true)}>
                    {t('seriesOpen')}
                  </Button>
                ) : null}
                {view.canBookDay && !seriesOpen ? (
                  <Button
                    {...primaryButtonProps}
                    isLoading={reserve.isPending}
                    disabled={pending}
                    onClick={() => reserve.mutate({ deskId: desk.id, dates: [date] })}
                  >
                    {t('bookDay')}
                  </Button>
                ) : null}
                {view.canRequest ? (
                  <Button
                    {...primaryButtonProps}
                    isLoading={request.isPending}
                    disabled={pending}
                    onClick={() => request.mutate({ deskId: desk.id, date })}
                  >
                    {t('requestApproval')}
                  </Button>
                ) : null}
              </>
            )}
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
