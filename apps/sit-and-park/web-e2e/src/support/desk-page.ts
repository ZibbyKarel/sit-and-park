/**
 * The desk screens (`/desks`, `/reservations`), as the specs talk to them.
 *
 * Same rules as `lot-page.ts`: roles and the Czech accessible names the UI
 * renders (`messages/cs.json`'s `desks` and `myDesks` namespaces), no
 * `data-testid`, and every wait on a condition.
 *
 * Unlike the parking overview, the desks day lives in the URL (`?date=`), so a
 * spec reaches its day with one `goto` instead of the date-picker dialog.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { DateOnly } from '@sit-and-park/shared-types';
import { FIRST_ROUTE_VISIT_TIMEOUT_MS } from './lot-page';

export const DESKS_PATH = '/desks';
export const MY_RESERVATIONS_PATH = '/reservations';

/** `desks.status*` of `cs.json`: what a desk's accessible name says it is. */
export const DESK_STATUS = {
  free: 'volný',
  mine: 'můj',
  reserved: 'obsazený',
  assigned: 'trvale přiřazený',
  inactive: 'neaktivní',
} as const;

/**
 * A desk on the floor plan. Its accessible name is
 * `Stůl <code>, <status>[, Hive <hive>]` (`desks.deskAria*`), so the comma
 * anchors the code: `D-01` never matches `D-013`.
 */
export function deskShape(page: Page, code: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^Stůl ${code},`, 'u') });
}

export function deskDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/** Opens `/desks` on `date` and waits for the plan to be drawn. */
export async function goToDesksDay(page: Page, date: DateOnly): Promise<void> {
  await page.goto(`${DESKS_PATH}?date=${date}`);
  // Any desk will do; D-001 exists in the Praha plan the migration creates.
  await expect(deskShape(page, 'D-001')).toBeVisible({ timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });
}

export async function expectDeskStatus(page: Page, code: string, status: string): Promise<void> {
  await expect(deskShape(page, code)).toHaveAttribute(
    'aria-label',
    new RegExp(`^Stůl ${code}, ${status}(,|$)`, 'u')
  );
}

export async function openDesk(page: Page, code: string): Promise<Locator> {
  await deskShape(page, code).click();
  const dialog = deskDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `Stůl ${code}` })).toBeVisible();
  return dialog;
}

export async function closeDeskDialog(page: Page): Promise<void> {
  await deskDialog(page).getByRole('button', { name: 'Zavřít', exact: true }).click();
  await expect(deskDialog(page)).toBeHidden();
}

/** Books the open day for `code` and closes the dialog once the result is shown. */
export async function bookDesk(page: Page, code: string): Promise<void> {
  const dialog = await openDesk(page, code);
  await dialog.getByRole('button', { name: 'Rezervovat na tento den' }).click();
  await expect(dialog.getByText('Rezervováno: 1')).toBeVisible();
  await closeDeskDialog(page);
}

/** Cancels the caller's own reservation of `code` on the open day. */
export async function cancelMyDesk(page: Page, code: string): Promise<void> {
  const dialog = await openDesk(page, code);
  await dialog.getByRole('button', { name: 'Zrušit moji rezervaci' }).click();
  await expect(dialog).toBeHidden();
}

/** Opens `/reservations`, switches to the "Seznam" tab and waits for the first section. */
export async function goToMyReservations(page: Page): Promise<void> {
  await page.goto(MY_RESERVATIONS_PATH);
  await page
    .getByRole('radio', { name: 'Seznam' })
    .click({ timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });
  await expect(page.getByRole('heading', { name: 'Moje rezervace stolů' })).toBeVisible({
    timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS,
  });
  // The H2s sit outside each section's data guard, so the heading alone says nothing
  // about the data: an "absent" assertion would pass while it is still loading.
  await expect(page.getByRole('status').filter({ hasText: 'Načítá se' })).toHaveCount(0);
}

/** A section of the "Seznam" tab of `/reservations` by its heading. */
export function myReservationsSection(page: Page, heading: string): Locator {
  return page.getByRole('region', { name: heading });
}
