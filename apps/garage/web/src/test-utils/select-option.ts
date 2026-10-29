import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Picks an option in a `@shoptet/ui` `SingleSelectField`: opens the select
 * labelled `label`, then clicks the option named `option` in the popover
 * listbox. Stands in for `userEvent.selectOptions`, which only works on a
 * native `<select>`.
 *
 * The trigger is found by its `<label>`, not by role: in the default `picker`
 * mode it is a `button` named "<current value>, <label>", and only in `search`
 * mode a `combobox`.
 */
export async function selectOption(
  user: UserEvent,
  label: string | RegExp,
  option: string | RegExp
): Promise<void> {
  await user.click(screen.getByLabelText(label));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: option }));
}
