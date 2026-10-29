'use client';

import * as z from 'zod';
import type { ParkingSpot } from '@garage/contract';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { Button, CheckboxField, Modal, SingleSelectField, Stack, TextField } from '@shoptet/ui';
import { Toast } from '../../../ui/toast/toast';
import { PARKING_GROUPS, useTranslations } from '@garage/i18n';

const GROUP_OPTIONS = PARKING_GROUPS.map((group) => ({ group }));

/** Field-level validation. The contract re-checks the same shape on arrival. */
const spotFormSchema = z.object({
  label: z.string().trim().min(1),
  group: z.enum(PARKING_GROUPS),
  evCharger: z.boolean(),
});
type SpotFormValues = z.infer<typeof spotFormSchema>;

export interface SpotFormDialogProps {
  /**
   * The spot being edited, or `null` when adding a new one — narrowed to the
   * three fields the form edits, so the dialog cannot start reading
   * `active` or an id it has no business acting on.
   */
  readonly spot: Pick<ParkingSpot, 'label' | 'group' | 'evCharger'> | null;
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: SpotFormValues) => Promise<void>;
}

/** Add / edit, in the same `Modal` the settings screen uses. */
export function SpotFormDialog({
  spot,
  errorMessage,
  saving,
  onCancel,
  onSubmit,
}: SpotFormDialogProps) {
  const t = useTranslations('admin');

  const form = useAppForm<SpotFormValues>({
    schema: spotFormSchema,
    defaultValues: {
      label: spot?.label ?? '',
      group: spot?.group ?? PARKING_GROUPS[0],
      evCharger: spot?.evCharger ?? false,
    },
  });

  const submit = form.handleSubmit((values) => {
    void onSubmit(values).catch(() => {
      // `errorMessage` renders inside the still-open modal; see `ConfirmDialog`
      // for the same shape.
    });
  });

  return (
    <Modal isOpen onClose={onCancel}>
      <Modal.Header>
        {spot === null ? t('spotsCreateTitle') : t('spotsEditTitle', { label: spot.label })}
      </Modal.Header>
      <Modal.Content>
        <FormProvider {...form}>
          <Stack gap="xl">
            <FormField
              name="label"
              render={({ field, error: fieldError }) => (
                <TextField
                  label={t('spotsLabelField')}
                  {...(fieldError ? { error: t('spotsLabelRequired') } : {})}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FormField
              name="group"
              render={({ field, error: fieldError }) => (
                <SingleSelectField
                  label={t('spotsGroupField')}
                  {...(fieldError ? { error: fieldError } : {})}
                  options={GROUP_OPTIONS}
                  getOptionValue={(option) => option.group}
                  getOptionLabel={(option) => option.group}
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onChange={(group) => {
                    if (group !== null) {
                      field.onChange(group);
                    }
                  }}
                />
              )}
            />
            <FormField
              name="evCharger"
              render={({ field }) => (
                <CheckboxField
                  label={t('spotsEvChargerField')}
                  name={field.name}
                  ref={field.ref}
                  checked={field.value}
                  onBlur={field.onBlur}
                  onChange={(checked) => field.onChange(checked)}
                />
              )}
            />
            {errorMessage ? <Toast tone="danger">{errorMessage}</Toast> : null}
          </Stack>
        </FormProvider>
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            <Button {...secondaryButtonProps} size="lg" onClick={onCancel} disabled={saving}>
              {t('spotsCancel')}
            </Button>
            <Button {...primaryButtonProps} size="lg" onClick={submit} isLoading={saving}>
              {t('spotsSave')}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
