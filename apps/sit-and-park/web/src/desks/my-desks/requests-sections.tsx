'use client';

/**
 * "Moje žádosti o schválení" and "Žádosti ke schválení" (the caller's inbox as
 * a hive owner or admin, shown when it has rows or the caller could have some).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@sit-and-park/auth/client';
import { useDateFormatters, useTranslations } from '@sit-and-park/i18n';
import type { DeskApprovalStatus } from '@sit-and-park/contract';
import { Button, H2, Stack, Tag, Text, Strong } from '@shoptet/ui';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { ScreenDataGuard, screenDataOf } from '../../shell/screen-state/screen-state';
import { useCurrentUser } from '../../shell/use-current-user';
import { useDeskWriteError } from './my-desks-errors';
import styles from './my-desks.module.css';

const STATUS_LEVEL = {
  PENDING: 'alert',
  APPROVED: 'success',
  REJECTED: 'error',
} as const satisfies Record<DeskApprovalStatus, 'alert' | 'success' | 'error'>;

export function MyRequestsSection() {
  const t = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const describe = useDeskWriteError();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useNotify(notice, 'success');
  useNotify(failure, 'danger');

  const query = useQuery({
    ...api.desk.myRequests.queryOptions(),
    enabled: status === 'authenticated',
  });
  const cancel = useMutation({
    ...api.desk.cancelRequest.mutationOptions(),
    onSuccess: () => {
      setFailure(null);
      setNotice(t('requestCancelled'));
    },
    onError: (error) => {
      setNotice(null);
      setFailure(describe(error, 'other'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: api.desk.key() }),
  });

  return (
    <section className={styles.section} aria-labelledby="my-desks-requests">
      <Stack gap="lg">
        <H2 id="my-desks-requests">{t('requestsTitle')}</H2>
        <ScreenDataGuard
          state={screenDataOf(query)}
          onRetry={() => void query.refetch()}
          headingLevel={3}
        >
          {({ requests }) =>
            requests.length === 0 ? (
              <Text variant="tertiary">{t('requestsEmpty')}</Text>
            ) : (
              <ul className={styles.rows}>
                {requests.map((request) => (
                  <li key={request.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <Strong>{request.deskCode}</Strong>
                      <Text appearance="sm" variant="tertiary">
                        {t('requestDetail', {
                          date: f.fullDate(request.date),
                          zone: request.zoneName,
                        })}
                      </Text>
                    </div>
                    <Tag level={STATUS_LEVEL[request.status]}>{t(`status${request.status}`)}</Tag>
                    {request.status === 'PENDING' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={cancel.isPending}
                        aria-label={t('cancelRequestLabel', {
                          code: request.deskCode,
                          date: f.dayMonthAndYear(request.date),
                        })}
                        onClick={() => {
                          setNotice(null);
                          cancel.mutate({ requestId: request.id });
                        }}
                      >
                        {t('cancelRequest')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </ScreenDataGuard>
      </Stack>
    </section>
  );
}

export function InboxSection() {
  const t = useTranslations('myDesks');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const viewer = useCurrentUser();
  const describe = useDeskWriteError();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useNotify(notice, 'success');
  useNotify(failure, 'danger');

  const query = useQuery({
    ...api.desk.pendingRequests.queryOptions(),
    enabled: status === 'authenticated',
  });
  const decide = useMutation({
    ...api.desk.decideRequest.mutationOptions(),
    onSuccess: (data) => {
      setFailure(null);
      setNotice(data.reservation === null ? t('rejected') : t('approved'));
    },
    onError: (error) => {
      setNotice(null);
      setFailure(describe(error, 'decide'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: api.desk.key() }),
  });

  const mayDecide = viewer.data?.ownsHive === true || viewer.data?.role === 'ADMIN';
  const hasRows = (query.data?.requests.length ?? 0) > 0;
  if (!hasRows && !mayDecide) {
    return null;
  }

  return (
    <section className={styles.section} aria-labelledby="my-desks-inbox">
      <Stack gap="lg">
        <H2 id="my-desks-inbox">{t('inboxTitle')}</H2>
        <ScreenDataGuard
          state={screenDataOf(query)}
          onRetry={() => void query.refetch()}
          headingLevel={3}
        >
          {({ requests }) =>
            requests.length === 0 ? (
              <Text variant="tertiary">{t('inboxEmpty')}</Text>
            ) : (
              <ul className={styles.rows}>
                {requests.map((request) => (
                  <li key={request.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <Strong>
                        {t('inboxRow', {
                          code: request.deskCode,
                          requester: request.requesterName,
                        })}
                      </Strong>
                      <Text appearance="sm" variant="tertiary">
                        {t('inboxDetail', {
                          date: f.fullDate(request.date),
                          hive: request.hiveName,
                        })}
                      </Text>
                    </div>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      aria-label={t('approveLabel', {
                        code: request.deskCode,
                        requester: request.requesterName,
                      })}
                      onClick={() => {
                        setNotice(null);
                        decide.mutate({ requestId: request.id, approve: true });
                      }}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={decide.isPending}
                      aria-label={t('rejectLabel', {
                        code: request.deskCode,
                        requester: request.requesterName,
                      })}
                      onClick={() => {
                        setNotice(null);
                        decide.mutate({ requestId: request.id, approve: false });
                      }}
                    >
                      {t('reject')}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </ScreenDataGuard>
      </Stack>
    </section>
  );
}
