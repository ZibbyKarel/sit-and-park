'use client';

/**
 * The logo lockup: the Sit & Park pin symbol, next to the wordmark.
 *
 * Drawn twice in the design at two sizes — 52 px on the login canvas
 * (`doc/design/screens/canvas-default.png`) and 30 px in the top bar
 * (`02-avatar-menu.png`) — so it is one component with a size step rather
 * than two pieces of markup that can drift. It lives in app code because a
 * product's own logo is the most domain-specific thing there is.
 */

import { H1, Stack, Text } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import styles from './brand.module.css';

export type BrandSize = 'sm' | 'lg';

/** Per-size step. */
const SIZE_CONFIG: Record<
  BrandSize,
  {
    readonly symbolPx: number;
    readonly wordmarkAppearance: 'strong-md' | 'strong-lg';
    readonly gap: 'sm' | 'md';
  }
> = {
  sm: { symbolPx: 30, wordmarkAppearance: 'strong-md', gap: 'sm' },
  lg: { symbolPx: 52, wordmarkAppearance: 'strong-lg', gap: 'md' },
};

export interface BrandProps {
  /** Diameter step. Defaults to the top bar's. */
  readonly size?: BrandSize;
  /**
   * Renders the wordmark as the page's `<h1>` instead of a plain span.
   *
   * Opt-in, and only the login screen passes it: that page has no other
   * heading, whereas inside the app the `<h1>` belongs to the screen's own
   * title and a second one in the top bar would break the outline.
   */
  readonly asHeading?: boolean;
}

export function Brand({ size = 'sm', asHeading = false }: BrandProps) {
  const t = useTranslations('shell');
  const config = SIZE_CONFIG[size];

  return (
    <Stack orientation="horizontal" align="center" gap={config.gap}>
      {/* Decorative: the wordmark beside it carries the name. */}
      <img src="/sit-and-park-symbol.svg" alt="" width={config.symbolPx} height={config.symbolPx} />
      <span className={styles.wordmark} data-size={size}>
        {asHeading ? (
          <H1 appearance={config.wordmarkAppearance}>{t('brand')}</H1>
        ) : (
          <Text appearance={config.wordmarkAppearance}>{t('brand')}</Text>
        )}
      </span>
    </Stack>
  );
}
