/**
 * A permanent desk, released for a day and booked by someone else.
 *
 * The seeded permanent holder (`desk@example.com`) is not a persona, so the
 * spec makes one: `Dev Admin` is assigned D-007 and cleared at the end. Admin
 * is the one persona no other desk spec books desks for — a permanent holder
 * cannot book any other desk, and assigning one cancels the holder's other
 * future reservations, so handing D-007 to `Dev User` or `Dev User Two` would
 * break the specs running beside this one.
 */

import type { Page } from '@playwright/test';
import { goToAdminTab } from './support/admin-page';
import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import {
  bookDesk,
  cancelMyDesk,
  DESK_STATUS,
  deskShape,
  expectDeskStatus,
  goToDesksDay,
  goToMyReservations,
  myReservationsSection,
} from './support/desk-page';
import { expect, test } from './support/fixtures';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.deskRelease);
const DESK = 'D-007';

test.describe.configure({ mode: 'serial' });

async function setHolder(page: Page, holder: string): Promise<void> {
  const panel = await goToAdminTab(page, 'desks');
  await deskShape(page, DESK).click();
  const editor = panel.getByRole('region', { name: `Stůl ${DESK}` });
  // Not `selectOption`: its substring match on "Držitel" also finds "Uložit
  // držitele". The trigger's name is "<current value>, Držitel".
  await editor.getByRole('button', { name: /, Držitel$/u }).click();
  await page.getByRole('listbox').getByRole('option', { name: holder, exact: true }).click();
  await editor.getByRole('button', { name: 'Uložit držitele' }).click();
  await expect(editor.getByRole('button', { name: 'Uložit držitele' })).toBeDisabled();
}

test('an admin assigns the desk; on an unreleased day nobody else can book it', async ({
  adminPage,
  userPage,
}) => {
  await setHolder(adminPage, 'Dev Admin (admin@example.com)');

  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.assigned);
});

test('the holder releases a day and another user books it', async ({ adminPage, userPage }) => {
  await goToMyReservations(adminPage);
  const release = myReservationsSection(adminPage, `Můj stálý stůl ${DESK}`);
  await release.getByLabel('Od', { exact: true }).fill(DATE);
  await release.getByLabel('Do', { exact: true }).fill(DATE);
  await release.getByRole('button', { name: 'Uvolnit 1 pracovní den' }).click();
  await expect(
    adminPage.getByRole('status').filter({ hasText: 'Uvolněno nových dní: 1.' })
  ).toBeVisible();
  await expect(release).toContainText('uvolněno, zatím volné');

  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);
  await bookDesk(userPage, DESK);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.mine);

  await goToMyReservations(adminPage);
  await expect(myReservationsSection(adminPage, `Můj stálý stůl ${DESK}`)).toContainText(
    'rezervoval(a) Dev User'
  );
});

test('the booking is given back and the desk has no holder again', async ({
  adminPage,
  userPage,
}) => {
  await goToDesksDay(userPage, DATE);
  await cancelMyDesk(userPage, DESK);

  await setHolder(adminPage, 'Bez držitele');

  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);
});
