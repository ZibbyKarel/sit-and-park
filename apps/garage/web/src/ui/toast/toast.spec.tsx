import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Toast, ToastRegion, type ToastTone } from './toast';

describe('Toast', () => {
  it('is a polite live region by default, so it is announced without interrupting', () => {
    render(<Toast>Změny uloženy.</Toast>);

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Změny uloženy.');
  });

  it('escalates to an assertive alert for the danger tone only', () => {
    const { rerender } = render(<Toast tone="danger">Uložení selhalo.</Toast>);
    expect(screen.getByRole('alert')).toHaveTextContent('Uložení selhalo.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    for (const tone of ['neutral', 'info', 'success', 'warning'] as ToastTone[]) {
      rerender(<Toast tone={tone}>Zpráva.</Toast>);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  });

  it('does not take focus when it appears', async () => {
    const user = userEvent.setup();

    function Host() {
      const [shown, setShown] = useState(false);

      return (
        <div>
          <button type="button" onClick={() => setShown(true)}>
            Uložit
          </button>
          <ToastRegion label="Oznámení">{shown ? <Toast>Uloženo.</Toast> : null}</ToastRegion>
        </div>
      );
    }

    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Uložit' });

    await user.click(trigger);

    expect(screen.getByRole('status')).toBeInTheDocument();
    // The whole point of a toast: the user carries on where they were.
    expect(trigger).toHaveFocus();
  });

  it('hides its tone glyph from assistive technology', () => {
    render(<Toast>Něco se stalo.</Toast>);

    // The glyph repeats what the tone already says, so it has no name of its own.
    expect(screen.getByRole('status')).toHaveAccessibleName('');
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('ToastRegion', () => {
  it('is a named region that exists even while empty', () => {
    render(<ToastRegion label="Oznámení" />);

    // Not because the region is itself live — it deliberately isn't, see the
    // next test — but so the app has a stable, pre-existing node to render
    // toasts into rather than mounting/unmounting the region itself.
    expect(screen.getByRole('region', { name: 'Oznámení' })).toBeInTheDocument();
  });

  it('is not itself a live region, so a toast is not announced twice', () => {
    render(
      <ToastRegion label="Oznámení">
        <Toast>Uloženo.</Toast>
      </ToastRegion>
    );

    // The `Toast` is the live region (role="status"/"alert", see its
    // docstring); this container is not, on purpose. Whether either is
    // actually announced by a real screen reader is outside what jsdom can
    // verify — this only checks the markup contract.
    const region = screen.getByRole('region', { name: 'Oznámení' });
    expect(region).not.toHaveAttribute('aria-live');
    expect(region).not.toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('stacks several toasts', () => {
    render(
      <ToastRegion label="Oznámení">
        <Toast>První.</Toast>
        <Toast tone="success">Druhá.</Toast>
        <Toast tone="danger">Třetí.</Toast>
      </ToastRegion>
    );

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
