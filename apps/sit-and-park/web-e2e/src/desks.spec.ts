/**
 * Booking a desk for one day, from the floor plan, and giving it back.
 *
 * The one-desk-per-person-per-day rule is checked the way a person meets it:
 * with a desk booked, a second desk on the same day offers no booking and says
 * why (`desks.noteHasDeskToday`).
 *
 * D-001 and D-002 belong to no hive, so `Dev User` books them directly; no
 * other spec touches them.
 */

import { e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
import {
  bookDesk,
  cancelMyDesk,
  closeDeskDialog,
  DESK_STATUS,
  expectDeskStatus,
  goToDesksDay,
  openDesk,
} from './support/desk-page';
import { expect, test } from './support/fixtures';

const DATE = e2eDayForSlot(SPEC_DAY_SLOTS.deskBooking);
const DESK = 'D-001';
const OTHER_DESK = 'D-002';

// Three moments of one reservation's life, as in `reservation.spec.ts`.
test.describe.configure({ mode: 'serial' });

test('a user books a free desk and sees it as theirs; others see it taken', async ({
  userPage,
  userTwoPage,
}) => {
  await goToDesksDay(userPage, DATE);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);

  await bookDesk(userPage, DESK);

  await expectDeskStatus(userPage, DESK, DESK_STATUS.mine);
  await expect(
    userPage.getByText(`Na tento den máte rezervovaný stůl ${DESK}.`, { exact: true })
  ).toBeVisible();

  // A fresh context: the status comes from the API, not from this page's cache.
  await goToDesksDay(userTwoPage, DATE);
  await expectDeskStatus(userTwoPage, DESK, DESK_STATUS.reserved);
});

test('a second desk on the same day is not offered, and the dialog says why', async ({
  userPage,
}) => {
  await goToDesksDay(userPage, DATE);
  const dialog = await openDesk(userPage, OTHER_DESK);

  await expect(dialog).toContainText('Na tento den už máte rezervovaný jiný stůl.');
  await expect(dialog.getByRole('button', { name: 'Rezervovat na tento den' })).toHaveCount(0);
  await closeDeskDialog(userPage);
});

test('the holder cancels it and the desk is free again', async ({ userPage }) => {
  await goToDesksDay(userPage, DATE);

  await cancelMyDesk(userPage, DESK);

  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);
  await userPage.reload();
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);
});
