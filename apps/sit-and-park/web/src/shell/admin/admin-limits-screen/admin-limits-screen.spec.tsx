import { render, screen } from '@testing-library/react';
import { LocalizationProvider } from '@shoptet/ui';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from '@sit-and-park/i18n';
import cs from '../../../../messages/cs.json';
import { failureWithCode } from '../../../testing/contract-failure';
import { ToastProvider } from '../../notifications/toast-provider';
import { AdminLimitsScreen } from './admin-limits-screen';
import type { AdminLimitsScreenProps } from './admin-limits-screen';

type LimitsOverrides = Partial<Omit<AdminLimitsScreenProps, 'limits'>> & {
  readonly limits?: AdminLimitsScreenProps['limits'];
  readonly monthlyReservationCap?: number;
};

function renderScreen({ monthlyReservationCap = 5, limits, ...overrides }: LimitsOverrides = {}) {
  const onRetry = jest.fn();
  const onChange = jest.fn();

  const props: AdminLimitsScreenProps = {
    limits: limits ?? { kind: 'ready', data: { monthlyReservationCap } },
    onRetry,
    onChange,
    isSaving: false,
    saveError: null,
    isSaved: false,
    ...overrides,
  };

  const { unmount } = render(
    <LocalizationProvider locale="cs-CZ">
      <IntlProvider locale="cs" messages={cs}>
        <ToastProvider>
          <AdminLimitsScreen {...props} />
        </ToastProvider>
      </IntlProvider>
    </LocalizationProvider>
  );

  return { onRetry, onChange, unmount, user: userEvent.setup() };
}

describe('AdminLimitsScreen', () => {
  it('carries the design’s explanation verbatim', () => {
    renderScreen();

    expect(screen.getByText('limitsDescription')).toBeInTheDocument();
  });

  it.each([
    [1, 'limitsCapValue: count=1'],
    [2, 'limitsCapValue: count=2'],
    [5, 'limitsCapValue: count=5'],
    [21, 'limitsCapValue: count=21'],
  ])('shows the current cap %i declined into Czech as "%s"', (count, text) => {
    renderScreen({ monthlyReservationCap: count });

    expect(screen.getByRole('textbox', { name: 'limitsCapLabel' })).toHaveValue(String(count));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('stays inside the range the contract accepts', () => {
    const { unmount } = renderScreen({ monthlyReservationCap: 1 });
    expect(screen.getByRole('button', { name: /^Snížit/u })).toBeDisabled();
    unmount();

    renderScreen({ monthlyReservationCap: 31 });
    expect(screen.getByRole('button', { name: /^Zvýšit/u })).toBeDisabled();
  });

  it('sends the new cap on a change, because the contract replaces rather than patches', async () => {
    const { onChange, user } = renderScreen({ monthlyReservationCap: 7 });

    await user.click(screen.getByRole('button', { name: /^Zvýšit/u }));

    expect(onChange).toHaveBeenCalledWith({ monthlyReservationCap: 8 });
  });

  it('freezes the stepper while a save is in flight', () => {
    renderScreen({ isSaving: true });

    expect(screen.getByRole('button', { name: /^Zvýšit/u })).toBeDisabled();
  });

  it('confirms a save, and stops confirming once something changes again', () => {
    renderScreen({ isSaved: true });
    expect(screen.getByText('limitsSaved')).toBeInTheDocument();
  });

  it('says nothing while nothing has been saved', () => {
    renderScreen({ isSaved: false });
    expect(screen.queryByText('limitsSaved')).not.toBeInTheDocument();
  });

  it('names the real limit for a refused change, not the reservation rule', async () => {
    renderScreen({ saveError: await failureWithCode('VALIDATION_FAILED') });

    expect(screen.getByText('errLimitsValidation')).toBeInTheDocument();
    expect(screen.queryByText(cs.errors.VALIDATION_FAILED)).not.toBeInTheDocument();
  });

  it('does not confirm a save that failed', async () => {
    renderScreen({ isSaved: true, saveError: await failureWithCode('CONFLICT') });

    expect(screen.queryByText('limitsSaved')).not.toBeInTheDocument();
    expect(screen.getByText('errLimitsConflict')).toBeInTheDocument();
  });

  it('waits while the setting is in flight', () => {
    renderScreen({ limits: { kind: 'loading' } });

    expect(screen.getByRole('status')).toHaveTextContent('loading');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('offers a retry when the setting could not be loaded', async () => {
    const { onRetry, user } = renderScreen({
      limits: { kind: 'error', error: new Error('connection refused') },
    });

    expect(screen.queryByText(/connection refused/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
