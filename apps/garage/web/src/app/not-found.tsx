'use client';

import { Anchor } from '@shoptet/ui';
import { useTranslations } from '@garage/i18n';
import { LOT_ROUTE } from '../routes';
import { EmptyState } from '../ui/empty-state/empty-state';
import styles from './container.module.css';

/**
 * The 404. Rendered inside the root layout, so it already has the providers —
 * which is what lets it read Czech copy rather than shipping Next.js's English
 * default page.
 *
 * The way back is a **link**, not a `Button`: it is a navigation, so it should
 * be openable in a new tab and readable as a link by assistive technology.
 * `Anchor` navigates client-side through the app's `RouterProvider`.
 */
export default function NotFound() {
  const t = useTranslations('shell');

  return (
    <main>
      <div className={`${styles.container} ${styles.roomy}`}>
        <EmptyState
          headingLevel={2}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          action={<Anchor href={LOT_ROUTE}>{t('backToLot')}</Anchor>}
        />
      </div>
    </main>
  );
}
