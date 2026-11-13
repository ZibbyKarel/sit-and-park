import { render, screen } from '@testing-library/react';

import { VisuallyHidden } from './visually-hidden';

describe('VisuallyHidden', () => {
  it('renders a <span> by default and keeps its text in the accessibility tree', () => {
    render(<VisuallyHidden>Popisek</VisuallyHidden>);

    const node = screen.getByText('Popisek');
    expect(node.tagName).toBe('SPAN');
    expect(node).toBeInTheDocument();
  });

  it.each(['span', 'div', 'caption', 'h1', 'h2', 'legend'] as const)(
    'renders as=%s using that tag',
    (as) => {
      render(<VisuallyHidden as={as}>Popisek</VisuallyHidden>);

      expect(screen.getByText('Popisek').tagName).toBe(as.toUpperCase());
    }
  );

  it('passes attributes through', () => {
    render(
      <VisuallyHidden data-testid="hidden" title="Popisek">
        Obsah
      </VisuallyHidden>
    );

    expect(screen.getByTestId('hidden')).toHaveAttribute('title', 'Popisek');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLElement | null };
    render(<VisuallyHidden ref={ref}>Obsah</VisuallyHidden>);

    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});
