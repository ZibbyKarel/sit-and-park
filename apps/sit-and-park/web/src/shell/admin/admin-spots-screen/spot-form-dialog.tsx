'use client';

import * as z from 'zod';
import type { AdminOffice, ParkingSpot } from '@sit-and-park/contract';
import { FormField, FormProvider, useAppForm } from '@sit-and-park/form';
import { Button, CheckboxField, Modal, SingleSelectField, Stack } from '@shoptet/ui';
import { TextField } from '../../../ui/text-field/text-field';
import { Toast } from '../../../ui/toast/toast';
import { PARKING_GROUPS, useTranslations } from '@sit-and-park/i18n';

const GROUP_OPTIONS = PARKING_GROUPS.map((group) => ({ group }));

/** Field-level validation. The contract re-checks the same shape on arrival. */
const spotFormSchema = z.object({
  label: z.string().trim().min(1),
  group: z.enum(PARKING_GROUPS),
  evCharger: z.boolean(),
  officeId: z.string().min(1),
});
type SpotFormValues = z.infer<typeof spotFormSchema>;

export interface SpotFormDialogProps {
  /**
   * The spot being edited, or `null` when adding a new one — narrowed to the
   * three fields the form edits, so the dialog cannot start reading
   * `active` or an id it has no business acting on.
   */
  readonly spot: Pick<ParkingSpot, 'label' | 'group' | 'evCharger' | 'officeId'> | null;
  /** The offices a spot can be in. */
  readonly offices: readonly (Pick<AdminOffice, 'id' | 'name'> &
    Partial<Pick<AdminOffice, 'active'>>)[];
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: SpotFormValues) => Promise<void>;
}

/** Add / edit, in the same `Modal` the settings screen uses. */
export function SpotFormDialog({
  spot,
  offices,
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
      // The first active office; an inactive one cannot take a booking.
      officeId: spot?.officeId ?? (offices.find((o) => o.active !== false) ?? offices[0])?.id ?? '',
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
                  ref={field.ref}
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
              name="officeId"
              render={({ field, error: fieldError }) => (
                <SingleSelectField
                  label={t('spotsOfficeField')}
                  {...(fieldError ? { error: t('spotsOfficeRequired') } : {})}
                  options={[...offices]}
                  getOptionValue={(office) => office.id}
                  getOptionLabel={(office) => office.name}
                  name={field.name}
                  ref={field.ref}
                  value={field.value === '' ? null : field.value}
                  onChange={(officeId) => field.onChange(officeId ?? '')}
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
