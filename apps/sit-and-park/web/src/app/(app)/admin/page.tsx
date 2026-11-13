'use client';

/**
 * Administration: the day overview, users, parking spots, the reservation
 * window (Task 27) and the reservation limits. Task 23 routed the top bar's
 * `Správa` tab here and closed the door behind it; this file now
 * hands `AdminScreen` the five tab bodies.
 *
 * The whole file is the wiring — where the profile comes from, what retry does,
 * and which connected panel goes in which tab. Every *rule*, the role gate
 * included, lives in `AdminScreen`; each panel owns its own fetching. Same
 * split, and same reason, as `app-top-bar.tsx` / `top-bar.tsx`.
 */

import { AdminScreen } from '../../../shell/admin-screen/admin-screen';
import { AdminDayPanel } from '../../../shell/admin/admin-day-panel';
import { AdminSpotsPanel } from '../../../shell/admin/admin-spots-panel';
import { AdminUsersPanel } from '../../../shell/admin/admin-users-panel';
import { AdminWindowPanel } from '../../../shell/admin/admin-window-panel';
import { AdminLimitsPanel } from '../../../shell/admin/admin-limits-panel';
import { AdminHivesScreen } from '../../../shell/admin/admin-hives-screen/admin-hives-screen';
import { AdminOfficesScreen } from '../../../shell/admin/admin-offices-screen/admin-offices-screen';
import { AdminSyncScreen } from '../../../shell/admin/admin-sync-screen/admin-sync-screen';
import { AdminDesksScreen } from '../../../shell/admin/admin-desks-screen/admin-desks-screen';
import { AdminDeskStatsScreen } from '../../../shell/admin/admin-desk-stats-screen/admin-desk-stats-screen';
import { useCurrentUser } from '../../../shell/use-current-user';

export default function AdminPage() {
  const { data: profile, isPending, isError, error, refetch } = useCurrentUser();

  return (
    <AdminScreen
      role={profile?.role}
      isPending={isPending}
      isError={isError}
      error={error}
      onRetry={() => void refetch()}
      panels={{
        overview: <AdminDayPanel />,
        users: <AdminUsersPanel />,
        spots: <AdminSpotsPanel />,
        window: <AdminWindowPanel />,
        limits: <AdminLimitsPanel />,
        hives: <AdminHivesScreen />,
        offices: <AdminOfficesScreen />,
        sync: <AdminSyncScreen />,
        desks: <AdminDesksScreen />,
        deskStats: <AdminDeskStatsScreen />,
      }}
    />
  );
}
