'use client';

/**
 * The admin's three holder fields, for a free bay.
 *
 * Presentational, and deliberately **not** its own form: it renders inside
 * `SpotDialog`'s `FormProvider`, because the submit button lives in the
 * `Modal`'s footer, outside this subtree. That is the same split
 * `apps/garage/web/src/shell/admin/admin-spots-screen/spot-form-dialog.tsx` uses —
 * `form.handleSubmit` is created in the component that owns the modal, and the
 * fields sit under the provider.
 * */

import { SingleSelectField } from '@shoptet/ui';
import { TextField } from '../../ui/text-field/text-field';
import { FormField } from '@garage/form';
import { HALF_HOUR_END_TIMES, HALF_HOUR_START_TIMES, useTranslations } from '@garage/i18n';
import { formatTimeOfDay } from '../lot-view';
import { GUEST_HOLDER_VALUE, plateHintFor } from './holder-input';
import type { HolderDuration, HolderFormValues, HolderOption } from './holder-input';
import styles from './spot-dialog.module.css';

interface Choice {
  readonly value: string;
  readonly label: string;
}

const getChoiceValue = (choice: Choice) => choice.value;
const getChoiceLabel = (choice: Choice) => choice.label;

const timeChoices = (times: readonly string[]): Choice[] =>
  times.map((time) => ({ value: time, label: formatTimeOfDay(time) }));

export interface HolderFieldsProps {
  readonly options: readonly HolderOption[];
  /** The `holderId` currently selected — the guest field is only shown for a guest. */
  readonly holderId: string;
  /** The `duration` currently selected — the time selects only show for `'TIMED'`. */
  readonly duration: HolderDuration;
  /**
   * A `'timed'` spot's dialog: the holder is a fixed guest and the duration
   * is a fixed block, so neither the holder select nor the duration select
   * is rendered — only the time-range selects, always.
   */
  readonly timedOnly: boolean;
}

export function HolderFields({ options, holderId, duration, timedOnly }: HolderFieldsProps) {
  const t = useTranslations('lot');
  const hint = plateHintFor(options, holderId);
  const isGuest = timedOnly || holderId === GUEST_HOLDER_VALUE;
  const showTimeFields = timedOnly || duration === 'TIMED';

  const holderChoices: Choice[] = [
    ...options.map((option) => ({
      value: option.userId,
      label: option.licensePlate === null ? option.name : `${option.name} — ${option.licensePlate}`,
    })),
    { value: GUEST_HOLDER_VALUE, label: t('holderGuestOption') },
  ];
  const durationChoices: Choice[] = [
    { value: 'FULL_DAY', label: t('durationFullDay') },
    { value: 'TIMED', label: t('durationTimed') },
  ];

  return (
    <div className={styles.fields}>
      {timedOnly ? null : (
        <FormField<HolderFormValues, 'holderId'>
          name="holderId"
          render={({ field, error: fieldError }) => (
            <SingleSelectField
              label={t('holderField')}
              error={fieldError}
              name={field.name}
              value={field.value}
              options={holderChoices}
              getOptionValue={getChoiceValue}
              getOptionLabel={getChoiceLabel}
              onChange={(value) => {
                field.onChange(value ?? '');
              }}
              ref={field.ref}
            />
          )}
        />
      )}

      {isGuest ? (
        <FormField<HolderFormValues, 'guestName'>
          name="guestName"
          render={({ field, error: fieldError }) => (
            <TextField
              label={t('guestNameField')}
              // The schema carries no messages — it is built at module level,
              // where there is no translator — so the copy is resolved here.
              {...(fieldError === undefined ? {} : { error: t('guestNameRequired') })}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
              }}
              onBlur={() => {
                field.onBlur();
              }}
            />
          )}
        />
      ) : null}

      {isGuest && !timedOnly ? (
        <FormField<HolderFormValues, 'duration'>
          name="duration"
          render={({ field }) => (
            <SingleSelectField
              label={t('durationField')}
              name={field.name}
              value={field.value}
              options={durationChoices}
              getOptionValue={getChoiceValue}
              getOptionLabel={getChoiceLabel}
              onChange={(value) => {
                field.onChange(value ?? 'FULL_DAY');
              }}
              ref={field.ref}
            />
          )}
        />
      ) : null}

      {showTimeFields ? (
        <>
          <FormField<HolderFormValues, 'startTime'>
            name="startTime"
            render={({ field }) => (
              <SingleSelectField
                label={t('startTimeField')}
                name={field.name}
                value={field.value}
                options={timeChoices(HALF_HOUR_START_TIMES)}
                getOptionValue={getChoiceValue}
                getOptionLabel={getChoiceLabel}
                onChange={(value) => {
                  field.onChange(value ?? '');
                }}
                ref={field.ref}
              />
            )}
          />
          <FormField<HolderFormValues, 'endTime'>
            name="endTime"
            render={({ field, error: fieldError }) => (
              <SingleSelectField
                label={t('endTimeField')}
                error={fieldError === undefined ? undefined : t('timeRangeInvalid')}
                name={field.name}
                value={field.value}
                options={timeChoices(HALF_HOUR_END_TIMES)}
                getOptionValue={getChoiceValue}
                getOptionLabel={getChoiceLabel}
                onChange={(value) => {
                  field.onChange(value ?? '');
                }}
                ref={field.ref}
              />
            )}
          />
        </>
      ) : null}

      <FormField<HolderFormValues, 'licensePlate'>
        name="licensePlate"
        render={({ field, error: fieldError }) => (
          <TextField
            label={t('plateField')}
            // Blank means "use the holder's stored plate", so the placeholder is
            // what will actually be used — not a hint about formatting.
            placeholder={hint ?? t('noPlate')}
            {...(fieldError === undefined ? {} : { error: fieldError })}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={(value) => {
              field.onChange(value);
            }}
            onBlur={() => {
              field.onBlur();
            }}
          />
        )}
      />
    </div>
  );
}
