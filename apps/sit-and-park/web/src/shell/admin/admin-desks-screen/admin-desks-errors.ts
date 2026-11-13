'use client';

/**
 * What a failed desk admin write says, per operation — the same
 * (operation, code) table as `../admin-errors.ts`, for the same reason: the
 * contract's `CONFLICT` and `VALIDATION_FAILED` mean different things on each
 * procedure. A code with no row falls back to "it did not save".
 */

import { useCallback } from 'react';
import { toContractError } from '@sit-and-park/api-client';
import type { ErrorCode } from '@sit-and-park/contract';
import { useTranslations } from '@sit-and-park/i18n';
import type cs from '../../../../messages/cs.json';

export type DeskWrite = 'update' | 'bulkUpdate' | 'holder' | 'grant';

type MessageKey = keyof (typeof cs)['adminDesks'];

const FORBIDDEN_ROW = { FORBIDDEN: 'errForbidden' } as const;

export const DESK_WRITE_MESSAGES: Record<
  DeskWrite,
  { readonly byCode: Partial<Record<ErrorCode, MessageKey>> }
> = {
  update: {
    byCode: {
      ...FORBIDDEN_ROW,
      NOT_FOUND: 'errNotFound',
      VALIDATION_FAILED: 'errUpdateValidation',
      CONFLICT: 'errUpdateConflict',
    },
  },
  bulkUpdate: {
    byCode: { ...FORBIDDEN_ROW, NOT_FOUND: 'errNotFound', CONFLICT: 'errBulkConflict' },
  },
  holder: {
    byCode: {
      ...FORBIDDEN_ROW,
      NOT_FOUND: 'errNotFound',
      VALIDATION_FAILED: 'errHolderValidation',
      CONFLICT: 'errHolderConflict',
    },
  },
  grant: { byCode: { ...FORBIDDEN_ROW, NOT_FOUND: 'errNotFound' } },
};

/** `null` in, `null` out, so a caller can hand it a mutation's `error` directly. */
export function useDeskWriteError(): (write: DeskWrite, failure: unknown) => string | null {
  const t = useTranslations('adminDesks');
  return useCallback(
    (write, failure) => {
      if (failure == null) return null;
      const code = toContractError(failure)?.code;
      return t(
        (code === undefined ? undefined : DESK_WRITE_MESSAGES[write].byCode[code]) ?? 'errFallback'
      );
    },
    [t]
  );
}
