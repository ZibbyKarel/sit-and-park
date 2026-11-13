'use client';

/**
 * The bar every signed-in screen sits under: the logo on the left, the
 * identity and its menu on the right.
 *
 * Drawn from `doc/design/screens/02-avatar-menu.png` and the markup behind it
 * (`doc/design/sit-and-park-design.dc.html`, the `isApp` branch). The menu's
 * keyboard behaviour, focus and Escape handling all come from `@shoptet/ui`'s
 * `Menu`.
 *
 * It takes what it draws as props and reports what was chosen through two
 * callbacks; `../app-top-bar.tsx` is the half that reads the session and the
 * profile. The split is not ceremony: every rule this file encodes — when the
 * `ADMIN` badge appears, when `Správa` appears, what the initials are, which
 * entry is destructive — is then a pure function of its input, and a test can
 * ask about all of them without a router, a session or a network.
 */

import { Avatar, Icon, Menu, Stack, Tag, Text } from '@shoptet/ui';
import type { UserRole } from '@sit-and-park/contract';
import { LOCALES, LOCALE_LABELS, isLocale, useTranslations, type Locale } from '@sit-and-park/i18n';
import NextLink from 'next/link';
import { ADMIN_ROUTE, DESKS_ROUTE, LOT_ROUTE, MY_DESKS_ROUTE, SETTINGS_ROUTE } from '../../routes';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import styles from './top-bar.module.css';

/** Menu entry ids. `onSelect` is called with one of these. */
export const MENU_SETTINGS = 'settings';
export const MENU_ADMIN = 'administration';
export const MENU_SIGN_OUT = 'sign-out';

/** Prefix of the menu item id for a language choice: `locale:cs`, `locale:en`. */
export const MENU_LOCALE_PREFIX = 'locale:';

/**
 * The primary sections, in bar order. Admin screens for desks are tabs of
 * `ADMIN_ROUTE`, reached from the menu's `Správa` entry, not items here.
 */
const NAV_ITEMS = [
  { route: LOT_ROUTE, key: 'parking' },
  { route: DESKS_ROUTE, key: 'desks' },
  { route: MY_DESKS_ROUTE, key: 'myDesks' },
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
   * badge and the `Správa` entry: unknown is not an admin.
   */
  readonly role?: UserRole | undefined;
  /** Called with {@link ADMIN_ROUTE} or {@link SETTINGS_ROUTE}. */
  readonly onNavigate: (route: string) => void;
  readonly onSignOut: () => void;
  /** The active locale, so the menu can mark it. */
  readonly locale: Locale;
  /** Called with the locale the user picked. Never called for the active one. */
  readonly onLocaleChange: (locale: Locale) => void;
  /** Whether dark mode is on, so the menu can mark it. */
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
  locale,
  onLocaleChange,
  dark,
  onThemeToggle,
}: TopBarProps) {
  const t = useTranslations('nav');
  const tShell = useTranslations('shell');
  const isAdmin = role === 'ADMIN';

  const onSelect = (id: string) => {
    if (id === MENU_SETTINGS) {
      onNavigate(SETTINGS_ROUTE);
    } else if (id === MENU_ADMIN) {
      onNavigate(ADMIN_ROUTE);
    } else if (id.startsWith(MENU_LOCALE_PREFIX)) {
      const picked = id.slice(MENU_LOCALE_PREFIX.length);
      // Re-picking the active language is a no-op rather than a reload: the
      // cookie is already set and `router.refresh()` would repaint for nothing.
      if (isLocale(picked) && picked !== locale) {
        onLocaleChange(picked);
      }
    } else if (id === MENU_SIGN_OUT) {
      onSignOut();
    }
  };

  return (
    <header className={styles.bar}>
      {/* Full logo (symbol, name, claim) linking to the landing page. */}
      <NextLink href="/" className={styles.brandLink}>
        <img src="/sit-and-park-logo.svg" alt={tShell('brand')} height={44} />
      </NextLink>

      <nav aria-label={t('primary')} className={styles.nav}>
        {NAV_ITEMS.map((item) => (
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
        {isAdmin ? (
          <span className={styles.adminBadge}>
            <Tag level="notice">{t('adminBadge')}</Tag>
          </span>
        ) : null}

        <Menu
          placement="bottom end"
          trigger={({ props }) => (
            <button type="button" {...props} aria-label={t('userMenu')} className={styles.trigger}>
              <Avatar name={name} />
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
            </div>
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item onAction={() => onSelect(MENU_SETTINGS)}>{t('settings')}</Menu.Item>
          {/* Desk administration lives in the admin screen's tabs; this one entry reaches it. */}
          {isAdmin ? (
            <Menu.Item onAction={() => onSelect(MENU_ADMIN)}>
              <span className={styles.entry}>
                {t('administration')}
                {/* The design draws a right arrow on this entry alone: it leaves the current screen. */}
                <span aria-hidden="true">→</span>
              </span>
            </Menu.Item>
          ) : null}
          <Menu.Divider />
          {/* `Menu` has no radio items, so the active language carries a checkmark and is a plain item. */}
          <Menu.Item disabled>
            <Text appearance="sm" variant="secondary">
              {t('language')}
            </Text>
          </Menu.Item>
          {LOCALES.map((candidate) => (
            <Menu.Item
              key={candidate}
              onAction={() => onSelect(`${MENU_LOCALE_PREFIX}${candidate}`)}
            >
              <span className={styles.entry}>
                {LOCALE_LABELS[candidate]}
                {candidate === locale ? (
                  <span data-active="true">
                    <Icon icon="shp-checkmark" size="sm" />
                    <VisuallyHidden> {t('languageCurrent')}</VisuallyHidden>
                  </span>
                ) : null}
              </span>
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item onAction={onThemeToggle}>
            <span className={styles.entry}>
              {t('darkMode')}
              {dark ? (
                <span data-active="true">
                  <Icon icon="shp-checkmark" size="sm" />
                  <VisuallyHidden> {t('darkModeOn')}</VisuallyHidden>
                </span>
              ) : null}
            </span>
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item destructive onAction={() => onSelect(MENU_SIGN_OUT)}>
            {t('signOut')}
          </Menu.Item>
        </Menu>
      </Stack>
    </header>
  );
}
