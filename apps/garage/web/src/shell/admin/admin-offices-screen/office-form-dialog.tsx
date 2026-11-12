'use client';

import * as z from 'zod';
import type { AdminOffice } from '@garage/contract';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import { Button, CheckboxField, Modal, Stack } from '@shoptet/ui';
import { TextField } from '../../../ui/text-field/text-field';
import { Toast } from '../../../ui/toast/toast';

const officeFormSchema = z.object({ name: z.string().trim().min(1), active: z.boolean() });
export type OfficeFormValues = z.infer<typeof officeFormSchema>;

export interface OfficeFormDialogProps {
  /** The office being edited, or `null` when creating. */
  readonly office: Pick<AdminOffice, 'name' | 'active'> | null;
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: OfficeFormValues) => Promise<void>;
}

export function OfficeFormDialog({
  office,
  errorMessage,
  saving,
  onCancel,
  onSubmit,
}: OfficeFormDialogProps) {
  const t = useTranslations('adminOffices');
  const form = useAppForm<OfficeFormValues>({
    schema: officeFormSchema,
    defaultValues: { name: office?.name ?? '', active: office?.active ?? true },
  });
  const submit = form.handleSubmit((values) => {
    void onSubmit(values);
  });

  return (
    <Modal isOpen onClose={onCancel}>
      <Modal.Header>
        {office === null ? t('createTitle') : t('editTitle', { name: office.name })}
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
              name="active"
              render={({ field }) => (
                <CheckboxField
                  label={t('activeField')}
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
