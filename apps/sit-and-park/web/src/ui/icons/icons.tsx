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
export type SunIconProps = IconProps;
export type MoonIconProps = IconProps;

/*
 * CarIcon and DeskIcon draw the Material Icons glyphs "DirectionsCarFilled" and "Desk"
 * (https://fonts.google.com/icons, Apache License 2.0), inlined so no icon package is a dependency.
 */

/** A filled car, in the colour of the surrounding text. */
export function CarIcon({ size = 'sm', label, ...rest }: CarIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.car}
      data-size={size}
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8zM7.5 16c-.83 0-1.5-.67-1.5-1.5S6.67 13 7.5 13s1.5.67 1.5 1.5S8.33 16 7.5 16m9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5M5.81 10l1.04-3h10.29l1.04 3z" />
    </svg>
  );
}

/** A filled desk, in the colour of the surrounding text. */
export function DeskIcon({ size = 'sm', label, ...rest }: DeskIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.desk}
      data-size={size}
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M2 6v12h2V8h10v10h2v-2h4v2h2V6zm18 2v2h-4V8zm-4 6v-2h4v2z" />
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

/** A sun with rays, in the colour of the surrounding text. */
export function SunIcon({ size = 'sm', label, ...rest }: SunIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.sun}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** A crescent moon, in the colour of the surrounding text. */
export function MoonIcon({ size = 'sm', label, ...rest }: MoonIconProps) {
  return (
    <svg
      {...rest}
      {...a11y(label)}
      viewBox="0 0 24 24"
      focusable="false"
      className={styles.moon}
      data-size={size}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label === undefined ? null : <title>{label}</title>}
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
