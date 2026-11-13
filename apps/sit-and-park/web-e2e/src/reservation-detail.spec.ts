/**
 * A desk reservation opened from the "Moje rezervace" calendar: its detail
 * dialog shows the desk on the floor plan, and cancels from there.
 *
 * D-004 on its own day (`SPEC_DAY_SLOTS.reservationDetail`); `desks.spec.ts`
 * books D-001 and D-002, so the two specs never share a desk.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import { bookDesk, deskShape, goToDesksDay, MY_RESERVATIONS_PATH } from './support/desk-page';
import { expect, test } from './support/fixtures';
import { FIRST_ROUTE_VISIT_TIMEOUT_MS } from './support/lot-page';
import type { Page } from '@playwright/test';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.reservationDetail);
const DESK = 'D-004';

test.describe.configure({ mode: 'serial' });

function calendarDeskEvent(page: Page) {
  return page
    .getByRole('grid', { name: 'Kalendář rezervací' })
    .getByRole('button', { name: `Stůl ${DESK}` });
}

/** The e2e month is the month after today, so the calendar needs one step forward. */
async function openDetail(page: Page) {
  await page.goto(MY_RESERVATIONS_PATH);
  await page
    .getByRole('button', { name: 'Další měsíc' })
    .click({ timeout: FIRST_ROUTE_VISIT_TIMEOUT_MS });
  await calendarDeskEvent(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `Rezervace ${DESK}` })).toBeVisible();
  return dialog;
}

test("a desk reservation's detail shows the desk on the plan", async ({ userPage }) => {
  await goToDesksDay(userPage, DATE);
  await bookDesk(userPage, DESK);

  const dialog = await openDetail(userPage);
  await dialog.getByRole('link', { name: 'Zobrazit na plánku' }).click();

  await expect(userPage).toHaveURL(new RegExp(`/desks\\?date=${DATE}&desk=`));
  await expect(deskShape(userPage, DESK)).toHaveAttribute('aria-pressed', 'true');
  await expect(deskShape(userPage, DESK)).toBeFocused();
});

test('the holder cancels it from the calendar detail', async ({ userPage }) => {
  const dialog = await openDetail(userPage);
  await dialog.getByRole('button', { name: 'Zrušit rezervaci' }).click();

  await expect(userPage.getByText('Rezervace byla zrušena.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(calendarDeskEvent(userPage)).toHaveCount(0);
});
