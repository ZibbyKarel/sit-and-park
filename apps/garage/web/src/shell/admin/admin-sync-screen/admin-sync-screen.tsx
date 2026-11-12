'use client';

/**
 * The "Synchronizace zaměstnanců" tab: whether the API has a sync key, the
 * dry-run / live switch and the last runs with what each did.
 *
 * Dry run is the default and logs only; live applies the list. Flipping it is
 * therefore behind a confirmation that says which of the two the admin is
 * choosing. The sync itself is `POST /api/employee-sync` (a Keboola flow, not
 * a browser), so nothing here can start a run.
 */

import { useState, type ReactNode } from 'react';
import { useRequireAuth } from '@garage/auth/client';
import type { EmployeeSyncRun } from '@garage/contract';
import { useFormatter, useTranslations } from '@garage/i18n';
import { Button, Stack, Tag, Text } from '@shoptet/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../../ui/confirm-dialog/confirm-dialog';
import { useApi } from '../../api-provider/api-provider';
import { ScreenDataGuard, screenDataOf } from '../../screen-state/screen-state';
import { useAdminFailure } from '../use-admin-failure';
import styles from './admin-sync-screen.module.css';
import { isCapped, reasonDetailOf, reasonKeyOf } from './sync-view';

export function AdminSyncScreen() {
  const t = useTranslations('adminSync');
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const failure = useAdminFailure();
  const [confirming, setConfirming] = useState(false);

  const syncQuery = useQuery({
    ...api.admin.employeeSync.get.queryOptions({ input: {} }),
    enabled: status === 'authenticated',
  });
  const setLiveMode = useMutation({
    ...api.admin.employeeSync.setLiveMode.mutationOptions(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: api.admin.employeeSync.key() });
    },
  });

  return (
    <ScreenDataGuard
      state={screenDataOf(syncQuery)}
      onRetry={() => void syncQuery.refetch()}
      headingLevel={3}
    >
      {({ configured, liveMode, runs }) => {
        const next = !liveMode;
        return (
          <Stack gap="xl">
            <Stack gap="sm">
              <Text appearance="strong-lg">{t('title')}</Text>
              <Text variant="secondary">{t('description')}</Text>
            </Stack>

            <Stack gap="md">
              <Stack orientation="horizontal" align="center" gap="sm">
                <Text>{t('keyStatus')}</Text>
                <Tag level={configured ? 'success' : 'alert'}>
                  {configured ? t('keyConfigured') : t('keyMissing')}
                </Tag>
              </Stack>
              {configured ? null : <Text variant="secondary">{t('keyMissingHint')}</Text>}
              <Stack orientation="horizontal" align="center" gap="sm">
                <Text>{t('modeLabel')}</Text>
                <Tag level={liveMode ? 'success' : 'default'}>
                  {liveMode ? t('modeLive') : t('modeDry')}
                </Tag>
                <Button
                  variant="secondary"
                  onClick={() => {
                    failure.clear();
                    setConfirming(true);
                  }}
                >
                  {liveMode ? t('switchToDry') : t('switchToLive')}
                </Button>
              </Stack>
            </Stack>

            <Stack gap="sm">
              <Text appearance="strong-md">{t('runsTitle')}</Text>
              {runs.length === 0 ? (
                <Text variant="secondary">{t('runsEmpty')}</Text>
              ) : (
                <ul className={styles.runs}>
                  {runs.map((run) => (
                    <li key={run.id} className={styles.run}>
                      <RunDetails run={run} />
                    </li>
                  ))}
                </ul>
              )}
            </Stack>

            <ConfirmDialog
              open={confirming}
              tone={next ? 'danger' : 'default'}
              title={next ? t('confirmLiveTitle') : t('confirmDryTitle')}
              description={next ? t('confirmLiveDescription') : t('confirmDryDescription')}
              confirmLabel={next ? t('confirmLiveAction') : t('confirmDryAction')}
              cancelLabel={t('cancel')}
              loading={setLiveMode.isPending}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                void failure
                  .run('syncLiveMode', setLiveMode.mutateAsync({ liveMode: next }))
                  .then((ok) => {
                    if (ok) setConfirming(false);
                  });
              }}
            >
              {failure.message ? <Text variant="secondary">{failure.message}</Text> : null}
            </ConfirmDialog>
          </Stack>
        );
      }}
    </ScreenDataGuard>
  );
}

