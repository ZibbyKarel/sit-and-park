import { render, screen } from '@testing-library/react';

import { BoltIcon, CarIcon, DeskIcon, EyeOffIcon, MoonIcon, SunIcon, WarningIcon } from './icons';

describe.each([
  ['BoltIcon', BoltIcon, 'Nabíječka pro elektromobily'],
  ['EyeOffIcon', EyeOffIcon, 'Skryté'],
  ['CarIcon', CarIcon, 'Auto'],
  ['DeskIcon', DeskIcon, 'Stůl'],
  ['WarningIcon', WarningIcon, 'Pozor'],
  ['SunIcon', SunIcon, 'Slunce'],
  ['MoonIcon', MoonIcon, 'Měsíc'],
] as const)('%s', (_name, Icon, label) => {
  it('is an image named by its label', () => {
    render(<Icon label={label} />);

    const icon = screen.getByRole('img', { name: label });
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('is decorative without a label', () => {
    const { container } = render(<Icon />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each(['sm', 'md'] as const)('exposes the %s size', (size) => {
    const { container } = render(<Icon size={size} />);

    expect(container.querySelector('svg')).toHaveAttribute('data-size', size);
  });

  it('defaults to sm', () => {
    const { container } = render(<Icon />);

    expect(container.querySelector('svg')).toHaveAttribute('data-size', 'sm');
  });

  it('passes attributes through', () => {
    const { container } = render(<Icon data-testid="icon" />);

    expect(container.querySelector('svg')).toHaveAttribute('data-testid', 'icon');
  });
});

describe('EyeOffIcon title', () => {
  it('renders a title when a label is given and none without one', () => {
    const { container, rerender } = render(<EyeOffIcon label="Skryté" />);
    expect(container.querySelector('svg > title')).toHaveTextContent('Skryté');

    rerender(<EyeOffIcon />);
    expect(container.querySelector('title')).not.toBeInTheDocument();
  });
});

describe('Material glyphs', () => {
  it('draws the Material DirectionsCarFilled and Desk glyphs', () => {
    const car = render(<CarIcon />).container.querySelector('path');
    expect(car).toHaveAttribute(
      'd',
      'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8zM7.5 16c-.83 0-1.5-.67-1.5-1.5S6.67 13 7.5 13s1.5.67 1.5 1.5S8.33 16 7.5 16m9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5M5.81 10l1.04-3h10.29l1.04 3z'
    );
    const desk = render(<DeskIcon />).container.querySelector('path');
    expect(desk).toHaveAttribute('d', 'M2 6v12h2V8h10v10h2v-2h4v2h2V6zm18 2v2h-4V8zm-4 6v-2h4v2z');
  });
});
