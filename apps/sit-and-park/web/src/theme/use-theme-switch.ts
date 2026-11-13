'use client';

import { useCallback, useEffect, useState } from 'react';
import { DARK_CLASS, THEME_COOKIE } from './theme';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Dark-mode state and its toggle. Flips the body class directly: no refresh needed. */
export function useThemeSwitch(): { dark: boolean; toggle: () => void } {
  // `false` on the server and the first client render; the effect then reads the
  // class the server already put on `<body>`, so hydration never disagrees.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.body.classList.contains(DARK_CLASS));
  }, []);

  const toggle = useCallback(() => {
    const next = !document.body.classList.contains(DARK_CLASS);
    document.body.classList.toggle(DARK_CLASS, next);
    document.cookie = `${THEME_COOKIE}=${next ? 'dark' : 'light'}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    setDark(next);
  }, []);

  return { dark, toggle };
}
