import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Picks an option in a `@shoptet/ui` `SingleSelect`: opens the trigger named
 * `label`, then clicks the option in the popover listbox. Stands in for
 * `selectOption()`, which only works on a native `<select>`.
 *
 * The trigger's accessible name is "<current value>, <label>" — and a
 * `combobox` rather than a `button` in `search` mode — so it is matched by
 * role with a substring name, not by an exact label. A string `optionName`
 * matches the option exactly; pass a `RegExp` for a prefix (an option label
 * may carry a suffix such as the holder's plate).
 */
export async function selectOption(
  page: Page,
  label: string,
  optionName: string | RegExp,
  scope: Page | Locator = page
): Promise<void> {
  const trigger = scope
    .getByRole('button', { name: label })
    .or(scope.getByRole('combobox', { name: label }));
  await trigger.click();

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await listbox
    .getByRole(
      'option',
      typeof optionName === 'string' ? { name: optionName, exact: true } : { name: optionName }
    )
    .click();
  await expect(listbox).toBeHidden();
}
