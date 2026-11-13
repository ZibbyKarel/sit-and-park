'use client';

/**
 * The one cancel path for My reservations: the list (single and bulk) and the
 * calendar's detail dialog both go through here.
 *
 * Loops `reservation.cancel` / `desk.cancel` by kind — the contract has no bulk
 * procedure — and reports the keys that failed so a caller can keep them
 * selected for a retry.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from '@sit-and-park/i18n';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { useDeskWriteError } from './my-reservations-errors';

export interface CancelTarget {
  readonly kind: 'parking' | 'desk';
  /** `kind:id`, as `MyListEntry.key`. */
  readonly key: string;
  readonly reservationId: string;
}

export function useCancelReservations() {
  const t = useTranslations('myDesks');
  const api = useApi();
  const queryClient = useQueryClient();
  const describe = useDeskWriteError();
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useNotify(notice, 'success');
  useNotify(failure, 'danger');

  const cancelDesk = useMutation(api.desk.cancel.mutationOptions());
  const cancelParking = useMutation(api.reservation.cancel.mutationOptions());

  async function cancel(targets: readonly CancelTarget[]): Promise<ReadonlySet<string>> {
    setNotice(null);
    setFailure(null);
    setBusy(true);
    const failedKeys = new Set<string>();
    let lastError: unknown = null;
    for (const target of targets) {
      try {
        await (target.kind === 'parking' ? cancelParking : cancelDesk).mutateAsync({
          reservationId: target.reservationId,
        });
      } catch (error) {
        failedKeys.add(target.key);
        lastError = error;
      }
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: api.desk.key() });
    void queryClient.invalidateQueries({ queryKey: api.reservation.key() });
    void queryClient.invalidateQueries({ queryKey: api.overview.key() });
    void queryClient.invalidateQueries({ queryKey: api.admin.reservation.key() });
    if (failedKeys.size === 0) {
      setNotice(
        targets.length === 1 ? t('cancelledOne') : t('cancelledMany', { count: targets.length })
      );
    } else if (targets.length === 1) {
      setFailure(describe(lastError, 'cancel'));
    } else {
      setFailure(t('bulkPartial', { failed: failedKeys.size, total: targets.length }));
    }
    return failedKeys;
  }

  return { busy, cancel };
}
