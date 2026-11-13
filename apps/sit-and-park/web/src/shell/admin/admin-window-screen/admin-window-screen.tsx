'use client';

/**
 * The "Rezervační okno" tab (`doc/design/screens/05-admin-window.png`): the
 * settings card on the left, the per-month state list on the right.
 *
 * ## There is no Save button, because the design has none
 *
 * Both controls write on change, the same way the switches in the other two
 * tabs do. That is what the design draws, and it is what makes the right-hand
 * card meaningful: it says "podle nastavení vlevo", i.e. it is a live read of
 * the setting next to it, and a form with an unsaved pending state would make
 * that sentence false half the time. The cost — one request per stepper press —
 * is bounded by the range (1–31) and by this being an admin screen a handful of
 * people touch a handful of times.
 *
 * ## The month list never prints a date it cannot stand behind
 *
 * `windowFrom`/`windowTo` are the range the AUTO rule *would* produce. Under a
 * forced lock mode they describe a hypothetical
 * (`libs/sit-and-park/contract/src/schemas/reservation-window.ts`), so the row says so in
 * words — "automaticky by bylo otevřeno …" — instead of stating it as fact.
 *
 * Presentational: `../admin-window-panel.tsx` is the connected half.
 */

import type {
  ListMonthWindowsOutput,
  MonthWindowOverview,
  ReservationLockMode,
} from '@sit-and-park/contract';
import { Card, CounterInput, Divider, Grid, H3, Paragraph, Stack, Tag, Text } from '@shoptet/ui';
import type { ComponentProps } from 'react';
import {
  MAX_OPEN_DAYS_BEFORE,
  MIN_OPEN_DAYS_BEFORE,
  RESERVATION_LOCK_MODES,
  startOfYearMonth,
  useDateFormatters,
  useTranslations,
} from '@sit-and-park/i18n';
import type { DateOnly, MonthLockState } from '@sit-and-park/i18n';
import { useNotify } from '../../notifications/toast-provider';
import { ScreenDataGuard } from '../../screen-state/screen-state';
import type { ScreenData } from '../../screen-state/screen-state';
import { useAdminWriteError } from '../admin-errors';
import { LockModeChoice } from '../lock-mode-choice/lock-mode-choice';
import styles from './admin-window-screen.module.css';

type TagLevel = NonNullable<ComponentProps<typeof Tag>['level']>;

/**
 * Tag level per state, straight off `05-admin-window.png`: `Otevřeno` is a
 * green pill, `Uzamčeno` a yellow one, `Zatím neotevřeno` a grey one.
 *
 * Exported so a spec can pin it. The colour is not decoration on this screen —
 * it is the at-a-glance signal an admin reads before the words, so a locked
 * month rendered green is a lie that no amount of correct text undoes.
 *
 * `BANNER_STATE_TONE` in `../window-banner/window-view.ts` is its counterpart for the
 * overview banner: same three values, a different `Tone` type, a different
 * design artifact, and a pin of its own. See that docblock for why they stay
 * two maps.
 */
export const BADGE_STATE_TONE: Record<MonthLockState, TagLevel> = {
  OPEN: 'success',
  LOCKED: 'alert',
  NOT_YET_OPEN: 'default',
};

export interface AdminWindowScreenProps {
  /**
   * The settings and the months they were derived under, exactly as
   * `admin.window.months` returned them — one value, because they came from one
   * response and a form that disagreed with the list beside it would be lying
   * about the same moment.
   */
  readonly reservationWindow: ScreenData<ListMonthWindowsOutput>;
  readonly onRetry: () => void;
  /** Today in Europe/Prague — the date the states were derived against. */
  readonly today: DateOnly;
  /** A full replacement of both fields; the contract has no patch. */
  readonly onChange: (next: { openDaysBefore: number; lockMode: ReservationLockMode }) => void;
  readonly isSaving: boolean;
  /** Whatever the failing `admin.window.update` call threw. */
  readonly saveError: unknown;
  /** The last save succeeded and nothing has changed since. */
  readonly isSaved: boolean;
}

