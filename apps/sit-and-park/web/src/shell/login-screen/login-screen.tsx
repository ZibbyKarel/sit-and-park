'use client';

/**
 * The signed-out canvas: the logo, two lines of explanation, one button, one
 * footnote. Drawn from `doc/design/screens/canvas-default.png` and the markup
 * behind it (`doc/design/sit-and-park-design.dc.html`, the `isLogin` branch).
 *
 * The button is a `<form action={…}>` submit rather than an `onClick`, and that
 * is the point of splitting this file from its page: the action is a **Server
 * Action** that calls `libs/sit-and-park/auth`'s server-side `signIn`, so the redirect to
 * Okta is issued by the server and the page works with JavaScript disabled.
 * Nothing about the credential exchange happens in the browser — see
 * `doc/auth.md` §"The flow, end to end".
 */

import { Button, Stack } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import { IconCircle } from '../../ui/icon-circle/icon-circle';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import styles from './login-screen.module.css';

export interface LoginScreenProps {
  /** Server Action that starts the Okta authorization-code flow. */
  readonly action: () => Promise<void>;
}

export function LoginScreen({ action }: LoginScreenProps) {
  const t = useTranslations('login');
  const tShell = useTranslations('shell');

  return (
    <div className={styles.canvas}>
      <Stack align="center" justify="center" gap="xxl">
        {/* The full logo, claim included; the hidden text names the page's only heading. */}
        <h1 className={styles.logoHeading}>
          <VisuallyHidden>{tShell('brand')}</VisuallyHidden>
          <img src="/sit-and-park-logo.svg" alt="" className={styles.logo} />
        </h1>

        <form action={action}>
          <Button type="submit" size="lg">
            <span className={styles.signIn}>
              {/* The design's inset "O" chip: a translucent square on the blue fill, not an icon. */}
              <IconCircle
                aria-hidden="true"
                size="xs"
                shape="square"
                tone="translucent-light"
                fontSize="xs"
                weight="bold"
              >
                O
              </IconCircle>
              {t('signIn')}
            </span>
          </Button>
        </form>
      </Stack>
    </div>
  );
}
