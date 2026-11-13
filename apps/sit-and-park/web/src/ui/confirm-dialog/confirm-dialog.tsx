'use client';

import { Button, Modal } from '@shoptet/ui';
import type { ReactNode } from 'react';

export type ConfirmDialogTone = 'default' | 'danger';

export interface ConfirmDialogProps {
  /** The dialog renders nothing when this is `false`. */
  open: boolean;
  /** The question. Also the dialog's accessible name. */
  title: ReactNode;
  /** What confirming will actually do. */
  description?: ReactNode | undefined;
  /** Called when the confirming button is pressed. */
  onConfirm: () => void;
  /**
   * Called for every way out that is not confirmation: the cancel button,
   * Escape, the scrim and the × in the corner. They all mean the same thing.
   */
  onCancel: () => void;
  /** Label of the confirming button. Required: this component carries no copy. */
  confirmLabel: string;
  /** Label of the dismissing button. Required, like `confirmLabel`. */
  cancelLabel: string;
  /** `danger` styles the dialog and the confirming button as destructive. Defaults to `default`. */
  tone?: ConfirmDialogTone | undefined;
  /**
   * The confirmed action is in flight: the confirming button shows a loader and
   * every way out is blocked, Escape and the scrim included.
   */
  loading?: boolean | undefined;
  /** Extra content between the description and the buttons. */
  children?: ReactNode | undefined;
}

/**
 * A `Modal` narrowed to one question and two answers. Focus does not start on
 * the confirming button, so a destructive confirmation is never armed under
 * the user's Enter key.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
  children,
}: ConfirmDialogProps) {
  // `canBeDismissed` gates Escape, the scrim and the ×; the cancel button is
  // disabled while loading, so no route out can skip the check.
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      canBeDismissed={!loading}
      {...(tone === 'danger' ? { level: 'error' as const } : {})}
    >
      <Modal.Header subheader={description}>{title}</Modal.Header>
      {children === undefined ? null : <Modal.Content>{children}</Modal.Content>}
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            <Button {...secondaryButtonProps} size="lg" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              {...primaryButtonProps}
              {...(tone === 'danger' ? { variant: 'destructive' as const } : {})}
              size="lg"
              onClick={onConfirm}
              isLoading={loading}
            >
              {confirmLabel}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
