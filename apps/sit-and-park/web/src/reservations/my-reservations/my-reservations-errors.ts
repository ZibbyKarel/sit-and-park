'use client';

/**
 * What a failed write on "Moje rezervace" says. The shared `errors` catalogue is
 * written for reservation screens, so three codes get this screen's own
 * sentence where the catalogue's would be a true code with a false story:
 * `PAST_DATE` on cancel and release, `VALIDATION_FAILED` on a decision.
 * Everything else — and every transport failure — falls through to the
 * catalogue or the generic "try again".
 */

import { toContractError } from '@sit-and-park/api-client';
import { useTranslations } from '@sit-and-park/i18n';

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
    if (write === 'decide') {
      // `decideRequest` re-checks the requester: the catalogue speaks to the requester ("you").
      const decide: Partial<Record<string, Parameters<typeof t>[0]>> = {
        VALIDATION_FAILED: 'errDecideInvalid',
        PERMANENT_DESK_HOLDER: 'errDecidePermanentHolder',
        DESK_RESERVATION_LIMIT_REACHED: 'errDecideLimitReached',
        PAST_DATE: 'errDecidePast',
      };
      const key = decide[code];
      if (key !== undefined) {
        return t(key);
      }
    }
    return errors(code);
  };
}
