/**
 * Asking for a desk of a hive one is not in, and the decision.
 *
 * Sales (D-013..D-018) is owned by `desk@example.com`, who is not a persona;
 * an admin decides any pending request, so `Dev Admin` plays the decider. Two
 * requests on the same day: `Dev User`'s for D-014 is approved and becomes a
 * reservation, `Dev User Two`'s for D-015 is rejected and stays visible as
 * rejected. Neither persona is in Sales, so both may ask.
 */

import { dayAndMonthCzech, e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import {
  cancelMyDesk,
  DESK_STATUS,
  expectDeskStatus,
  goToDesksDay,
  goToMyReservations,
  MY_RESERVATIONS_LIST,
  myReservationsSection,
  openDesk,
} from './support/desk-page';
import { expect, test } from './support/fixtures';
import type { Page } from '@playwright/test';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.deskApproval);
const APPROVED_DESK = 'D-014';
const REJECTED_DESK = 'D-015';

test.describe.configure({ mode: 'serial' });

async function requestDesk(page: Page, code: string): Promise<void> {
  await goToDesksDay(page, DATE);
  const dialog = await openDesk(page, code);
  await expect(dialog).toContainText('Můžete požádat jeho vlastníka o schválení na tento den.');
  await dialog.getByRole('button', { name: 'Požádat o schválení' }).click();
  await expect(dialog.getByText(/^Žádost odeslána\./u)).toBeVisible();
}

test('two non-members ask for Sales desks on the same day', async ({ userPage, userTwoPage }) => {
  await requestDesk(userPage, APPROVED_DESK);
  await requestDesk(userTwoPage, REJECTED_DESK);

  await goToMyReservations(userPage);
  const mine = myReservationsSection(userPage, 'Moje žádosti o schválení');
  await expect(mine.getByRole('listitem').filter({ hasText: APPROVED_DESK })).toContainText(
    'Čeká na schválení'
  );
});

test('an admin approves one request and rejects the other from the inbox', async ({
  adminPage,
}) => {
  await goToMyReservations(adminPage);
  const inbox = myReservationsSection(adminPage, 'Žádosti ke schválení');

  await inbox
    .getByRole('button', { name: `Schválit žádost na stůl ${APPROVED_DESK} pro Dev User` })
    .click();
  await expect(adminPage.getByText('Žádost byla schválena a stůl rezervován.')).toBeVisible();

  await inbox
    .getByRole('button', { name: `Zamítnout žádost na stůl ${REJECTED_DESK} pro Dev User Two` })
    .click();
  await expect(adminPage.getByText('Žádost byla zamítnuta.')).toBeVisible();

  await expect(inbox.getByRole('button', { name: /^Schválit žádost/u })).toHaveCount(0);
});

test('the approved requester holds the desk; the rejected one sees the rejection', async ({
  userPage,
  userTwoPage,
}) => {
  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, APPROVED_DESK, DESK_STATUS.mine);

  await goToMyReservations(userPage);
  await expect(
    myReservationsSection(userPage, MY_RESERVATIONS_LIST)
      .getByRole('listitem')
      .filter({ hasText: APPROVED_DESK })
  ).toContainText(dayAndMonthCzech(DATE));
  await expect(
    myReservationsSection(userPage, 'Moje žádosti o schválení')
      .getByRole('listitem')
      .filter({ hasText: APPROVED_DESK })
  ).toContainText('Schváleno');

  await goToMyReservations(userTwoPage);
  await expect(
    myReservationsSection(userTwoPage, 'Moje žádosti o schválení')
      .getByRole('listitem')
      .filter({ hasText: REJECTED_DESK })
  ).toContainText('Zamítnuto');
  await goToDesksDay(userTwoPage, DATE);
  await expectDeskStatus(userTwoPage, REJECTED_DESK, DESK_STATUS.free);

  // Give the approved desk back so a re-run starts from the same place.
  await goToDesksDay(userPage, DATE);
  await cancelMyDesk(userPage, APPROVED_DESK);
});
