import { createRef } from 'react';
import { render, screen } from '@testing-library/react';

import { Chip } from './chip';

describe('Chip', () => {
  it('is a span with no role by default', () => {
    const { container } = render(<Chip>Volno</Chip>);

    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild).not.toHaveAttribute('role');
  });

  it('exposes size, tone and weight as data attributes, defaulting to md / outline / normal', () => {
    const { container, rerender } = render(<Chip>Volno</Chip>);
    expect(container.firstElementChild).toHaveAttribute('data-size', 'md');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'outline');
    expect(container.firstElementChild).toHaveAttribute('data-weight', 'normal');

    rerender(
      <Chip size="sm" tone="muted" weight="medium">
        Volno
      </Chip>
    );
    expect(container.firstElementChild).toHaveAttribute('data-size', 'sm');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'muted');
    expect(container.firstElementChild).toHaveAttribute('data-weight', 'medium');
  });

  it('renders no leading dot by default', () => {
    const { container } = render(<Chip>Volno</Chip>);

    expect(container.querySelector('[data-dot]')).not.toBeInTheDocument();
  });

  it.each(['green', 'blue'] as const)('renders an aria-hidden leading dot for dot="%s"', (dot) => {
    const { container } = render(<Chip dot={dot}>Volno</Chip>);

    const dotEl = container.querySelector('[data-dot]');
    expect(dotEl).toHaveAttribute('data-dot', dot);
    expect(dotEl).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['span', 'div', 'p'] as const)('renders as a %s when as="%s" is given', (as) => {
    const { container } = render(<Chip as={as}>Volno</Chip>);

    expect(container.firstElementChild?.tagName).toBe(as.toUpperCase());
  });

  it('forwards a ref to the underlying element', () => {
    const ref = createRef<HTMLElement>();
    render(<Chip ref={ref}>Volno</Chip>);

    expect(ref.current?.tagName).toBe('SPAN');
  });

  it('passes attributes through', () => {
    render(
      <Chip data-testid="chip" title="Popisek">
        Volno
      </Chip>
    );

    expect(screen.getByTestId('chip')).toHaveAttribute('title', 'Popisek');
  });
});
