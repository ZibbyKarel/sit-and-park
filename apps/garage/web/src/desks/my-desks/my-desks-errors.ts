'use client';

/**
 * What a failed write on "Moje stoly" says. The shared `errors` catalogue is
 * written for reservation screens, so three codes get this screen's own
 * sentence where the catalogue's would be a true code with a false story:
 * `PAST_DATE` on cancel and release, `VALIDATION_FAILED` on a decision.
 * Everything else — and every transport failure — falls through to the
 * catalogue or the generic "try again".
 */

import { toContractError } from '@garage/api-client';
import { useTranslations } from '@garage/i18n';

export type DeskWrite = 'cancel' | 'release' | 'decide' | 'other';

export function useDeskWriteError(): (error: unknown, write: DeskWrite) => string | null {
  const t = useTranslations('myDesks');
  const errors = useTranslations('errors');
  const shell = useTranslations('shell');

  return (error, write) => {
    if (error == null) {
      return null;
    }
    const code = toContractError(error)?.code;
    if (code === undefined) {
      return shell('errorUnknown');
    }
    if (code === 'PAST_DATE' && write === 'cancel') {
      return t('errCancelPast');
    }
    if (code === 'PAST_DATE' && write === 'release') {
      return t('errReleasePast');
    }
    if (code === 'VALIDATION_FAILED' && write === 'decide') {
      return t('errDecideInvalid');
    }
    return errors(code);
  };
}
