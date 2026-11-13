'use client';

import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react';

import styles from './toggle-tile.module.css';

/**
 * `cell` is a day in a calendar grid, whose inactive state is a blocked day.
 * `pill` is one option of a segmented control, whose inactive state is a
 * genuinely disabled control.
 */
export type ToggleTileShape = 'cell' | 'pill';

/** Motion on the selected/unselected swap, or none. */
export type ToggleTileTransition = 'none' | 'base' | 'fast';

export interface ToggleTileProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  /** Which chrome family to render. Defaults to `cell`. */
  shape?: ToggleTileShape | undefined;
  /** Whether this tile is the current selection. */
  selected?: boolean | undefined;
  /**
   * Whether this tile can be picked at all. Defaults to `true`. Combines with
   * native `disabled`: either one flips the tile to its inactive state.
   */
  selectable?: boolean | undefined;
  /** Defaults to `none`. */
  transition?: ToggleTileTransition | undefined;
  /** Whether this tile is today's date; draws a ring that does not change its size. */
  today?: boolean | undefined;
  /** CSS colour for the background of an inactive `cell`; ignored otherwise. */
  accentColor?: string | undefined;
}

/**
 * A selected/unselected/inactive option in a button group. Always a real
 * `<button>`; `role="radio"` and `aria-checked` pass through for callers that
 * drive a roving-tabindex group — the group's keyboard handling is theirs.
 */
export const ToggleTile = forwardRef<HTMLButtonElement, ToggleTileProps>(function ToggleTile(
  {
    shape = 'cell',
    selected = false,
    selectable = true,
    transition = 'none',
    disabled = false,
    type = 'button',
    accentColor,
    today = false,
    children,
    ...rest
  },
  ref
) {
  const isInactive = disabled || !selectable;
  const state = isInactive ? 'inactive' : selected ? 'selected' : 'unselected';
  const accented = shape === 'cell' && isInactive && accentColor !== undefined;
  const style = accented ? ({ '--tile-accent': accentColor } as CSSProperties) : undefined;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isInactive}
      aria-disabled={isInactive || undefined}
      style={style}
      className={styles.root}
      data-shape={shape}
      data-state={state}
      data-transition={transition}
      data-today={today ? '' : undefined}
      data-accent={accented ? '' : undefined}
    >
      {children}
    </button>
  );
});
