'use client';

import { useEffect } from 'react';

/**
 * Escape for a `Modal` rendered with `canBeDismissed={false}`. The library's
 * flag is all-or-nothing — it takes Escape and the × away together with the
 * scrim — so a modal holding unsaved input, which must survive a stray click
 * on the scrim, gets Escape back here. Open react-aria popovers stop the
 * event before it reaches the document, so Escape in an open select closes
 * only the select.
 */
export function useEscapeToClose(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, onClose]);
}
