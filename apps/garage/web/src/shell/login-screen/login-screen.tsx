'use client';

/**
 * The signed-out canvas: the logo, two lines of explanation, one button, one
 * footnote. Drawn from `doc/design/screens/canvas-default.png` and the markup
 * behind it (`doc/design/garage-design.dc.html`, the `isLogin` branch).
 *
 * The button is a `<form action={…}>` submit rather than an `onClick`, and that
 * is the point of splitting this file from its page: the action is a **Server
 * Action** that calls `libs/garage/auth`'s server-side `signIn`, so the redirect to
 * Okta is issued by the server and the page works with JavaScript disabled.
 * Nothing about the credential exchange happens in the browser — see
 * `doc/auth.md` §"The flow, end to end".
 */

import { Button, Paragraph, Stack, Text } from '@shoptet/ui';
import { useTranslations } from '@garage/i18n';
import { Brand } from '../brand';
import { IconCircle } from '../../ui/icon-circle/icon-circle';
import styles from './login-screen.module.css';

export interface LoginScreenProps {
  /** Server Action that starts the Okta authorization-code flow. */
  readonly action: () => Promise<void>;
}

export function LoginScreen({ action }: LoginScreenProps) {
  const t = useTranslations('login');

  return (
    <div className={styles.canvas}>
      <Stack align="center" justify="center" gap="xxl">
        <Brand size="lg" asHeading />

        <Paragraph appearance="lg" variant="secondary" align="center">
          {t('tagline')}
          <br />
          {t('taglineSecondary')}
        </Paragraph>

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

        <span className={styles.footnote}>
          <Text appearance="strong-sm" variant="tertiary" align="center">
            {t('footnote')}
          </Text>
        </span>
      </Stack>
    </div>
  );
}
