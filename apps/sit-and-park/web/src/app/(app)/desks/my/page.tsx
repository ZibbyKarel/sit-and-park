import { MyDesksScreen } from '../../../../desks/my-desks/my-desks-screen';

/**
 * `/desks/my` — the caller's desk reservations, releases and approval
 * requests. A server component that renders one client component; everything
 * the screen needs lives below `app/providers.tsx`'s client boundary.
 */
export default function MyDesksPage() {
  return <MyDesksScreen />;
}
