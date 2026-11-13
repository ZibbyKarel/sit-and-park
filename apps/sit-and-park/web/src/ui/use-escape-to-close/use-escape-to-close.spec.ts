import { renderHook } from '@testing-library/react';
import { useEscapeToClose } from './use-escape-to-close';

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

describe('useEscapeToClose', () => {
  it('calls onClose on Escape while enabled, and not once disabled', () => {
    const onClose = jest.fn();
    const { rerender } = renderHook(({ enabled }) => useEscapeToClose(enabled, onClose), {
      initialProps: { enabled: true },
    });

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
