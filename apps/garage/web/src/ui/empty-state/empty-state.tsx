'use client';

import { H2, H3, H4, Paragraph, Stack } from '@shoptet/ui';
import type { ReactNode } from 'react';

import styles from './empty-state.module.css';

export type EmptyStateSize = 'sm' | 'md';

/** Heading levels a caller may opt into. See `headingLevel`. */
export type EmptyStateHeadingLevel = 2 | 3 | 4;

export interface EmptyStateProps {
  /** The one line that says what is not here. */
  title: ReactNode;
  /** Optional second line: why it is empty, or what to do about it. */
  description?: ReactNode | undefined;
  /** Decorative mark above the title, rendered `aria-hidden`. */
  icon?: ReactNode | undefined;
  /** Usually a single `Button`. Rendered below the description. */
  action?: ReactNode | undefined;
  /** Vertical size step. Defaults to `md`; `sm` is for inside a card or table. */
  size?: EmptyStateSize | undefined;
  /**
   * Renders the title as `<h2>`/`<h3>`/`<h4>` instead of a `<p>`. Opt-in on
   * purpose: only the page knows its own outline, and a guessed level produces
   * skipped-level headings.
   */
  headingLevel?: EmptyStateHeadingLevel | undefined;
}

function Title({
  level,
  children,
}: {
  readonly level: EmptyStateHeadingLevel | undefined;
  readonly children: ReactNode;
}) {
  switch (level) {
    case 2:
      return (
        <H2 appearance="strong-md" divider={false} align="center">
          {children}
        </H2>
      );
    case 3:
      return (
        <H3 appearance="strong-md" divider={false} align="center">
          {children}
        </H3>
      );
    case 4:
      return (
        <H4 appearance="strong-md" align="center">
          {children}
        </H4>
      );
    default:
      return (
        <Paragraph appearance="strong-md" align="center">
          {children}
        </Paragraph>
      );
  }
}

/** The "there is nothing here" block: a centred title, an optional explanation, an optional action. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  size = 'md',
  headingLevel,
}: EmptyStateProps) {
  return (
    <div className={styles.root} data-size={size}>
      <Stack align="center" gap="sm">
        {icon !== undefined && (
          <span aria-hidden="true" className={styles.icon}>
            {icon}
          </span>
        )}
        <Title level={headingLevel}>{title}</Title>
        {description !== undefined && (
          <div className={styles.description}>
            <Paragraph appearance="sm" variant="secondary" align="center">
              {description}
            </Paragraph>
          </div>
        )}
        {action !== undefined && <div className={styles.action}>{action}</div>}
      </Stack>
    </div>
  );
}
