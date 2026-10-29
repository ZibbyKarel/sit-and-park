'use client';

/**
 * What `/admin` renders, given a profile — and nothing about how the profile
 * is obtained.
 *
 * Split out of `app/(app)/admin/page.tsx` for the same reason `TopBar` is
 * split from `AppTopBar`: the *rules* (which of the four states is shown, and
 * on what) belong somewhere a test can reach without a session, a query client
 * and a live API. The page keeps the wiring and has no branches of its own.
 *
 * The five tab bodies arrive as {@link AdminScreenProps.panels} rather than
 * being imported here, for the same reason: each of them is a connected
 * component that fetches, and this file has to stay renderable with nothing but
 * an `IntlProvider`. React elements are inert until rendered, so passing all
 * five costs nothing — `Tabs` mounts only the selected one.
 *
 * The role gate here is a **courtesy**, not the enforcement. Authorization
 * lives on the API, where every admin procedure carries `@Roles('ADMIN')` and
 * `RolesGuard` answers 403 regardless of what any browser believes
 * (`doc/auth.md`). What it does is stop a non-admin who typed the URL from
 * staring at an empty screen wondering why nothing loads — and it fails closed:
 * an unknown role (the profile is still in flight, or it failed) is not an
 * admin.
 */

import { useState, type ReactNode } from 'react';
import { H1, Stack, Tabs, Text } from '@shoptet/ui';
import type { UserRole } from '@garage/contract';
import { useTranslations } from '@garage/i18n';
import { EmptyState } from '../../ui/empty-state/empty-state';
import { ScreenError, ScreenLoading } from '../screen-state/screen-state';
import styles from './admin-screen.module.css';

/** The body of each tab, in the order the design's strip lists them. */
export interface AdminPanels {
  readonly overview: ReactNode;
  readonly users: ReactNode;
  readonly spots: ReactNode;
  readonly window: ReactNode;
  readonly limits: ReactNode;
}

export interface AdminScreenProps {
  /** The caller's role, or `undefined` while it is not known. */
  readonly role: UserRole | undefined;
  /** The profile has not arrived yet. */
  readonly isPending: boolean;
  /** The profile could not be loaded. */
  readonly isError: boolean;
  /** Whatever the failing call threw. See `ScreenErrorProps.error`. */
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly panels: AdminPanels;
}

type AdminTabId = keyof AdminPanels;

export function AdminScreen({
  role,
  isPending,
  isError,
  error,
  onRetry,
  panels,
}: AdminScreenProps) {
  const errors = useTranslations('errors');
  const sections = useTranslations('sections');
  const t = useTranslations('admin');
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');

  if (isPending) {
    return <ScreenLoading />;
  }

  if (isError) {
    return <ScreenError error={error} onRetry={onRetry} headingLevel={2} />;
  }

  if (role !== 'ADMIN') {
    return <EmptyState title={errors('FORBIDDEN')} headingLevel={2} />;
  }

  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <span className={styles.eyebrow}>
          <Text appearance="strong-sm" variant="secondary">
            {t('eyebrow')}
          </Text>
        </span>
        <H1>{sections('administration')}</H1>
      </Stack>
      <Tabs
        tabs={[
          { id: 'overview', title: t('tabOverview'), content: panels.overview },
          { id: 'users', title: t('tabUsers'), content: panels.users },
          { id: 'spots', title: t('tabSpots'), content: panels.spots },
          { id: 'window', title: t('tabWindow'), content: panels.window },
          { id: 'limits', title: t('tabLimits'), content: panels.limits },
        ]}
        activeTabId={activeTab}
        onTabChange={setActiveTab}
        autoActivate
      />
    </Stack>
  );
}
