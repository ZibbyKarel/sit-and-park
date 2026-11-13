'use client';

/**
 * The one place that decides where a `Toast` floats: the shared
 * `notificationsRegion` label, fixed once instead of at each call site.
 *
 * Only rendered from `./toast-provider.tsx` — feature code calls `useNotify`
 * instead of importing `AppToastRegion` directly.
 */

import type { ReactNode } from 'react';
import { ToastRegion } from '../../ui/toast/toast';
import { useTranslations } from '@sit-and-park/i18n';

export interface AppToastRegionProps {
  readonly children?: ReactNode;
}

export function AppToastRegion({ children }: AppToastRegionProps) {
  const tShell = useTranslations('shell');
  return <ToastRegion label={tShell('notificationsRegion')}>{children}</ToastRegion>;
}
