'use client';

/**
 * `/desks/my` — "Moje stoly": the caller's desk reservations, permanent-desk
 * releases, approval requests and (for hive owners and admins) the inbox.
 * Each section loads and fails on its own, so one broken query leaves the
 * others usable.
 */

import { useTranslations } from '@sit-and-park/i18n';
import { H1, Stack } from '@shoptet/ui';
import { ReleaseSection } from './release-section';
import { InboxSection, MyRequestsSection } from './requests-sections';
import { ReservationsSection } from './reservations-section';

export function MyDesksScreen() {
  const t = useTranslations('myDesks');
  return (
    <Stack gap="xl">
      <H1>{t('title')}</H1>
      <ReservationsSection />
      <ReleaseSection />
      <MyRequestsSection />
      <InboxSection />
    </Stack>
  );
}
