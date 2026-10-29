import { createRef } from 'react';
import { render, screen } from '@testing-library/react';

import { IconCircle } from './icon-circle';

describe('IconCircle', () => {
  it('renders a span, aria-hidden by default', () => {
    const { container } = render(<IconCircle>+</IconCircle>);

    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes size, shape, tone, fontSize and weight as data attributes', () => {
    const { container } = render(
      <IconCircle size="lg" shape="square" tone="green" fontSize="2xl" weight="bold" leading="none">
        +
      </IconCircle>
    );

    expect(container.firstElementChild).toHaveAttribute('data-size', 'lg');
    expect(container.firstElementChild).toHaveAttribute('data-shape', 'square');
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'green');
    expect(container.firstElementChild).toHaveAttribute('data-font-size', '2xl');
    expect(container.firstElementChild).toHaveAttribute('data-weight', 'bold');
    expect(container.firstElementChild).toHaveAttribute('data-leading', 'none');
  });

  it('defaults to size sm, shape circle, fontSize sm, weight normal and no tone', () => {
    const { container } = render(<IconCircle>+</IconCircle>);

    expect(container.firstElementChild).toHaveAttribute('data-size', 'sm');
    expect(container.firstElementChild).toHaveAttribute('data-shape', 'circle');
    expect(container.firstElementChild).toHaveAttribute('data-font-size', 'sm');
    expect(container.firstElementChild).toHaveAttribute('data-weight', 'normal');
    expect(container.firstElementChild).not.toHaveAttribute('data-tone');
    expect(container.firstElementChild).not.toHaveAttribute('data-leading');
  });

  it('lets a caller override aria-hidden', () => {
    render(<IconCircle aria-hidden={false}>+</IconCircle>);

    expect(screen.getByText('+')).toHaveAttribute('aria-hidden', 'false');
  });

  it('forwards a ref to the underlying span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<IconCircle ref={ref}>+</IconCircle>);

    expect(ref.current?.tagName).toBe('SPAN');
  });

  it('passes attributes through', () => {
    render(
      <IconCircle data-testid="icon-circle" title="Popisek">
        +
      </IconCircle>
    );

    expect(screen.getByTestId('icon-circle')).toHaveAttribute('title', 'Popisek');
  });
});
