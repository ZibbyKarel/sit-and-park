import { redirect } from 'next/navigation';
import { MY_RESERVATIONS_ROUTE } from '../../../../routes';

/** Old bookmarks. */
export default function MyDesksRedirectPage() {
  redirect(MY_RESERVATIONS_ROUTE);
}
