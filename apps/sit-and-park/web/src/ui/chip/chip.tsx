'use client';

import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import styles from './chip.module.css';

export type ChipSize = 'sm' | 'md' | 'lg';
export type ChipTone = 'outline' | 'muted';
export type ChipWeight = 'normal' | 'medium';
export type ChipDot = 'none' | 'green' | 'blue';
export type ChipAs = 'span' | 'div' | 'p';

export interface ChipProps extends HTMLAttributes<HTMLElement> {
  /** Track height, padding and type size. Defaults to `md`. */
  size?: ChipSize | undefined;
  /** Bordered on white vs a flat muted fill. Defaults to `outline`. */
  tone?: ChipTone | undefined;
  /** Label weight. Defaults to `normal`. */
  weight?: ChipWeight | undefined;
  /** Leading status dot, or none. Defaults to `none`. */
  dot?: ChipDot | undefined;
  /** Rendered element. Defaults to `span`. */
  as?: ChipAs | undefined;
}

/**
 * Fixed-height pill for a filter, legend or category label. A trailing count
 * is an ordinary child.
 */
export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  {
    size = 'md',
    tone = 'outline',
    weight = 'normal',
    dot = 'none',
    as = 'span',
    children,
    ...rest
  },
  ref
) {
  const Component = as;
  const props = {
    ...rest,
    ref: ref as Ref<HTMLDivElement & HTMLParagraphElement & HTMLSpanElement>,
    className: styles.root,
    'data-size': size,
    'data-tone': tone,
    'data-weight': weight,
  };

  return (
    <Component {...props}>
      {dot === 'none' ? null : <span aria-hidden="true" className={styles.dot} data-dot={dot} />}
      {children}
    </Component>
  );
});