export function AdminWindowScreen({
  reservationWindow,
  onRetry,
  today,
  onChange,
  isSaving,
  saveError,
  isSaved,
}: AdminWindowScreenProps) {
  const t = useTranslations('admin');
  const f = useDateFormatters();
  const describeWriteError = useAdminWriteError();

  const saveErrorMessage = describeWriteError('windowUpdate', saveError);

  useNotify(saveErrorMessage, 'danger');
  useNotify(saveErrorMessage === null && isSaved ? t('windowSaved') : null, 'success');

  return (
    <ScreenDataGuard state={reservationWindow} onRetry={onRetry} headingLevel={3}>
      {({ settings: { openDaysBefore, lockMode }, months }) => (
        <Grid columns={2} gap="xl">
          <section aria-label={t('windowOpenTitle')}>
            <Card>
              <Card.Content>
                <Stack gap="xl">
                  <Stack gap="sm">
                    <H3 appearance="h4">{t('windowOpenTitle')}</H3>
                    <Paragraph appearance="sm" variant="secondary">
                      {t('windowOpenDescription')}
                    </Paragraph>
                  </Stack>

                  <Stack gap="md">
                    <CounterInput
                      label={t('windowDaysLabel')}
                      value={openDaysBefore}
                      min={MIN_OPEN_DAYS_BEFORE}
                      max={MAX_OPEN_DAYS_BEFORE}
                      disabled={isSaving}
                      onChange={(next) => {
                        if (next !== null) {
                          onChange({ openDaysBefore: next, lockMode });
                        }
                      }}
                    />
                    <Text appearance="strong-md">
                      {t('windowDaysValue', { count: openDaysBefore })}
                    </Text>
                  </Stack>

                  <LockModeChoice
                    label={t('windowLockLabel')}
                    value={lockMode}
                    disabled={isSaving}
                    options={RESERVATION_LOCK_MODES.map((mode) => ({
                      value: mode,
                      label: t(`windowLock${mode}`),
                    }))}
                    onValueChange={(next) => onChange({ openDaysBefore, lockMode: next })}
                  />
                </Stack>
              </Card.Content>
            </Card>
          </section>

          <section aria-label={t('windowMonthsTitle')}>
            <Card>
              <div className={styles.monthsHeader}>
                <Stack gap="xs">
                  <H3 appearance="h4">{t('windowMonthsTitle')}</H3>
                  <Paragraph appearance="sm" variant="secondary">
                    {t('windowMonthsDescription', { today: f.dayMonthAndYear(today) })}
                  </Paragraph>
                </Stack>
              </div>
              <Divider />
              <ul className={styles.months}>
                {months.map((month) => (
                  <MonthRow key={month.month} month={month} />
                ))}
              </ul>
            </Card>
          </section>
        </Grid>
      )}
    </ScreenDataGuard>
  );
}

function MonthRow({ month }: { readonly month: MonthWindowOverview }) {
  const t = useTranslations('admin');
  const f = useDateFormatters();

  const range = {
    from: f.dayAndMonth(month.windowFrom),
    to: f.dayAndMonth(month.windowTo),
  };

  // The e2e suite locates this row by role and reads its two `<p>` elements
  // by position (`admin-window.spec.ts`), so both stay real paragraphs.
  return (
    <li className={styles.month}>
      <Stack gap="xs">
        <Paragraph appearance="strong-md">
          {f.monthAndYear(startOfYearMonth(month.month))}
        </Paragraph>
        <Paragraph appearance="sm" variant="secondary">
          {month.lockMode === 'AUTO'
            ? t('windowMonthRangeAuto', range)
            : t('windowMonthRangeForced', range)}
        </Paragraph>
      </Stack>
      <Tag level={BADGE_STATE_TONE[month.state]}>{t(`windowState${month.state}`)}</Tag>
    </li>
  );
}
