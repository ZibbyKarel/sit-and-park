import { MyReservationsScreen } from '../../../reservations/my-reservations/my-reservations-screen';

/**
 * `/reservations` — the caller's calendar, desk reservations, releases and
 * approval requests. A server component that renders one client component;
 * everything the screen needs lives below `app/providers.tsx`'s client boundary.
 */
export default function MyReservationsPage() {
  return <MyReservationsScreen />;
}
