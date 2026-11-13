'use client';

/**
 * `/reservations` — "Moje rezervace": a month calendar of the caller's parking,
 * waitlist places, desk reservations, desk requests, the permanent desk and its
 * released days, and (tab "Seznam") the lists behind it:
 * parking and desk reservations as one list with cancel, permanent-desk releases, approval requests
 * and, for hive owners and admins, the inbox. Each section loads and fails on
 * its own, so one broken query leaves the others usable.
 */

import { useState } from 'react';
import { useTranslations } from '@sit-and-park/i18n';
import { H1, SegmentedControl, Stack } from '@shoptet/ui';
import { ReleaseSection } from './release-section';
import { ReservationsCalendar } from './reservations-calendar';
import { InboxSection, MyRequestsSection } from './requests-sections';
import { ReservationsSection } from './reservations-section';
import styles from './my-reservations.module.css';

type View = 'calendar' | 'list';

export function MyReservationsScreen() {
  const t = useTranslations('myReservations');
  const [view, setView] = useState<View>('calendar');
  return (
    <Stack gap="xl">
      <div className={styles.sectionHeader}>
        <H1 id="my-reservations-title">{t('title')}</H1>
        <SegmentedControl
          aria-label={t('viewLabel')}
          size="sm"
          options={[
            { value: 'calendar', label: t('viewCalendar') },
            { value: 'list', label: t('viewList') },
          ]}
          getOptionValue={(option) => option.value}
          getOptionLabel={(option) => option.label}
          value={view}
          onChange={(value) => setView(value as View)}
        />
      </div>
      {view === 'calendar' ? (
        <ReservationsCalendar />
      ) : (
        <>
          <ReservationsSection />
          <ReleaseSection />
          <MyRequestsSection />
          <InboxSection />
        </>
      )}
    </Stack>
  );
}
