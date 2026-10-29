'use client';

import { Icon, Text } from '@shoptet/ui';
import type { IconName } from '@shoptet/ui';
import type { ReactNode } from 'react';

import styles from './toast.module.css';

export type ToastTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<ToastTone, IconName> = {
  neutral: 'shp-info',
  info: 'shp-info',
  success: 'shp-checkmark',
  warning: 'shp-tip',
  danger: 'shp-alert',
};

export interface ToastProps {
  /** The message itself. */
  children: ReactNode;
  /** Colour and, for `danger`, the announcement urgency. Defaults to `info`. */
  tone?: ToastTone | undefined;
}

/**
 * A single notice, and itself the live region: `role="status"` (polite) for
 * every tone but `danger`, which is `role="alert"` (assertive). It never takes
 * focus. Presentational on purpose — when it appears and for how long is the
 * caller's state (see `ToastProvider`).
 *
 * Built from `Icon` rather than `SystemMessage`, which hard-codes
 * `role="status"` and would nest a polite region inside the assertive one.
 */
export function Toast({ children, tone = 'info' }: ToastProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={styles.root} data-tone={tone}>
      <span aria-hidden="true" className={styles.icon}>
        <Icon icon={TONE_ICON[tone]} size="sm" />
      </span>

      <div className={styles.body}>
        <Text>{children}</Text>
      </div>
    </div>
  );
}

export interface ToastRegionProps {
  /** `Toast` elements. May be empty — and usually is. */
  children?: ReactNode | undefined;
  /** Accessible name of the region, e.g. `'Oznámení'`. */
  label?: string | undefined;
}

/**
 * Fixed top-right shell that stacks toasts. A named `region`, deliberately not
 * a live region itself: each `Toast` already is one, and nesting a second makes
 * some screen readers announce a message twice. Mounted while empty so the app
 * has a stable node to render into.
 */
export function ToastRegion({ children, label }: ToastRegionProps) {
  return (
    <div role="region" aria-label={label} className={styles.region}>
      {children ? <div className={styles.stack}>{children}</div> : null}
    </div>
  );
}
