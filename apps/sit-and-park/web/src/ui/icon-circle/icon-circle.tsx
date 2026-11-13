'use client';

import { forwardRef, type HTMLAttributes } from 'react';

import styles from './icon-circle.module.css';

export type IconCircleSize = 'xs' | 'sm' | 'md' | 'lg';
export type IconCircleShape = 'square' | 'circle';
export type IconCircleTone = 'yellow' | 'green' | 'blue' | 'translucent' | 'translucent-light';
export type IconCircleFontSize = 'xs' | 'sm' | 'base' | 'md' | 'xl' | '2xl';
export type IconCircleWeight = 'normal' | 'bold';

export interface IconCircleProps extends HTMLAttributes<HTMLSpanElement> {
  /** Track size. Defaults to `sm`. */
  size?: IconCircleSize | undefined;
  /** `square` (small radius) or `circle`. Defaults to `circle`. */
  shape?: IconCircleShape | undefined;
  /** Fill and matching foreground; the translucent tones inherit the text colour. No default. */
  tone?: IconCircleTone | undefined;
  /** Glyph type size. Defaults to `sm`. */
  fontSize?: IconCircleFontSize | undefined;
  /** Glyph weight. Defaults to `normal`. */
  weight?: IconCircleWeight | undefined;
  /** `none` drops the line-height so a tall one cannot push the glyph off-centre. */
  leading?: 'none' | undefined;
}

/**
 * A small round-or-square badge holding one glyph or character. Decorative by
 * default (`aria-hidden`); a caller whose glyph is the only information passes
 * `aria-hidden={false}`.
 */
export const IconCircle = forwardRef<HTMLSpanElement, IconCircleProps>(function IconCircle(
  {
    size = 'sm',
    shape = 'circle',
    tone,
    fontSize = 'sm',
    weight = 'normal',
    leading,
    'aria-hidden': ariaHidden = true,
    children,
    ...rest
  },
  ref
) {
  return (
    <span
      {...rest}
      ref={ref}
      aria-hidden={ariaHidden}
      className={styles.root}
      data-size={size}
      data-shape={shape}
      data-tone={tone}
      data-font-size={fontSize}
      data-weight={weight}
      data-leading={leading}
    >
      {children}
    </span>
  );
});
