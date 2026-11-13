'use client';

/**
 * Everything above the map. All presentational.
 *
 * - {@link LotHeader} — the date pill (prev/next day, and a button that opens
 *   `./date-picker-dialog`'s `DatePickerDialog`), the "Dnes" shortcut, the
 *   occupancy pill and the bulk-reservation button. This is where
 *   `./date-nav-bar`'s sticky footer bar moved to
 *   the header row — there is no footer left on this screen.
 * - {@link WindowBanner} — the one true sentence about the month's window;
 * - {@link RealtimeNotice} — the affordance for a refused socket.
 */

import { Button, SystemMessage } from '@shoptet/ui';
import { Chip } from '../../ui/chip/chip';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import { useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import type { DateOnly } from '@sit-and-park/i18n';
import type { BannerView, DayNoteView, LotCounts } from '../lot-view';
import styles from './lot-header.module.css';

export interface LotHeaderProps {
  readonly date: DateOnly;
  readonly note: DayNoteView;
  readonly counts: LotCounts;
  /** Accessible page title. Not shown — the design has no visible heading. */
  readonly sectionTitle: string;
  /**
   * `windowOpen || admin` — the design's `batchAllowed`. When it is false the
   * button is **absent**, not disabled: a normal user in a locked month has no
   * bulk action to take, and a greyed-out control invites a click that will
   * only ever be refused.
   */
  readonly showBulk: boolean;
  readonly onBulk: () => void;
  readonly onPreviousDay: () => void;
  readonly onNextDay: () => void;
  readonly onToday: () => void;
  /** Opens `./date-picker-dialog`'s `DatePickerDialog`, owned by `../lot-screen/lot-screen.tsx`. */
  readonly onOpenDatePicker: () => void;
}

export function LotHeader({
  date,
  note,
  counts,
  sectionTitle,
  showBulk,
  onBulk,
  onPreviousDay,
  onNextDay,
  onToday,
  onOpenDatePicker,
}: LotHeaderProps) {
  const t = useTranslations('lot');
  const f = useDateFormatters();

  return (
    <div className={styles.header}>
      {/* The design has no visible page title — the date pill is the heading
          now — but the document still needs one `h1` for assistive tech. */}
      <VisuallyHidden as="h1">{sectionTitle}</VisuallyHidden>

      <div className={styles.group}>
        <div className={styles.datePill}>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('previousDay')}
            onClick={onPreviousDay}
          >
            <span className={styles.arrow}>‹</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenDatePicker}>
            {f.fullDate(date)}
          </Button>
          <Button variant="secondary" size="sm" aria-label={t('nextDay')} onClick={onNextDay}>
            <span className={styles.arrow}>›</span>
          </Button>
        </div>
        <span className={styles.note} data-highlighted={note.highlighted ? '' : undefined}>
          {t(note.key, { name: note.name })}
        </span>
      </div>

      <div className={styles.group}>
        <Button variant="secondary" size="sm" onClick={onToday}>
          {t('today')}
        </Button>
        <Chip size="md" tone="outline" as="p">
          {t('occupiedCount', { taken: counts.taken, total: counts.free + counts.taken })}
        </Chip>
        {showBulk ? (
          <Button size="sm" onClick={onBulk}>
            {t('bulkReservation')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The status banner above the map.
 *
 * There is always exactly one: `overview.day` always carries a `window`, and
 * each of its three states has one true sentence. The design's
 * `showLockState` prototype prop is therefore not a hiding rule.
 *
 * `role="status"` so a screen reader is told when the window changes under a
 * page that is already open — which an admin flipping `lockMode` does, through
 * a refetch, without the user navigating anywhere.
 */
export function WindowBanner({ banner }: { readonly banner: BannerView }) {
  const t = useTranslations('lot');
  const isSuccess = banner.tone === 'success';

  return (
    <div role="status" className={styles.notice}>
      <SystemMessage
        level={isSuccess ? 'success' : 'alert'}
        description={t(banner.messageKey, banner.values)}
      />
    </div>
  );
}

/**
 * The board has stopped updating itself.
 *
 * Two states reach here and the sentence is the same for both, because it is
 * the true one for both: live updates are off, so the overview may not refresh
 * on its own. What differs is whether there is anything for the user to do.
 *
 * - **Refused** (a refused handshake is terminal for
 *   that socket and bounds the automatic retries, precisely so a page cannot
 *   sit forever presenting a credential the gateway has already rejected).
 *   Nothing will happen without the user, so `onReconnect` is passed and the
 *   button — the intended caller of the connection's unconditional
 *   `reconnect()` — is drawn.
 * - **Dropped**, and reconnecting on its own. `onReconnect` is omitted and the
 *   notice is the quieter, buttonless variant: a control that duplicates what
 *   is already in progress invites a click that changes nothing.
 *
 * One `realtimeRejected` string covers both. The key is named for the state it
 * was written for, but the sentence names neither — it says the connection is
 * down and what that means for the screen — and inventing a second, identical
 * string so the two keys could differ would be catalogue noise.
 */
export function RealtimeNotice({
  onReconnect,
}: {
  /** Omitted for a drop the connection is already recovering from. */
  readonly onReconnect?: (() => void) | undefined;
}) {
  const t = useTranslations('lot');

  return (
    <div role="status" className={styles.notice}>
      <SystemMessage
        level="alert"
        description={t('realtimeRejected')}
        controls={
          onReconnect === undefined ? undefined : (
            <Button variant="secondary" size="sm" onClick={onReconnect}>
              {t('realtimeReconnect')}
            </Button>
          )
        }
      />
    </div>
  );
}
