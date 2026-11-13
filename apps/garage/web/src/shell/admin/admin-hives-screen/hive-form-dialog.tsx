'use client';

import * as z from 'zod';
import type { AdminHive, AdminUser } from '@garage/contract';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import { Button, Modal, SingleSelectField, Stack } from '@shoptet/ui';
import { TextField } from '../../../ui/text-field/text-field';
import { Toast } from '../../../ui/toast/toast';
import { HEX_COLOR } from './hives-view';
import styles from './admin-hives-screen.module.css';

const hiveFormSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(HEX_COLOR),
  ownerId: z.string().min(1),
});
export type HiveFormValues = z.infer<typeof hiveFormSchema>;

export interface HiveFormDialogProps {
  /** The hive being edited, or `null` when creating. */
  readonly hive: Pick<AdminHive, 'name' | 'color' | 'ownerId'> | null;
  /** Active users, the candidates for the owner. */
  readonly owners: readonly AdminUser[];
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: HiveFormValues) => Promise<void>;
}

export function HiveFormDialog({
  hive,
  owners,
  errorMessage,
  saving,
  onCancel,
  onSubmit,
}: HiveFormDialogProps) {
  const t = useTranslations('adminHives');

  const form = useAppForm<HiveFormValues>({
    schema: hiveFormSchema,
    defaultValues: {
      name: hive?.name ?? '',
      color: hive?.color ?? '#3366ff',
      ownerId: hive?.ownerId ?? '',
    },
  });

  const submit = form.handleSubmit((values) => {
    void onSubmit(values);
  });

  return (
    <Modal isOpen onClose={onCancel}>
      <Modal.Header>
        {hive === null ? t('createTitle') : t('editTitle', { name: hive.name })}
      </Modal.Header>
      <Modal.Content>
        <FormProvider {...form}>
          <Stack gap="xl">
            <FormField
              name="name"
              render={({ field, error }) => (
                <TextField
                  label={t('nameField')}
                  {...(error ? { error: t('nameRequired') } : {})}
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FormField
              name="color"
              render={({ field, error }) => (
                <div className={styles.colorRow}>
                  <input
                    type="color"
                    className={styles.colorInput}
                    aria-label={t('colorPicker')}
                    value={HEX_COLOR.test(field.value) ? field.value : '#000000'}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                  <TextField
                    label={t('colorField')}
                    {...(error ? { error: t('colorInvalid') } : {})}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                </div>
              )}
            />
            <FormField
              name="ownerId"
              render={({ field, error }) => (
                <SingleSelectField
                  label={t('ownerField')}
                  {...(error ? { error: t('ownerRequired') } : {})}
                  options={[...owners]}
                  getOptionValue={(user) => user.id}
                  getOptionLabel={(user) => user.name}
                  name={field.name}
                  ref={field.ref}
                  value={field.value === '' ? null : field.value}
                  onChange={(ownerId) => field.onChange(ownerId ?? '')}
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
              {t('cancel')}
            </Button>
            <Button {...primaryButtonProps} size="lg" onClick={submit} isLoading={saving}>
              {t('save')}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