function Section<T>({
  title,
  items,
  row,
}: {
  readonly title: string;
  readonly items: readonly T[];
  readonly row: (item: T) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text appearance="strong-md">{title}</Text>
      <ul className={styles.list}>
        {items.map((item, index) => (
          <li key={index}>{row(item)}</li>
        ))}
      </ul>
    </Stack>
  );
}

function RunDetails({ run }: { readonly run: EmployeeSyncRun }) {
  const t = useTranslations('adminSync');
  const format = useFormatter();
  const { summary } = run;
  const when = format.dateTime(new Date(run.createdAt), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  });
  const reasonKey = run.reason === null ? null : reasonKeyOf(run.reason);
  // A capped list may have been cut off, so its length is only a lower bound.
  const count = (list: readonly unknown[]) => (isCapped(list) ? `${list.length}+` : list.length);

  return (
    <details>
      <summary className={styles.summary}>
        <Text appearance="strong-md">{when}</Text>
        <Text variant="secondary">{run.source}</Text>
        <Tag level="default">{run.mode === 'LIVE' ? t('modeLive') : t('modeDry')}</Tag>
        <Tag level={run.status === 'OK' ? 'success' : 'error'}>
          {run.status === 'OK' ? t('statusOk') : t('statusRejected')}
        </Tag>
        <Text variant="secondary">
          {t('runCounts', {
            created: count(summary.created),
            renamed: count(summary.renamed),
            deactivated: count(summary.deactivated),
            reactivated: count(summary.reactivated),
          })}
        </Text>
      </summary>
      <div className={styles.body}>
        <Stack gap="md">
          {run.reason === null ? null : (
            <Stack gap="xs">
              <Text appearance="strong-md">{reasonKey === null ? run.reason : t(reasonKey)}</Text>
              {reasonKey === null ? null : (
                <Text variant="tertiary">{reasonDetailOf(run.reason)}</Text>
              )}
            </Stack>
          )}
          <Text variant="secondary">
            {t('runTotals', {
              received: summary.received,
              activeBefore: summary.activeBefore,
              linked: summary.linked,
              unchanged: summary.unchanged,
            })}
          </Text>
          <Section
            title={t('sectionCreated', { count: count(summary.created) })}
            items={summary.created}
            row={(item) => `${item.name} (${item.email})`}
          />
          <Section
            title={t('sectionRenamed', { count: count(summary.renamed) })}
            items={summary.renamed}
            row={(item) => t('renamedLine', { email: item.email, from: item.from, to: item.to })}
          />
          <Section
            title={t('sectionDeactivated', { count: count(summary.deactivated) })}
            items={summary.deactivated}
            row={(item) => (
              <>
                {item.name} ({item.email}) ·{' '}
                {t('deactivatedFreed', {
                  deskReservations: item.freedDeskReservations,
                  parkingReservations: item.freedParkingReservations,
                  waitlist: item.removedWaitlistEntries,
                  requests: item.rejectedRequests,
                })}
                {item.permanentDesks.length === 0
                  ? null
                  : ` · ${t('deactivatedPermanentDesks', { desks: item.permanentDesks.join(', ') })}`}
                {item.ownedHives.length === 0
                  ? null
                  : ` · ${t('deactivatedOwnedHives', { hives: item.ownedHives.join(', ') })}`}
              </>
            )}
          />
          <Section
            title={t('sectionReactivated', { count: count(summary.reactivated) })}
            items={summary.reactivated}
            row={(item) => `${item.name} (${item.email})`}
          />
          <Section
            title={t('sectionWarnings', { count: count(summary.warnings) })}
            items={summary.warnings}
            row={(item) => item}
          />
        </Stack>
      </div>
    </details>
  );
}
