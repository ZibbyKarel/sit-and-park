'use client';

/**
 * "Můj stálý stůl": release days of the caller's permanent desk and take them
 * back. Rendered only when `desk.myReleases` is non-null.
 *
 * The date range is two native date inputs (the design system's `TextField`
 * does not pass `type`); the working days in it are listed as removable chips
 * before anything is sent, and `releaseRange` caps them at the contract's 60.
 */

import { useState } from 'react';
import * as z from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@sit-and-park/auth/client';
import { FormField, FormProvider, useAppForm } from '@sit-and-park/form';
import { todayInPrague, useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import { Button, H2, Stack, Text, Strong } from '@shoptet/ui';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { useDeskWriteError } from './my-desks-errors';
import { releaseRange } from './my-desks-view';
import styles from './my-desks.module.css';

const rangeSchema = z.object({ from: z.string(), to: z.string() });
type RangeValues = z.infer<typeof rangeSchema>;

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function ReleaseSection() {
  const t = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const describe = useDeskWriteError();
  const today = todayInPrague();

  const releasesQuery = useQuery({
    ...api.desk.myReleases.queryOptions(),
    enabled: status === 'authenticated',
  });

  const form = useAppForm<RangeValues>({
    schema: rangeSchema,
    defaultValues: { from: today, to: today },
  });
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useNotify(notice, 'success');
  useNotify(failure, 'danger');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: api.desk.key() });
  const release = useMutation({
    ...api.desk.release.mutationOptions(),
    onSuccess: (data) => {
      setFailure(null);
      setNotice(data.added === 0 ? t('releasedNone') : t('releasedAdded', { count: data.added }));
      setRemoved(new Set());
      invalidate();
    },
    onError: (error) => {
      setNotice(null);
      setFailure(describe(error, 'release'));
    },
  });
  const revoke = useMutation({
    ...api.desk.cancelRelease.mutationOptions(),
    onSuccess: () => {
      setFailure(null);
      setNotice(t('revoked'));
      invalidate();
    },
    onError: (error) => {
      setNotice(null);
      setFailure(describe(error, 'other'));
      invalidate();
    },
  });

  const mine = releasesQuery.data;
  if (mine === undefined || mine === null) {
    return null;
  }

  const { from, to } = form.watch();
  const range = isDate(from) && isDate(to) ? releaseRange(from, to, today) : null;
  const dates = (range?.dates ?? []).filter((date) => !removed.has(date));

  return (
    <section className={styles.section} aria-labelledby="my-desks-release">
      <Stack gap="lg">
        <H2 id="my-desks-release">{t('releaseTitle', { code: mine.code })}</H2>
        <Text variant="tertiary">{t('releaseIntro')}</Text>

        <FormProvider {...form}>
          <form
            className={styles.releaseForm}
            onSubmit={form.handleSubmit(() => {
              setNotice(null);
              release.mutate({ dates });
            })}
          >
            <Stack gap="md">
              <div className={styles.dateRow}>
                {(['from', 'to'] as const).map((name) => (
                  <FormField
                    key={name}
                    name={name}
                    render={({ field }) => (
                      <label className={styles.dateField}>
                        <span>{name === 'from' ? t('releaseFrom') : t('releaseTo')}</span>
                        <input
                          type="date"
                          name={field.name}
                          ref={field.ref}
                          value={field.value}
                          min={name === 'from' ? today : from}
                          onBlur={field.onBlur}
                          onChange={(event) => {
                            setRemoved(new Set());
                            field.onChange(event.target.value);
                          }}
                        />
                      </label>
                    )}
                  />
                ))}
              </div>

              {dates.length === 0 ? (
                <Text appearance="sm" variant="tertiary">
                  {t('releaseNoDays')}
                </Text>
              ) : (
                <ul className={styles.chips} aria-label={t('releaseDatesLabel')}>
                  {dates.map((date) => (
                    <li key={date} className={styles.dateChip}>
                      {f.dayMonthAndYear(date)}
                      <button
                        type="button"
                        aria-label={t('releaseRemoveDate', { date: f.dayMonthAndYear(date) })}
                        onClick={() => setRemoved(new Set(removed).add(date))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {range?.truncated === true ? (
                <Text appearance="sm" variant="tertiary">
                  {t('releaseTruncated', { max: range.dates.length })}
                </Text>
              ) : null}

              <div>
                <Button type="submit" disabled={dates.length === 0} isLoading={release.isPending}>
                  {t('releaseSubmit', { count: dates.length })}
                </Button>
              </div>
            </Stack>
          </form>
        </FormProvider>

        <Stack gap="sm">
          <Strong>{t('releasedListTitle')}</Strong>
          {mine.releases.length === 0 ? (
            <Text variant="tertiary">{t('releasesEmpty')}</Text>
          ) : (
            <ul className={styles.rows}>
              {mine.releases.map((entry) => (
                <li key={entry.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Text>
                      {entry.reservedByName === null
                        ? t('releasedFree', { date: f.fullDate(entry.date) })
                        : t('releasedBy', {
                            date: f.fullDate(entry.date),
                            name: entry.reservedByName,
                          })}
                    </Text>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={entry.reservedByName !== null || revoke.isPending}
                    aria-label={t('revokeLabel', { date: f.dayMonthAndYear(entry.date) })}
                    onClick={() => {
                      setNotice(null);
                      revoke.mutate({ releaseId: entry.id });
                    }}
                  >
                    {t('revoke')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Stack>
    </section>
  );
}
