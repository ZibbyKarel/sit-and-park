import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from '@sit-and-park/i18n';
import csMessages from '../../../messages/cs.json';
import { selectOption } from '../../test-utils/select-option';
import { MonthNav } from './month-nav';

function setup(anchor: string) {
  const onChange = jest.fn();
  render(
    <IntlProvider locale="cs" messages={csMessages}>
      <MonthNav
        anchor={anchor}
        years={[2025, 2026, 2027]}
        onChange={onChange}
        previousLabel="prev"
        nextLabel="next"
        monthLabel="month"
        yearLabel="year"
      />
    </IntlProvider>
  );
  return { onChange, user: userEvent.setup() };
}

describe('MonthNav', () => {
  it('steps one month back and forward', async () => {
    const { onChange, user } = setup('2026-01-01');
    await user.click(screen.getByRole('button', { name: 'prev' }));
    expect(onChange).toHaveBeenLastCalledWith('2025-12-01');
    await user.click(screen.getByRole('button', { name: 'next' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-02-01');
  });

  it('changes the year keeping the month', async () => {
    const { onChange, user } = setup('2026-03-01');
    await selectOption(user, /year/, '2027');
    expect(onChange).toHaveBeenLastCalledWith('2027-03-01');
  });
});
