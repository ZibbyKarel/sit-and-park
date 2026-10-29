'use client';

/**
 * The "Režim zámku" segmented control
 * (`doc/design/screens/05-admin-window.png`): three pills, exactly one chosen.
 *
 * ## Why `role="radio"` and not three toggle buttons
 *
 * The choices are mutually exclusive, which is what a radio group means. The
 * obvious shortcut — three `<button aria-pressed>` — announces each pill as an
 * independent on/off control, so a screen-reader user is told "Automaticky,
 * pressed" with nothing saying the other two just became impossible. ARIA's
 * radio group says "1 of 3" and reads the whole set.
 *
 * The design draws pills, not dots, so the native `<input type="radio">` (and
 * the `Radio` primitive built on it) is not what is wanted visually. The price
 * of that is the keyboard behaviour the platform would have given for free, and
 * it is paid here rather than skipped: **roving tabindex** (the group is one
 * stop in the page's tab order, on the selected pill) plus **arrow keys that
 * move and select**, wrapping at both ends. That is the same pattern, and the
 * same reasoning, as a tab strip
 * (`doc/decision/0054-keyboard-navigation-for-dropdown-and-tabs.md`).
 */

import { useId, useRef, type KeyboardEvent } from 'react';
import type { ReservationLockMode } from '@garage/contract';
import { Text } from '@shoptet/ui';
import { ToggleTile } from '../../../ui/toggle-tile/toggle-tile';
import styles from './lock-mode-choice.module.css';

export interface LockModeOption {
  readonly value: ReservationLockMode;
  readonly label: string;
}

export interface LockModeChoiceProps {
  /** Visible caption above the pills. Also the group's accessible name. */
  readonly label: string;
  readonly options: readonly LockModeOption[];
  readonly value: ReservationLockMode;
  readonly onValueChange: (value: ReservationLockMode) => void;
  readonly disabled?: boolean | undefined;
}

export function LockModeChoice({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
}: LockModeChoiceProps) {
  const labelId = useId();
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = options.findIndex((option) => option.value === value);

  function moveTo(index: number) {
    const option = options[index];
    if (option === undefined || disabled) {
      return;
    }
    // Focus first, then select — automatic activation means both happen, and
    // moving focus explicitly is what makes the arrow keys work at all.
    pillRefs.current[index]?.focus();
    onValueChange(option.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = options.length;
    if (count === 0) {
      return;
    }
    // A group whose value is not among the options (`selectedIndex === -1`)
    // still has to move somewhere: treat it as sitting before the first pill.
    const from = selectedIndex;

    switch (event.key) {
      // Both axes are bound, unlike `Tabs`: the pills wrap onto a second line
      // in the design, so Up/Down are a direction the user can see.
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo((from + 1 + count) % count);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo((from - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(count - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className={styles.root}>
      <span id={labelId} className={styles.label}>
        <Text appearance="strong-sm" variant="secondary">
          {label}
        </Text>
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className={styles.pills}
      >
        {options.map((option, index) => {
          const isSelected = option.value === value;

          return (
            // `ToggleTile shape="pill"` carries the selected/unselected/disabled
            // states; the keyboard/ARIA wiring below is this component's own.
            <ToggleTile
              key={option.value}
              ref={(node) => {
                pillRefs.current[index] = node;
              }}
              shape="pill"
              transition="fast"
              selected={isSelected}
              disabled={disabled}
              role="radio"
              aria-checked={isSelected}
              // Roving tabindex. When nothing is selected the first pill takes
              // the stop, so the group is never unreachable by Tab.
              tabIndex={isSelected || (selectedIndex === -1 && index === 0) ? 0 : -1}
              onClick={() => onValueChange(option.value)}
            >
              {option.label}
            </ToggleTile>
          );
        })}
      </div>
    </div>
  );
}
