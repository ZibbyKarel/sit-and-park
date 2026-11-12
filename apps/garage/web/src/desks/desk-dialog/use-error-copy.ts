'use client';

import { useCallback } from 'react';
import { toContractError } from '@garage/api-client';
import { useTranslations } from '@garage/i18n';
import type { ErrorCode } from '@garage/contract';

/**
 * A failure as a sentence, keyed off the contract code (never the message),
 * like `ScreenError`. `override` replaces the catalogue copy for codes whose
 * catalogue sentence is about parking or too general for this call.
 */
export function useErrorCopy(): (
  error: unknown,
  override?: Partial<Record<ErrorCode, string>>
) => string {
  const errors = useTranslations('errors');
  const shell = useTranslations('shell');
  return useCallback(
    (error, override) => {
      const code = toContractError(error)?.code;
      if (code === undefined) return shell('errorUnknown');
      return override?.[code] ?? errors(code);
    },
    [errors, shell]
  );
}
