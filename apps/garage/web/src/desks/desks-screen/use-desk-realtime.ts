'use client';

/**
 * Keeps the desk directory of the day on screen current: joins the day's room
 * (the same per-day room parking uses) and refetches on `desk:reserved` /
 * `desk:released`.
 *
 * A refetch rather than a cache patch like `../../lot/lot-screen/use-lot-realtime.ts`:
 * a desk's status and the viewer's own fields (`myReservationId`, the banner)
 * are viewer-relative, and the event carries no access or permanent-holder
 * state to recompute them from.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDayRoom, useRealtimeEvent } from '@garage/realtime-client';
import type { DateOnly } from '@garage/i18n';
import { useApi } from '../../shell/api-provider/api-provider';

export function useDeskRealtime(date: DateOnly): void {
  const api = useApi();
  const queryClient = useQueryClient();

  useDayRoom(date);

  const refresh = useCallback(
    (event: { readonly date: string }) => {
      if (event.date !== date) return;
      void queryClient.invalidateQueries({
        queryKey: api.desk.directory.queryOptions({ input: { date } }).queryKey,
      });
    },
    [api, queryClient, date]
  );

  useRealtimeEvent('desk:reserved', refresh);
  useRealtimeEvent('desk:released', refresh);
}
