'use client';

import type { SVGAttributes } from 'react';

import styles from './icons.module.css';

export type IconSize = 'sm' | 'md';

export interface IconProps
  extends Omit<SVGAttributes<SVGSVGElement>, 'children' | 'role' | 'aria-label' | 'className'> {
  /** Glyph size. Defaults to `sm` (16px). */
  size?: IconSize | undefined;
  /** Accessible name. Omitted, the glyph is decorative (`aria-hidden`). */
  label?: string | undefined;
}

export type BoltIconProps = IconProps;
export type EyeOffIconProps = IconProps;

function a11y(label: string | undefined) {
  return label === undefined
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label };
}

/** The green "electric" mark: green fill with a dark outline so it reads on white and on asphalt. */
export function BoltIcon({ size = 'sm', label, ...rest }: BoltIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.bolt}
      data-size={size}
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** A crossed-out eye, drawn in white for the lot's dark asphalt. */
export function EyeOffIcon({ size = 'sm', label, ...rest }: EyeOffIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.eyeOff}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
