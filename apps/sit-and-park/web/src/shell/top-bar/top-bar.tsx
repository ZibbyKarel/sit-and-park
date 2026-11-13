'use client';

/**
 * The bar every signed-in screen sits under: the logo on the left, the
 * identity and its menu on the right.
 *
 * Drawn from the design's avatar menu. The menu's
 * keyboard behaviour, focus and Escape handling all come from `@shoptet/ui`'s
 * `Menu`.
 *
 * It takes what it draws as props and reports what was chosen through two
 * callbacks; `../app-top-bar.tsx` is the half that reads the session and the
 * profile. The split is not ceremony: every rule this file encodes — when the
 * admin crown appears, when `Správa` appears, what the initials are, which
 * entry is destructive — is then a pure function of its input, and a test can
 * ask about all of them without a router, a session or a network.
 */

import { Avatar, Icon, Menu, Stack, Text } from '@shoptet/ui';
import type { UserRole } from '@sit-and-park/contract';
import { useTranslations } from '@sit-and-park/i18n';
import NextLink from 'next/link';
import {
  ADMIN_ROUTE,
  DESKS_ROUTE,
  LOT_ROUTE,
  MY_RESERVATIONS_ROUTE,
  SETTINGS_ROUTE,
} from '../../routes';
import { MoonIcon, SunIcon } from '../../ui/icons/icons';
import styles from './top-bar.module.css';

/** Menu entry ids. `onSelect` is called with one of these. */
export const MENU_SETTINGS = 'settings';
export const MENU_SIGN_OUT = 'sign-out';

/**
 * The primary sections, in bar order. Admin screens for desks are tabs of
 * `ADMIN_ROUTE`, reached from the admin-only `Správa` item appended after
 * these, not items here.
 */
const NAV_ITEMS = [
  { route: LOT_ROUTE, key: 'parking' },
  { route: DESKS_ROUTE, key: 'desks' },
  { route: MY_RESERVATIONS_ROUTE, key: 'myReservations' },
] as const;

export interface TopBarProps {
  /** The current path, so the active section is marked with `aria-current`. */
  readonly pathname: string;
  /** Display name. Empty while neither the session nor the profile has one. */
  readonly name: string;
  /** Shown under the name inside the menu. */
  readonly email: string;
  /**
   * The caller's role, or `undefined` while `me.get` is in flight or after it
   * failed. Anything other than `ADMIN` — `undefined` included — hides both the
   * badge and the `Správa` tab: unknown is not an admin.
   */
  readonly role?: UserRole | undefined;
  /** Called with {@link SETTINGS_ROUTE}. */
  readonly onNavigate: (route: string) => void;
  readonly onSignOut: () => void;
  /** Whether dark mode is on, so the toggle offers the opposite. */
  readonly dark: boolean;
  readonly onThemeToggle: () => void;
}

export function TopBar({
  pathname,
  name,
  email,
  role,
  onNavigate,
  onSignOut,
  dark,
  onThemeToggle,
}: TopBarProps) {
  const t = useTranslations('nav');
  const tShell = useTranslations('shell');
  const isAdmin = role === 'ADMIN';
  const navItems = isAdmin
    ? [...NAV_ITEMS, { route: ADMIN_ROUTE, key: 'administration' } as const]
    : NAV_ITEMS;

  const onSelect = (id: string) => {
    if (id === MENU_SETTINGS) {
      onNavigate(SETTINGS_ROUTE);
    } else if (id === MENU_SIGN_OUT) {
      onSignOut();
    }
  };

  return (
    <header className={styles.bar}>
      {/* Logo without the claim (that lives on the login screen), linking to the landing page. */}
      <NextLink href="/" className={styles.brandLink}>
        <img
          src="/sit-and-park-logo-compact.svg"
          alt={tShell('brand')}
          height={44}
          className={styles.brandLogo}
        />
      </NextLink>

      <nav aria-label={t('primary')} className={styles.nav}>
        {navItems.map((item) => (
          <NextLink
            key={item.route}
            href={item.route}
            className={styles.navLink}
            aria-current={pathname === item.route ? 'page' : undefined}
          >
            {t(item.key)}
          </NextLink>
        ))}
      </nav>

      <Stack orientation="horizontal" align="center" gap="md">
        <button
          type="button"
          className={styles.themeToggle}
          onClick={onThemeToggle}
          aria-label={dark ? t('switchToLight') : t('switchToDark')}
        >
          {dark ? <SunIcon size="md" /> : <MoonIcon size="md" />}
        </button>

        <Menu
          placement="bottom end"
          trigger={({ props }) => (
            <button type="button" {...props} aria-label={t('userMenu')} className={styles.trigger}>
              <span className={styles.avatar}>
                <Avatar name={name} variant="image" />
                {isAdmin ? (
                  <span className={styles.crown} aria-hidden="true" data-testid="admin-crown">
                    <Icon icon="shp-crown" size="sm" />
                  </span>
                ) : null}
              </span>
              <Text appearance="strong-md">{name}</Text>
              <span aria-hidden="true">▾</span>
            </button>
          )}
        >
          {/* Disabled, so the arrow keys skip it: this is the identity header, not a choice. */}
          <Menu.Item disabled>
            <div className={styles.identity}>
              <Text appearance="strong-md">{name}</Text>
              <Text appearance="sm" variant="secondary">
                {email}
              </Text>
              {isAdmin ? (
                <Text appearance="sm" variant="secondary">
                  {t('adminBadge')}
                </Text>
              ) : null}
            </div>
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item onAction={() => onSelect(MENU_SETTINGS)}>{t('settings')}</Menu.Item>
          <Menu.Divider />
          <Menu.Item destructive onAction={() => onSelect(MENU_SIGN_OUT)}>
            {t('signOut')}
          </Menu.Item>
        </Menu>
      </Stack>
    </header>
  );
}
