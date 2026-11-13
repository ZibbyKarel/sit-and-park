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

export type CarIconProps = IconProps;
export type DeskIconProps = IconProps;
export type WarningIconProps = IconProps;

/** A car seen from the side, in the colour of the surrounding text. */
export function CarIcon({ size = 'sm', label, ...rest }: CarIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.car}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M3 16v-4l2-5h14l2 5v4H3Z" />
      <path d="M3 12h18" />
      <circle cx="7.5" cy="16.5" r="1.5" />
      <circle cx="16.5" cy="16.5" r="1.5" />
    </svg>
  );
}

/** A desk with a monitor, in the colour of the surrounding text. */
export function DeskIcon({ size = 'sm', label, ...rest }: DeskIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.desk}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <rect x="6" y="3" width="12" height="8" rx="1" />
      <path d="M12 11v3" />
      <path d="M2 14h20" />
      <path d="M5 14v7M19 14v7" />
    </svg>
  );
}

/** A warning triangle, in the colour of the surrounding text. */
export function WarningIcon({ size = 'sm', label, ...rest }: WarningIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.warning}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}
