/**
 * Desk administration that reaches other people.
 *
 * 1. Deactivating a desk cancels its future reservations in the same
 *    transaction: `Dev User`'s booking of D-005 is gone from their screens.
 * 2. Adding a user to another hive moves them (one membership per user), after
 *    a confirmation. The subject is `Dev Desk Holder`, who is not a persona, so
 *    no spec running in parallel loses or gains desk access halfway through.
 *
 * Both are undone at the end; `reset-e2e.ts` undoes them anyway before the
 * next run.
 */

import type { Locator, Page } from '@playwright/test';
import { goToAdminTab, tableRow } from './support/admin-page';
import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import {
  bookDesk,
  DESK_STATUS,
  deskShape,
  expectDeskStatus,
  goToDesksDay,
  goToMyReservations,
  myReservationsSection,
} from './support/desk-page';
import { expect, test } from './support/fixtures';
import { selectOption } from './support/select-option';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.deskAdmin);
const DESK = 'D-005';
const MOVED_USER = 'Dev Desk Holder';

test.describe.configure({ mode: 'serial' });

/** Selects `code` on the admin plan and returns its editor. */
async function editDesk(page: Page, code: string): Promise<Locator> {
  const panel = await goToAdminTab(page, 'desks');
  await deskShape(page, code).click();
  const editor = panel.getByRole('region', { name: `Stůl ${code}` });
  await expect(editor).toBeVisible();
  return editor;
}

/** Flips the desk's "Aktivní" switch, saves, and confirms a deactivation. */
async function toggleActive(page: Page, editor: Locator, active: boolean): Promise<void> {
  const toggle = editor.getByRole('switch', { name: 'Aktivní' });
  await expect(toggle).toBeChecked({ checked: !active });
  await toggle.click();
  await editor.getByRole('button', { name: 'Uložit změny' }).click();

  // Only deactivation has an impact to confirm; reactivation saves straight away.
  if (!active) {
    const confirm = page.getByRole('dialog', { name: `Změnit stůl ${DESK}?` });
    await expect(confirm).toContainText('Budoucí rezervace stolu budou zrušeny.');
    await confirm.getByRole('button', { name: 'Potvrdit' }).click();
    await expect(confirm).toBeHidden();
  }
  await expect(toggle).toBeChecked({ checked: active });
}

test('deactivating a desk removes its holder’s future reservation', async ({
  adminPage,
  userPage,
}) => {
  await goToDesksDay(userPage, DATE);
  await bookDesk(userPage, DESK);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.mine);

  const editor = await editDesk(adminPage, DESK);
  await toggleActive(adminPage, editor, false);

  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.inactive);
  await goToMyReservations(userPage);
  await expect(
    myReservationsSection(userPage, 'Moje rezervace stolů').getByText(DESK, { exact: true })
  ).toHaveCount(0);

  await toggleActive(adminPage, editor, true);
  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);
});

/** Opens a hive's members dialog from the hives table. */
async function openMembers(page: Page, hive: string): Promise<Locator> {
  const panel = await goToAdminTab(page, 'hives');
  await tableRow(panel, hive).getByRole('button', { name: 'Členové' }).click();
  const dialog = page.getByRole('dialog', { name: `Členové hivu ${hive}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Adds `MOVED_USER` (now in `from`) to `to`, through the move confirmation. */
async function moveUser(page: Page, from: string, to: string): Promise<void> {
  const members = await openMembers(page, to);
  await selectOption(page, 'Přidat člena', `${MOVED_USER} (nyní v hivu ${from})`, members);
  await members.getByRole('button', { name: 'Přidat', exact: true }).click();

  const confirm = page.getByRole('dialog', { name: `Přesunout ${MOVED_USER} do jiného hivu?` });
  await expect(confirm).toContainText(`${MOVED_USER} je teď v hivu ${from}.`);
  await confirm.getByRole('button', { name: 'Přesunout' }).click();

  const after = page.getByRole('dialog', { name: `Členové hivu ${to}` });
  await expect(after.getByRole('button', { name: `Odebrat ${MOVED_USER}` })).toBeVisible();
  await after.getByRole('button', { name: 'Zavřít', exact: true }).click();
  await expect(after).toBeHidden();
}

test('adding a user to another hive moves them there, and back', async ({ adminPage }) => {
  await moveUser(adminPage, 'Sales', 'Engineering');

  const sales = await openMembers(adminPage, 'Sales');
  await expect(sales.getByRole('button', { name: `Odebrat ${MOVED_USER}` })).toHaveCount(0);
  await sales.getByRole('button', { name: 'Zavřít', exact: true }).click();

  await moveUser(adminPage, 'Engineering', 'Sales');
});
