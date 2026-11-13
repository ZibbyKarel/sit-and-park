import '@testing-library/jest-dom';
import { mockedT } from './testing/mock-translations';

jest.mock('next-intl', () => ({
  ...jest.requireActual('next-intl'),
  useTranslations: () => mockedT,
}));

/**
 * jsdom gaps that `@shoptet/ui` (React Aria underneath) trips over. Each one is
 * defined only when jsdom lacks it.
 */

// Without `PointerEvent`, React Aria's press handling falls back to its mouse
// path, which drops the click `userEvent` sends — a pressed button never fires.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly width: number;
    readonly height: number;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
}

if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

class ObserverStub {
  observe(): void {
    // jsdom has no layout, so there is nothing to observe.
  }
  unobserve(): void {
    // See `observe`.
  }
  disconnect(): void {
    // See `observe`.
  }
  takeRecords(): [] {
    return [];
  }
}

if (typeof window.ResizeObserver === 'undefined') {
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ObserverStub });
}
if (typeof window.IntersectionObserver === 'undefined') {
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: ObserverStub,
  });
}

if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => undefined;
}
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}
