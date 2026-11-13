'use client';

import { useTranslations } from '@garage/i18n';
import type { DeskImpact } from './admin-desks-view';

/** The confirmation's body: what the change cancels and rejects. */
export function ImpactWarnings({ impact }: { readonly impact: DeskImpact | null }) {
  const t = useTranslations('adminDesks');
  if (impact === null) return null;
  return (
    <>
      {impact.cancelsReservations ? <p>{t('impactCancels')}</p> : null}
      {impact.rejectsRequests ? <p>{t('impactRejects')}</p> : null}
    </>
  );
}
