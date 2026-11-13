/**
 * Booking one desk for several days, when one of them is already taken.
 *
 * Desk series always use skip semantics: the preview lists every picked day
 * with what will happen to it, and the booking books the free ones and reports
 * the rest. `Dev User Two` takes the second day first, so the preview must show
 * it skipped and the result must say one booked, one skipped.
 *
 * Two days of its own (`deskSeries`, `deskSeriesSecondDay`) and a desk of its
 * own (D-003, no hive).
 */

import { dayOfWeek } from '@garage/shared-types';
import { dayAndMonthCzech, e2eDayForSlot, SPEC_DAY_SLOTS } from './support/dates';
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

const FIRST_DAY = e2eDayForSlot(SPEC_DAY_SLOTS.deskSeries);
const TAKEN_DAY = e2eDayForSlot(SPEC_DAY_SLOTS.deskSeriesSecondDay);
const DESK = 'D-003';

/** `f.weekdayName`, ISO weekday 1 = Monday; the series' weekday checkboxes are labelled with it. */
const CZECH_WEEKDAYS = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];
const TAKEN_WEEKDAY = CZECH_WEEKDAYS[dayOfWeek(TAKEN_DAY) - 1] ?? '';

test.describe.configure({ mode: 'serial' });

test('the series preview shows a taken day as skipped, and the result books only the free one', async ({
  userPage,
  userTwoPage,
}) => {
  await goToDesksDay(userTwoPage, TAKEN_DAY);
  await bookDesk(userTwoPage, DESK);

  await goToDesksDay(userPage, FIRST_DAY);
  const dialog = await openDesk(userPage, DESK);
  await dialog.getByRole('button', { name: 'Rezervovat více dní' }).click();

  // The start day's weekday is ticked already; add the taken day's.
  await dialog.getByRole('checkbox', { name: TAKEN_WEEKDAY, exact: true }).check();

  const preview = dialog.getByRole('listitem');
  await expect(preview).toHaveCount(2);
  await expect(preview.filter({ hasText: dayAndMonthCzech(FIRST_DAY) })).toContainText(
    'volno, rezervuje se'
  );
  await expect(preview.filter({ hasText: dayAndMonthCzech(TAKEN_DAY) })).toContainText(
    'stůl je ten den obsazený'
  );

  await dialog.getByRole('button', { name: 'Rezervovat 1 den' }).click();

  await expect(dialog.getByRole('region', { name: 'Výsledek rezervace' })).toBeVisible();
  await expect(dialog).toContainText('Rezervováno: 1');
  await expect(dialog).toContainText('Přeskočeno: 1');
  await closeDeskDialog(userPage);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.mine);
});

test('both people give their day back', async ({ userPage, userTwoPage }) => {
  await goToDesksDay(userPage, FIRST_DAY);
  await cancelMyDesk(userPage, DESK);
  await expectDeskStatus(userPage, DESK, DESK_STATUS.free);

  await goToDesksDay(userTwoPage, TAKEN_DAY);
  await cancelMyDesk(userTwoPage, DESK);
  await expectDeskStatus(userTwoPage, DESK, DESK_STATUS.free);
});
