'use client';

import type { useTranslations } from '@sit-and-park/i18n';
import { Button, Modal } from '@shoptet/ui';
import type { PreviewBulkOutput } from '@sit-and-park/contract';
import { CalendarTable, type CalendarTableProps } from './calendar-table';
import styles from './bulk-modal.module.css';

/**
 * Step 2 of {@link BulkReservationModalContent} in `./bulk-modal.tsx` — the schedule
 * `reservation.previewBulk` proposed, with the confirm/back footer.
 *
 * Every identifier this reads was in `BulkReservationModalContent`'s
 * closure, arriving here as a prop in the order the parent already computed
 * them. `confirmPending` and `onConfirm` stand in for the `confirmBulk`
 * mutation object itself, deliberately — this component is presentation-only
 * and stays testable without a `QueryClient` in scope.
 */
export interface SchedulePreviewModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly t: ReturnType<typeof useTranslations>;
  readonly proposal: PreviewBulkOutput;
  readonly pending: boolean;
  readonly onBack: () => void;
  readonly confirmPending: boolean;
  readonly onConfirm: () => void;
  readonly picker: NonNullable<CalendarTableProps['picker']>;
}

export function SchedulePreviewModal({
  open,
  onClose,
  t,
  proposal,
  pending,
  onBack,
  confirmPending,
  onConfirm,
  picker,
}: SchedulePreviewModalProps) {
  return (
    <Modal isOpen={open} onClose={onClose} canBeDismissed={!confirmPending} maxWidth>
      <Modal.Header subheader={t('scheduleDescription')}>{t('scheduleTitle')}</Modal.Header>
      <Modal.Content>
        <CalendarTable days={proposal.days} t={t} picker={picker} />
        <p className={styles.summary}>
          {/*
            The server's own count, exactly as the result step uses
            `result.summary`. Re-deriving it here by filtering `days` would put
            two authorities behind one sentence, and the moment they disagreed
            the user would read a difference between the two steps that the
            comparison panel cannot explain, because no day moved.
          */}
          {t('scheduleSummary', {
            assigned: proposal.summary.assigned,
            queued: proposal.summary.queued,
          })}
        </p>
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            <Button {...secondaryButtonProps} disabled={pending} onClick={onBack}>
              {t('ctaBack')}
            </Button>
            <Button
              {...primaryButtonProps}
              isLoading={confirmPending}
              disabled={pending}
              onClick={onConfirm}
            >
              {t('ctaConfirm')}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
