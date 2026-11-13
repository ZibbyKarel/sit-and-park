import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FloorPlan, type FloorPlanShape } from './floor-plan';

const shapes: FloorPlanShape[] = [
  {
    id: 'a',
    x: 10,
    y: 10,
    width: 40,
    height: 20,
    label: '1',
    ariaLabel: 'Shape 1, free',
    tone: 'free',
  },
  {
    id: 'b',
    x: 60,
    y: 10,
    width: 40,
    height: 20,
    label: '2',
    ariaLabel: 'Shape 2, taken',
    tone: 'taken',
    disabled: true,
  },
];
const labels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  reset: 'Reset',
  hint: 'Hold Ctrl to zoom',
};

function setup(props: Partial<React.ComponentProps<typeof FloorPlan>> = {}) {
  const onShapeActivate = jest.fn();
  const utils = render(
    <FloorPlan
      backgroundSrc="/plan.svg"
      width={1000}
      height={300}
      shapes={shapes}
      tones={{ free: 'green', taken: 'red' }}
      onShapeActivate={onShapeActivate}
      labels={labels}
      {...props}
    />
  );
  const group = () => utils.container.querySelector('svg > g') as SVGGElement;
  return { ...utils, onShapeActivate, transform: () => group().getAttribute('transform') };
}

describe('FloorPlan', () => {
  it('renders shapes with accessible names and the background as an image', () => {
    const { container } = setup();

    expect(screen.getByRole('button', { name: 'Shape 1, free' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shape 2, taken' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(container.querySelector('image')).toHaveAttribute('href', '/plan.svg');
    expect(screen.getByText('Hold Ctrl to zoom')).toBeInTheDocument();
  });

  it('activates on click with multi=false and on Ctrl/Cmd click with multi=true', () => {
    const { onShapeActivate } = setup();
    const shape = screen.getByRole('button', { name: 'Shape 1, free' });

    fireEvent.click(shape);
    fireEvent.click(shape, { ctrlKey: true });
    fireEvent.click(shape, { metaKey: true });

    expect(onShapeActivate.mock.calls).toEqual([
      ['a', { multi: false }],
      ['a', { multi: true }],
      ['a', { multi: true }],
    ]);
  });

  it('activates with Enter and Space', async () => {
    const user = userEvent.setup();
    const { onShapeActivate } = setup();

    screen.getByRole('button', { name: 'Shape 1, free' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onShapeActivate).toHaveBeenCalledTimes(2);
    expect(onShapeActivate).toHaveBeenCalledWith('a', { multi: false });
  });

  it('does not activate a disabled shape', async () => {
    const user = userEvent.setup();
    const { onShapeActivate } = setup();
    const shape = screen.getByRole('button', { name: 'Shape 2, taken' });

    fireEvent.click(shape);
    shape.focus();
    await user.keyboard('{Enter}');

    expect(onShapeActivate).not.toHaveBeenCalled();
  });

  it('reflects selection in aria-pressed, from a Set or an array', () => {
    const { rerender } = setup({ selectedIds: new Set(['a']) });
    expect(screen.getByRole('button', { name: 'Shape 1, free' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Shape 2, taken' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    rerender(
      <FloorPlan
        backgroundSrc="/p.svg"
        width={1000}
        height={300}
        shapes={shapes}
        tones={{}}
        selectedIds={['b']}
        labels={labels}
      />
    );
    expect(screen.getByRole('button', { name: 'Shape 2, taken' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('zoom buttons change the transform and reset restores it', async () => {
    const user = userEvent.setup();
    const { transform } = setup();
    const initial = transform();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(transform()).toContain('scale(1.25)');

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(transform()).toBe(initial);

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(transform()).toBe(initial);
  });

  it('wheel zooms only with Ctrl or Cmd', () => {
    const { container, transform } = setup();
    const svg = container.querySelector('svg') as SVGSVGElement;
    const initial = transform();

    fireEvent.wheel(svg, { deltaY: -100 });
    expect(transform()).toBe(initial);

    fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true });
    expect(transform()).toContain('scale(1.15)');
  });

  it('a drag pans the plan and does not activate the shape under it', () => {
    const { container, onShapeActivate, transform } = setup();
    const svg = container.querySelector('svg') as SVGSVGElement;
    svg.setPointerCapture = jest.fn();
    const shape = screen.getByRole('button', { name: 'Shape 1, free' });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomed = transform();
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.click(shape);

    expect(transform()).not.toBe(zoomed);
    expect(onShapeActivate).not.toHaveBeenCalled();
  });

  it('a tiny movement is still a click', () => {
    const { container, onShapeActivate } = setup();
    const svg = container.querySelector('svg') as SVGSVGElement;

    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 102, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Shape 1, free' }));

    expect(onShapeActivate).toHaveBeenCalledWith('a', { multi: false });
  });
});
