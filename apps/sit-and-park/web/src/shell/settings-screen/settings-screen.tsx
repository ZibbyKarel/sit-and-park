'use client';

/**
 * What `/settings` renders, given a profile, the active spots, and the
 * mutation state around them — and nothing about how any of that is fetched.
 *
 * Split from `../settings-page.tsx` for the same reason `TopBar`/`AdminScreen`
 * are split from their connected wrappers: the *rules* here (which of the
 * loading/error/form states is shown, what a submit sends, when the confirm
 * dialog opens) are testable with plain props, no session, no query client and
 * no live API.
 *
 * Drawn with `@shoptet/ui`'s `Modal` rather than a
 * bespoke card, so the whole screen renders as
 * that shared primitive instead of a second, hand-built dialog shell. The ICS
 * section below the form has no design to copy from; it lives here, in the same modal,
 * rather than on its own screen.
 */

import { useEffect, useRef, useState } from 'react';
import * as z from 'zod';
import type {
  DirectoryDesk,
  MyProfile,
  ParkingSpot,
  UpdateMySettingsInput,
} from '@sit-and-park/contract';
import { toContractError } from '@sit-and-park/api-client';
import { FormField, FormProvider, useAppForm } from '@sit-and-park/form';
import { Button, Modal, SegmentedControl, Stack, Text } from '@shoptet/ui';
import { SingleSelectField } from '../../ui/client-select/client-select';
import { TextField } from '../../ui/text-field/text-field';
import { isLocale, LOCALE_LABELS, LOCALES, useTranslations, type Locale } from '@sit-and-park/i18n';
import { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog';
import { useNotify } from '../notifications/toast-provider';
import { ScreenError, ScreenLoading } from '../screen-state/screen-state';
import { NO_PREFERRED_SPOT, shouldClearPreferredSpot, toIcsFeedView } from './settings-view';
import { IcsSection } from './ics-section';

/**
 * Links the Save button in `Modal.Footer` (outside the `<form>`, by
 * construction) to the `<form>` it submits, via the
 * standard `form="…"` button attribute. This is also what makes pressing
 * Enter in a field submit natively, rather than doing nothing.
 */
const SETTINGS_FORM_ID = 'settings-form';

/** `'idle'` before any copy attempt, then the outcome of the last one. */
export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Field-level validation only. The three-valued clear/set/leave-alone
 * semantics of `UpdateMySettingsInput` are applied at submit time in
 * {@link toUpdateInput} — a bare `''` here means "no licence plate" /
 * "no preferred spot", never "the value is invalid".
 */
const settingsFormSchema = z.object({
  licensePlate: z.string().max(16),
  preferredParkingSpotId: z.string(),
  preferredDeskId: z.string(),
});
type SettingsFormValues = z.infer<typeof settingsFormSchema>;

interface SpotOption {
  readonly value: string;
  readonly label: string;
}

function toUpdateInput(values: SettingsFormValues, desksShown: boolean): UpdateMySettingsInput {
  const trimmedPlate = values.licensePlate.trim();
  return {
    licensePlate: trimmedPlate === '' ? null : trimmedPlate,
    preferredParkingSpotId:
      values.preferredParkingSpotId === NO_PREFERRED_SPOT ? null : values.preferredParkingSpotId,
    // Absent = keep: a user without an office (no desk list) must not clear it.
    ...(desksShown
      ? {
          preferredDeskId:
            values.preferredDeskId === NO_PREFERRED_SPOT ? null : values.preferredDeskId,
        }
      : {}),
  };
}

/** The ICS half of the screen: the feed's inputs and its one write. */
export interface SettingsIcs {
  /**
   * Origin of the API (`apiOriginOf(NEXT_PUBLIC_API_URL)`, no path). Empty
   * means it could not be derived — see `app/(app)/settings/page.tsx` — in
   * which case the ICS section shows its unavailable state rather than a
   * broken link, since `buildIcsFeedUrl` has nothing to build from — see
   * {@link toIcsFeedView}.
   */
  readonly apiOrigin: string;
  /** The caller's current ICS token, or `undefined` before the profile loads. */
  readonly token: string | undefined;
  /**
   * Requests a new token. Resolves once the new one has replaced the old —
   * that is the signal this component uses to close the confirmation dialog;
   * a rejection leaves it open so the user can retry.
   */
  readonly onRegenerate: () => Promise<void>;
  readonly isRegenerating: boolean;
  /** Whatever the failing `me.regenerateIcsToken` call threw. */
  readonly regenerateError: unknown;
}

export interface SettingsScreenProps {
  /** The profile has not arrived yet. */
  readonly isPending: boolean;
  /** The profile could not be loaded. */
  readonly isError: boolean;
  /** Whatever the failing call threw. See `ScreenErrorProps.error`. */
  readonly error: unknown;
  readonly onRetry: () => void;
  /** `undefined` exactly when `isPending || isError`. */
  readonly profile: MyProfile | undefined;
  /** Active spots for the preferred-spot picker (`spot.list`). */
  readonly spots: readonly ParkingSpot[];
  /**
   * `spot.list` has not resolved yet. While this is `true`, `spots` may still
   * be `[]` for "not loaded" rather than "no active spots exist" — the
   * reconciliation effect below must not treat the two the same, and the picker shows a loading hint instead of
   * silently offering only "Bez preference".
   */
  readonly spotsPending: boolean;
  /** `spot.list` failed. The picker shows an inline notice instead of nothing. */
  readonly spotsError: boolean;
  /**
   * Active desks of the caller's office (`desk.directory`, today). `undefined`
   * hides the preferred-desk picker: no office, or the directory is still
   * loading or failed (`desksError`).
   */
  readonly desks?: readonly DirectoryDesk[] | undefined;
  /** `desk.directory` failed: an inline notice with a retry replaces the picker. */
  readonly desksError?: boolean | undefined;
  readonly onRetryDesks?: (() => void) | undefined;
  readonly onSave: (input: UpdateMySettingsInput) => void;
  /** The active interface language. */
  readonly locale: Locale;
  /** Called with the locale the user picked. Never called for the active one. */
  readonly onLocaleChange: (locale: Locale) => void;
  readonly isSaving: boolean;
  /** Whatever the failing `me.updateSettings` call threw. */
  readonly saveError: unknown;
  /**
   * Everything {@link IcsSection} runs on, as one value.
   *
   * Grouped rather than spread across the screen's own interface because none
   * of it is the screen's business: the five members are read by that one
   * subtree and by the confirmation dialog it opens, and listing them here
   * side by side made every caller and every spec of this screen state ICS
   * internals it has no other reason to know about.
   */
  readonly ics: SettingsIcs;
  /**
   * Called for every way out: Cancel, Escape, the scrim, the × and a saved
   * form. While the regenerate confirmation is open the
   * Modal is not dismissible (`canBeDismissed={!confirmOpen}`), so one Escape
   * closes only the confirmation.
   */
  readonly onClose: () => void;
}

export function SettingsScreen({
  isPending,
  isError,
  error,
  onRetry,
  profile,
  spots,
  spotsPending,
  spotsError,
  desks,
  desksError = false,
  onRetryDesks,
  onSave,
  locale,
  onLocaleChange,
  isSaving,
  saveError,
  ics,
  onClose,
}: SettingsScreenProps) {
  const t = useTranslations('settings');
  const shellT = useTranslations('shell');
  const errorsT = useTranslations('errors');

  const [confirmOpen, setConfirmOpen] = useState(false);
  // Kept here rather than inside `IcsSection`, which is otherwise its only
  // reader, because a successful regeneration clears it: "Odkaz zkopírován"
  // must not stay on screen next to a link that has just been replaced, and
  // the regeneration is confirmed one level up (that `ConfirmDialog` sits
  // above the whole modal). Pushing the state down would
  // either lose that reset or replace it with a guess derived from the URL.
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const form = useAppForm<SettingsFormValues>({
    schema: settingsFormSchema,
    defaultValues: {
      licensePlate: '',
      preferredParkingSpotId: NO_PREFERRED_SPOT,
      preferredDeskId: NO_PREFERRED_SPOT,
    },
  });

  // The form is created once, unconditionally, so the footer's Save button
  // (which lives in `Modal`'s `footer` prop, outside `children`) can always
  // call `form.handleSubmit`. It is seeded from the profile exactly once, the
  // moment it first arrives — never again, so a background refetch (e.g. after
  // the ICS token regenerates and invalidates `me.get`) cannot silently
  // overwrite an edit in progress. Done in an effect, not during render: a
  // sibling hook's own state (react-hook-form's) must never be written while
  // this component is rendering.
  const seeded = useRef(false);
  useEffect(() => {
    if (profile && !seeded.current) {
      seeded.current = true;
      form.reset({
        licensePlate: profile.licensePlate ?? '',
        preferredParkingSpotId: profile.preferredParkingSpotId ?? NO_PREFERRED_SPOT,
        preferredDeskId: profile.preferredDeskId ?? NO_PREFERRED_SPOT,
      });
    }
  }, [profile, form]);

  // Reconciles the seeded preferred-spot id against the actual set of
  // selectable options, whenever that set changes. The rule — including why a
  // pending or failed `spot.list` must not clear anything — is
  // {@link shouldClearPreferredSpot}; the effect is only what has to happen in
  // an effect, because writing a sibling hook's state during render is not
  // allowed. Not marked dirty: this is a correction of what the DOM already
  // shows, not an edit the user made.
  useEffect(() => {
    const current = form.getValues('preferredParkingSpotId');
    if (shouldClearPreferredSpot(current, spots, spotsPending, spotsError)) {
      form.setValue('preferredParkingSpotId', NO_PREFERRED_SPOT, { shouldDirty: false });
    }
  }, [spots, spotsPending, spotsError, form]);

  // Same reconciliation as the spot above: a stored desk the directory no
  // longer lists (deactivated) is shown as, and saved as, "Bez preference".
  // Only once the directory has loaded: while it is loading or failed `desks` is
  // undefined and the stored desk is left alone (and not sent on save).
  const activeDesks = (desks ?? []).filter((desk) => desk.active);
  useEffect(() => {
    const current = form.getValues('preferredDeskId');
    if (
      desks !== undefined &&
      current !== NO_PREFERRED_SPOT &&
      !desks.some((desk) => desk.active && desk.id === current)
    ) {
      form.setValue('preferredDeskId', NO_PREFERRED_SPOT, { shouldDirty: false });
    }
  }, [desks, form]);

  const deskOptions: SpotOption[] = [
    { value: NO_PREFERRED_SPOT, label: t('preferredDeskNone') },
    ...activeDesks.map((desk) => ({ value: desk.id, label: `${desk.code} · ${desk.zoneName}` })),
  ];

  const spotOptions: SpotOption[] = [
    { value: NO_PREFERRED_SPOT, label: t('preferredSpotNone') },
    ...spots.map((spot) => ({ value: spot.id, label: `${spot.label} · ${spot.group}` })),
  ];

  const ready = !isPending && !isError && profile !== undefined;

  const icsFeed = toIcsFeedView(ics.apiOrigin, ics.token);

  function describeError(failure: unknown): string | null {
    if (failure == null) {
      return null;
    }
    const contractError = toContractError(failure);
    if (contractError === null) {
      return shellT('errorUnknown');
    }
    // `me.updateSettings` declares exactly `NOT_FOUND` and `VALIDATION_FAILED`
    // (`libs/sit-and-park/contract/src/api/me.ts`), and on *this* screen `VALIDATION_FAILED`
    // means one thing only: the stored preferred spot has been retired
    // (`MeService.requireSelectableSpot`). The shared error catalogue's
    // `VALIDATION_FAILED` sentence is about reservation-day rules (weekends,
    // public holidays) — a true code paired with a false story. This screen
    // renders its own copy for that one code instead.
    // `me.regenerateIcsToken` never throws `VALIDATION_FAILED` (it declares
    // nothing beyond the inherited `FORBIDDEN`), so this branch is reachable
    // only through `saveErrorMessage`, not `regenerateErrorMessage` — but it
    // is harmless, and correct, either way.
    if (contractError.code === 'VALIDATION_FAILED') {
      return desks === undefined
        ? t('preferredSpotUnavailable')
        : t('preferredSpotOrDeskUnavailable');
    }
    return errorsT(contractError.code);
  }

  const saveErrorMessage = describeError(saveError);
  const regenerateErrorMessage = describeError(ics.regenerateError);

  // Each toast is gated by the JSX branch it belongs to — the first two by
  // the `{ready ? … : null}` form section, the third by the confirm dialog
  // being open. `useNotify` calls are unconditional (rules of hooks), so the
  // gating lives in the `message` argument — otherwise e.g. a stale
  // `regenerateError` would keep showing a toast after the confirmation
  // dialog has been cancelled and closed.
  useNotify(ready && spotsError ? t('preferredSpotLoadError') : null, 'danger');
  useNotify(ready ? saveErrorMessage : null, 'danger');
  useNotify(confirmOpen ? regenerateErrorMessage : null, 'danger');

  async function handleCopy() {
    if (icsFeed.kind === 'unavailable') {
      return;
    }
    try {
      await navigator.clipboard.writeText(icsFeed.url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  async function handleConfirmRegenerate() {
    try {
      await ics.onRegenerate();
      setConfirmOpen(false);
      setCopyState('idle');
    } catch {
      // `regenerateErrorMessage` (derived from the caller's mutation state)
      // shows as a toast while `confirmOpen` stays `true` — that is the retry
      // affordance.
    }
  }

  return (
    <>
      <Modal isOpen onClose={onClose} canBeDismissed={!confirmOpen} maxWidth>
        <Modal.Header subheader={ready ? t('description') : undefined}>{t('title')}</Modal.Header>
        <Modal.Content>
          {isPending ? <ScreenLoading /> : null}
          {isError ? <ScreenError error={error} onRetry={onRetry} headingLevel={3} /> : null}

          {ready ? (
            <FormProvider {...form}>
              <Stack gap="xl">
                <form
                  id={SETTINGS_FORM_ID}
                  onSubmit={form.handleSubmit((values) =>
                    onSave(toUpdateInput(values, desks !== undefined))
                  )}
                >
                  <Stack gap="xl">
                    <FormField
                      name="licensePlate"
                      render={({ field, error: fieldError }) => (
                        <TextField
                          label={t('licensePlateLabel')}
                          name={field.name}
                          ref={field.ref}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          {...(fieldError ? { error: t('licensePlateTooLong') } : {})}
                        />
                      )}
                    />
                    <FormField
                      name="preferredParkingSpotId"
                      render={({ field, error: fieldError }) => (
                        <SingleSelectField
                          label={t('preferredSpotLabel')}
                          options={spotOptions}
                          getOptionValue={(option) => option.value}
                          getOptionLabel={(option) => option.label}
                          name={field.name}
                          value={field.value}
                          onChange={(value) => field.onChange(value ?? NO_PREFERRED_SPOT)}
                          ref={field.ref}
                          {...(fieldError ? { error: fieldError } : {})}
                        />
                      )}
                    />
                    {spotsPending ? (
                      <Text appearance="sm" variant="tertiary">
                        {t('preferredSpotLoading')}
                      </Text>
                    ) : null}
                    {desksError && desks === undefined ? (
                      <Text appearance="sm" variant="tertiary" role="alert">
                        {t('preferredDeskLoadError')}{' '}
                        <Button variant="secondary" size="sm" onClick={() => onRetryDesks?.()}>
                          {shellT('retry')}
                        </Button>
                      </Text>
                    ) : null}
                    {desks === undefined ? null : (
                      <FormField
                        name="preferredDeskId"
                        render={({ field, error: fieldError }) => (
                          <SingleSelectField
                            label={t('preferredDeskLabel')}
                            options={deskOptions}
                            getOptionValue={(option) => option.value}
                            getOptionLabel={(option) => option.label}
                            name={field.name}
                            value={field.value}
                            onChange={(value) => field.onChange(value ?? NO_PREFERRED_SPOT)}
                            ref={field.ref}
                            {...(fieldError ? { error: fieldError } : {})}
                          />
                        )}
                      />
                    )}
                  </Stack>
                </form>

                {/* Like the ICS section below, outside the `<form>` and immediate: the
                  language is per-browser cookie state, not part of
                  `UpdateMySettingsInput`, so it applies on click, not on Save. */}
                <Stack gap="sm">
                  <Text appearance="strong-sm">{t('languageHeading')}</Text>
                  <SegmentedControl
                    aria-label={t('languageHeading')}
                    options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
                    getOptionValue={(option) => option.value}
                    getOptionLabel={(option) => option.label}
                    value={locale}
                    onChange={(value) => {
                      if (isLocale(value) && value !== locale) onLocaleChange(value);
                    }}
                  />
                </Stack>

                {/* Deliberately outside the `<form>` above: the ICS section acts
                  immediately on its own two buttons (both `type="button"`), not
                  on a Save/Cancel submit, and keeping it out of the form means
                  pressing Enter while focused on the read-only feed-URL input
                  cannot trigger a licence-plate/preferred-spot save. */}
                <IcsSection
                  headingId="ics-heading"
                  feed={icsFeed}
                  copyState={copyState}
                  onCopy={() => void handleCopy()}
                  onRequestRegenerate={() => setConfirmOpen(true)}
                  isRegenerating={ics.isRegenerating}
                />
              </Stack>
            </FormProvider>
          ) : null}
        </Modal.Content>
        {ready ? (
          <Modal.Footer>
            {({ primaryButtonProps, secondaryButtonProps }) => (
              <>
                <Button {...secondaryButtonProps} size="lg" onClick={onClose} disabled={isSaving}>
                  {t('cancel')}
                </Button>
                {/* `type="submit" form={SETTINGS_FORM_ID}` rather than an
                    `onClick` handler: this button lives outside the `<form>`
                    above, but the `form` attribute still makes it that form's
                    submit button — which is also what makes pressing Enter in
                    a field submit the form natively. */}
                <Button
                  {...primaryButtonProps}
                  type="submit"
                  form={SETTINGS_FORM_ID}
                  size="lg"
                  isLoading={isSaving}
                >
                  {t('save')}
                </Button>
              </>
            )}
          </Modal.Footer>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title={t('icsRegenerateConfirmTitle')}
        description={t('icsRegenerateConfirmDescription')}
        confirmLabel={t('icsRegenerateConfirmButton')}
        cancelLabel={t('cancel')}
        tone="danger"
        loading={ics.isRegenerating}
        onConfirm={() => void handleConfirmRegenerate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
