import { render, screen } from '@testing-library/react';

import { BoltIcon, EyeOffIcon } from './icons';

describe.each([
  ['BoltIcon', BoltIcon, 'Nabíječka pro elektromobily'],
  ['EyeOffIcon', EyeOffIcon, 'Skryté'],
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
