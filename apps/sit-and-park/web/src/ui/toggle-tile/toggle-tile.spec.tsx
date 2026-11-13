import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToggleTile } from './toggle-tile';

describe('ToggleTile', () => {
  it('renders a real button that defaults to type="button" and shape="cell"', () => {
    render(<ToggleTile>12</ToggleTile>);

    const button = screen.getByRole('button', { name: '12' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-shape', 'cell');
  });

  it.each([
    ['cell', false, true, 'unselected'],
    ['cell', true, true, 'selected'],
    ['cell', false, false, 'inactive'],
    ['cell', true, false, 'inactive'],
    ['pill', false, true, 'unselected'],
    ['pill', true, true, 'selected'],
  ] as const)('shape=%s selected=%s selectable=%s is %s', (shape, selected, selectable, state) => {
    render(
      <ToggleTile shape={shape} selected={selected} selectable={selectable}>
        Den
      </ToggleTile>
    );

    expect(screen.getByRole('button', { name: 'Den' })).toHaveAttribute('data-state', state);
  });

  it('a cell tile that is not selectable is a real disabled button', () => {
    render(
      <ToggleTile shape="cell" selectable={false}>
        15
      </ToggleTile>
    );

    const button = screen.getByRole('button', { name: '15' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('a disabled pill is inactive, distinct from unselected', () => {
    render(
      <ToggleTile shape="pill" disabled>
        Ruční
      </ToggleTile>
    );

    const button = screen.getByRole('button', { name: 'Ruční' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-state', 'inactive');
  });

  it.each(['none', 'base', 'fast'] as const)('exposes the %s transition', (transition) => {
    render(<ToggleTile transition={transition}>1</ToggleTile>);

    expect(screen.getByRole('button')).toHaveAttribute('data-transition', transition);
  });

  it('does not fire and cannot be focused when not selectable', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(
      <ToggleTile selectable={false} onClick={onClick}>
        1
      </ToggleTile>
    );

    const button = screen.getByRole('button');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    await user.tab();
    expect(button).not.toHaveFocus();
  });

  it('fires on click when selectable', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<ToggleTile onClick={onClick}>1</ToggleTile>);

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts role="radio" and aria-checked for a roving-tabindex radio group', () => {
    render(
      <ToggleTile shape="pill" role="radio" aria-checked={true}>
        Automaticky
      </ToggleTile>
    );

    expect(screen.getByRole('radio', { name: 'Automaticky' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<ToggleTile ref={ref}>1</ToggleTile>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  describe('accentColor', () => {
    it('applies the accent to an inactive cell', () => {
      render(
        <ToggleTile shape="cell" selectable={false} accentColor="#00e25a">
          16
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: '16' });
      expect(button).toHaveAttribute('data-accent');
      expect(button.style.getPropertyValue('--tile-accent')).toBe('#00e25a');
    });

    it('has no effect on an active (selectable) cell', () => {
      render(
        <ToggleTile shape="cell" accentColor="#fcaf00">
          1
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: '1' });
      expect(button).not.toHaveAttribute('data-accent');
      expect(button.style.getPropertyValue('--tile-accent')).toBe('');
    });

    it('has no effect on an inactive pill', () => {
      render(
        <ToggleTile shape="pill" disabled accentColor="#3b88ff">
          Zamčeno
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: 'Zamčeno' });
      expect(button).not.toHaveAttribute('data-accent');
      expect(button.style.getPropertyValue('--tile-accent')).toBe('');
    });
  });
});
