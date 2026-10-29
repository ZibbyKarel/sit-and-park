import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog } from './confirm-dialog';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();

  render(
    <ConfirmDialog
      open
      title="Opravdu smazat?"
      confirmLabel="Potvrdit"
      cancelLabel="Zrušit"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );

  return { onConfirm, onCancel };
}

/** The × in the corner. `Modal` renders it without an accessible name, so it cannot be found by role and name. */
function closeButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('.modal__close button');
  if (button === null) {
    throw new Error('close button not rendered');
  }
  return button;
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the dialog with the title and shows the description inside it', () => {
    renderDialog({ description: 'Tuto akci nelze vrátit zpět.' });

    const dialog = screen.getByRole('dialog', { name: 'Opravdu smazat?' });

    expect(within(dialog).getByText('Tuto akci nelze vrátit zpět.')).toBeInTheDocument();
  });

  it('renders extra children inside the dialog', () => {
    renderDialog({ children: <span>Pozor na vazby.</span> });

    expect(within(screen.getByRole('dialog')).getByText('Pozor na vazby.')).toBeInTheDocument();
  });

  it('uses the supplied labels on the two buttons', () => {
    renderDialog({ confirmLabel: 'Smazat', cancelLabel: 'Ponechat' });

    expect(screen.getByRole('button', { name: 'Smazat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ponechat' })).toBeInTheDocument();
  });

  it('calls onConfirm only from the confirming button', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Potvrdit' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Zrušit' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel from Escape', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel from the × button', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.click(closeButton());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not open with the confirming button focused', () => {
    renderDialog({ tone: 'danger', confirmLabel: 'Smazat' });

    expect(screen.getByRole('button', { name: 'Smazat' })).not.toHaveFocus();
  });

  describe('while loading', () => {
    it('marks the confirming button busy and disables both buttons', () => {
      renderDialog({ loading: true });

      // The loader adds its own label to the button's name.
      expect(screen.getByRole('button', { name: /Potvrdit/ })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: /Potvrdit/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Zrušit' })).toBeDisabled();
    });

    it('ignores Escape', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderDialog({ loading: true });

      await user.keyboard('{Escape}');

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('offers no × button at all', () => {
      renderDialog({ loading: true });

      expect(document.querySelector('.modal__close')).not.toBeInTheDocument();
    });

    it('ignores a click on the scrim', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderDialog({ loading: true });

      await user.click(document.querySelector('.modal__overlay') as HTMLElement);

      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
