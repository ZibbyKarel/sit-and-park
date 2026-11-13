'use client';

import { Button, Divider, Stack, Text, TextField } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import { Toast, type ToastTone } from '../../ui/toast/toast';
import type { IcsFeedView } from './settings-view';
import type { CopyState } from './settings-screen';
import styles from './ics-section.module.css';

export interface IcsSectionProps {
  readonly headingId: string;
  readonly feed: IcsFeedView;
  readonly copyState: CopyState;
  readonly onCopy: () => void;
  readonly onRequestRegenerate: () => void;
  readonly isRegenerating: boolean;
}

const COPY_FEEDBACK_TONE: Record<'copied' | 'failed', ToastTone> = {
  copied: 'success',
  failed: 'danger',
};

/**
 * The section of this modal that holds the ICS subscription
 * URL, a copy button, and token regeneration behind `ConfirmDialog` (rendered
 * one level up, so it sits above the whole modal rather than inside it).
 */
export function IcsSection({
  headingId,
  feed,
  copyState,
  onCopy,
  onRequestRegenerate,
  isRegenerating,
}: IcsSectionProps) {
  const t = useTranslations('settings');

  return (
    <section aria-labelledby={headingId}>
      <Divider />
      <div className={styles.body}>
        <Stack gap="md">
          <Stack gap="xs">
            <h3 id={headingId} className={styles.heading}>
              <Text appearance="strong-sm">{t('icsHeading')}</Text>
            </h3>
            <Text appearance="sm" variant="tertiary">
              {t('icsDescription')}
            </Text>
          </Stack>

          {feed.kind === 'unavailable' ? (
            <Text appearance="sm" variant="tertiary">
              {t('icsUnavailable')}
            </Text>
          ) : (
            <>
              <TextField
                label={t('icsUrlLabel')}
                value={feed.url}
                readOnly
                onFocus={(_value, event) => event?.currentTarget.select()}
              />
              <Stack orientation="horizontal" align="center" wrap gap="md">
                {/* `size="lg"`, matching the footer's Cancel/Save buttons — the
                    design shows one control height throughout the modal. */}
                <Button type="button" variant="secondary" size="lg" onClick={onCopy}>
                  {t('icsCopy')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={onRequestRegenerate}
                  disabled={isRegenerating}
                >
                  {t('icsRegenerate')}
                </Button>
              </Stack>
              {copyState === 'idle' ? null : (
                <Toast tone={COPY_FEEDBACK_TONE[copyState]}>
                  {copyState === 'copied' ? t('icsCopied') : t('icsCopyFailed')}
                </Toast>
              )}
            </>
          )}
        </Stack>
      </div>
    </section>
  );
}
