import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from '@sit-and-park/i18n';
import cs from '../../../messages/cs.json';
import type { UserRole } from '@sit-and-park/contract';
import type { Locale } from '@sit-and-park/i18n';
import { ADMIN_ROUTE, DESKS_ROUTE, MY_RESERVATIONS_ROUTE, SETTINGS_ROUTE } from '../../routes';
import { TopBar } from './top-bar';

/**
 * The real `IntlProvider` and the real `Menu`, not doubles: what is under
 * test is which entries the menu offers and what selecting one reports, and
 * both of those are properties of the composition rather than of this file.
 * Only the two callbacks are stubbed, because they are the seam by design.
 */
function renderTopBar(
  overrides: {
    name?: string;
    email?: string;
    role?: UserRole | undefined;
    locale?: Locale;
    pathname?: string;
    dark?: boolean;
  } = {}
) {
  const onNavigate = jest.fn();
  const onSignOut = jest.fn();
  const onLocaleChange = jest.fn();
  const onThemeToggle = jest.fn();

  render(
    <IntlProvider locale="cs" messages={cs}>
      <TopBar
        pathname={overrides.pathname ?? '/'}
        name={overrides.name ?? 'Karel Zíbar'}
        email={overrides.email ?? 'karel.zibar@firma.cz'}
        role={overrides.role}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
        locale={overrides.locale ?? 'cs'}
        onLocaleChange={onLocaleChange}
        dark={overrides.dark ?? false}
        onThemeToggle={onThemeToggle}
      />
    </IntlProvider>
  );

  return { onNavigate, onSignOut, onLocaleChange, onThemeToggle, user: userEvent.setup() };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'userMenu' }));
}

describe('TopBar', () => {
  it('shows the name and the initials next to the logo', () => {
    renderTopBar();

    expect(screen.getAllByText('Karel Zíbar').length).toBeGreaterThan(0);
    expect(screen.getByText('KZ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'brand' })).toBeInTheDocument();
  });

  it('shows the email only inside the menu, not on the bar', async () => {
    const { user } = renderTopBar();

    expect(screen.queryByText('karel.zibar@firma.cz')).not.toBeInTheDocument();
    await openMenu(user);
    expect(screen.getByText('karel.zibar@firma.cz')).toBeInTheDocument();
  });

  describe('for a plain user', () => {
    it('renders no ADMIN badge', () => {
      renderTopBar({ role: 'USER' });
      expect(screen.queryByText('adminBadge')).not.toBeInTheDocument();
    });

    it('offers only settings and sign-out', async () => {
      const { user } = renderTopBar({ role: 'USER' });
      await openMenu(user);

      expect(screen.getByRole('menuitem', { name: 'settings' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'signOut' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /administration/ })).not.toBeInTheDocument();
    });
  });

  describe('for an administrator', () => {
    it('renders the ADMIN badge', () => {
      renderTopBar({ role: 'ADMIN' });
      expect(screen.getByText('adminBadge')).toBeInTheDocument();
    });

    it('offers the administration entry', async () => {
      const { user } = renderTopBar({ role: 'ADMIN' });
      await openMenu(user);

      expect(screen.getByRole('menuitem', { name: /administration/ })).toBeInTheDocument();
    });
  });

  describe('when the role is not known yet', () => {
    // `me.get` is in flight, or it failed. Both reach this component as
    // `role === undefined`, and both have to fail closed.
    it('renders neither the badge nor the administration entry', async () => {
      const { user } = renderTopBar({ role: undefined });

      expect(screen.queryByText('adminBadge')).not.toBeInTheDocument();
      await openMenu(user);
      expect(screen.queryByRole('menuitem', { name: /administration/ })).not.toBeInTheDocument();
    });
  });

  it('navigates to the settings route when settings is chosen', async () => {
    const { user, onNavigate, onSignOut } = renderTopBar({ role: 'USER' });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'settings' }));

    expect(onNavigate).toHaveBeenCalledWith(SETTINGS_ROUTE);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('navigates to the administration route when administration is chosen', async () => {
    const { user, onNavigate } = renderTopBar({ role: 'ADMIN' });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /administration/ }));

    expect(onNavigate).toHaveBeenCalledWith(ADMIN_ROUTE);
  });

  it('signs out when sign-out is chosen, and does not navigate', async () => {
    const { user, onNavigate, onSignOut } = renderTopBar({ role: 'USER' });
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'signOut' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  describe('the language switcher', () => {
    /** The active language is the one item carrying the checkmark. */
    function isMarked(item: HTMLElement) {
      return item.querySelector('[data-active="true"]') !== null;
    }

    it('offers both languages and marks the active one', async () => {
      const { user } = renderTopBar({ locale: 'cs' });
      await openMenu(user);

      expect(isMarked(screen.getByRole('menuitem', { name: /Čeština/ }))).toBe(true);
      expect(isMarked(screen.getByRole('menuitem', { name: /English/ }))).toBe(false);
    });

    it('marks English when English is the active locale', async () => {
      const { user } = renderTopBar({ locale: 'en' });
      await openMenu(user);

      expect(isMarked(screen.getByRole('menuitem', { name: /English/ }))).toBe(true);
      expect(isMarked(screen.getByRole('menuitem', { name: /Čeština/ }))).toBe(false);
    });

    it('reports the language the user picked', async () => {
      const { user, onLocaleChange } = renderTopBar({ locale: 'cs' });
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /English/ }));

      expect(onLocaleChange).toHaveBeenCalledWith('en');
    });

    it('does not report a change when the active language is picked again', async () => {
      const { user, onLocaleChange } = renderTopBar({ locale: 'cs' });
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /Čeština/ }));

      expect(onLocaleChange).not.toHaveBeenCalled();
    });
  });

  describe('the theme toggle', () => {
    it('offers the switch to dark mode with a moon while light, and reports a click', async () => {
      const { user, onThemeToggle } = renderTopBar({ dark: false });
      const button = screen.getByRole('button', { name: 'switchToDark' });

      expect(button.querySelector('svg')).not.toBeNull();
      await user.click(button);
      expect(onThemeToggle).toHaveBeenCalledTimes(1);
    });

    it('offers the switch to light mode while dark', () => {
      renderTopBar({ dark: true });
      expect(screen.getByRole('button', { name: 'switchToLight' })).toBeInTheDocument();
    });

    it('is no longer an entry of the user menu', async () => {
      const { user } = renderTopBar();
      await openMenu(user);
      expect(screen.queryByRole('menuitem', { name: /dark|switchTo/i })).toBeNull();
    });
  });

  it('links the logo to the parking overview', () => {
    renderTopBar();
    expect(screen.getByRole('link', { name: 'brand' })).toHaveAttribute('href', '/');
  });

  describe('the primary navigation', () => {
    it('links parking, desks and my desks', () => {
      renderTopBar();
      const nav = screen.getByRole('navigation', { name: 'primary' });

      expect(within(nav).getByRole('link', { name: 'parking' })).toHaveAttribute('href', '/');
      expect(within(nav).getByRole('link', { name: 'desks' })).toHaveAttribute('href', DESKS_ROUTE);
      expect(within(nav).getByRole('link', { name: 'myReservations' })).toHaveAttribute(
        'href',
        MY_RESERVATIONS_ROUTE
      );
    });

    it('marks exactly the current section', () => {
      renderTopBar({ pathname: DESKS_ROUTE });

      expect(screen.getByRole('link', { name: 'desks' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'parking' })).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('link', { name: 'myReservations' })).not.toHaveAttribute(
        'aria-current'
      );
    });
  });
});
