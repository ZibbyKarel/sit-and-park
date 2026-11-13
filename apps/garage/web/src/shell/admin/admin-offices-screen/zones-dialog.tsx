'use client';

/**
 * The zones of one office: the list, a form to add one (key + name) and a
 * rename (the key is the zone's identity and cannot change). Connected, so the
 * list refetches after each write without the offices screen knowing zones exist.
 */

import { useState } from 'react';
import * as z from 'zod';
import { useRequireAuth } from '@garage/auth/client';
import type { AdminOffice, Zone } from '@garage/contract';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import { Button, Modal, Stack, Text } from '@shoptet/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TextField } from '../../../ui/text-field/text-field';
import { Toast } from '../../../ui/toast/toast';
import { useApi } from '../../api-provider/api-provider';
import { ScreenDataGuard, screenDataOf } from '../../screen-state/screen-state';
import { useAdminFailure } from '../use-admin-failure';
import styles from './admin-offices-screen.module.css';

const zoneFormSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  name: z.string().trim().min(1),
});
type ZoneFormValues = z.infer<typeof zoneFormSchema>;

export interface ZonesDialogProps {
  readonly office: Pick<AdminOffice, 'id' | 'name'>;
  readonly onClose: () => void;
}

export function ZonesDialog({ office, onClose }: ZonesDialogProps) {
  const t = useTranslations('adminOffices');
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const failure = useAdminFailure();
  const [editing, setEditing] = useState<Zone | null>(null);

  const zonesQuery = useQuery({
    ...api.admin.zone.list.queryOptions({ input: { officeId: office.id } }),
    enabled: status === 'authenticated',
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: api.admin.zone.key() });
    // Desks name their zone.
    queryClient.invalidateQueries({ queryKey: api.admin.desk.key() });
    queryClient.invalidateQueries({ queryKey: api.desk.key() });
  };
  const createZone = useMutation({
    ...api.admin.zone.create.mutationOptions(),
    onSettled: refresh,
  });
  const updateZone = useMutation({
    ...api.admin.zone.update.mutationOptions(),
    onSettled: refresh,
  });
  const saving = createZone.isPending || updateZone.isPending;

  return (
    <Modal isOpen onClose={onClose}>
      <Modal.Header>{t('zonesTitle', { name: office.name })}</Modal.Header>
      <Modal.Content>
        <Stack gap="xl">
          <ScreenDataGuard
            state={screenDataOf(zonesQuery)}
            onRetry={() => void zonesQuery.refetch()}
            headingLevel={3}
          >
            {({ zones }) =>
              zones.length === 0 ? (
                <Text variant="secondary">{t('zonesEmpty')}</Text>
              ) : (
                <ul className={styles.zones}>
                  {zones.map((zone) => (
                    <li key={zone.id} className={styles.zone}>
                      <Stack orientation="horizontal" align="center" gap="sm">
                        <Text>{zone.name}</Text>
                        <Text variant="tertiary">{zone.key}</Text>
                      </Stack>
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={() => {
                          failure.clear();
                          setEditing(zone);
                        }}
                      >
                        {t('zoneRename', { name: zone.name })}
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }
          </ScreenDataGuard>
          <ZoneForm
            // A fresh form per target: add, or rename of one zone.
            key={editing?.id ?? 'create'}
            zone={editing}
            saving={saving}
            onCancelEdit={() => {
              failure.clear();
              setEditing(null);
            }}
            onSubmit={async (values) => {
              const ok =
                editing === null
                  ? await failure.run(
                      'zoneCreate',
                      createZone.mutateAsync({ officeId: office.id, ...values })
                    )
                  : await failure.run(
                      'zoneUpdate',
                      updateZone.mutateAsync({ zoneId: editing.id, name: values.name })
                    );
              if (ok) setEditing(null);
              return ok;
            }}
          />
          {failure.message ? <Toast tone="danger">{failure.message}</Toast> : null}
        </Stack>
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps }) => (
          <Button {...primaryButtonProps} size="lg" onClick={onClose}>
            {t('close')}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

function ZoneForm({
  zone,
  saving,
  onCancelEdit,
  onSubmit,
}: {
  readonly zone: Zone | null;
  readonly saving: boolean;
  readonly onCancelEdit: () => void;
  readonly onSubmit: (values: ZoneFormValues) => Promise<boolean>;
}) {
  const t = useTranslations('adminOffices');
  const form = useAppForm<ZoneFormValues>({
    schema: zoneFormSchema,
    defaultValues: { key: zone?.key ?? '', name: zone?.name ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    if (await onSubmit(values)) form.reset({ key: '', name: '' });
  });

  return (
    <FormProvider {...form}>
      <Stack gap="md">
        <Text appearance="strong-md">
          {zone === null ? t('zoneAddHeading') : t('zoneRenameHeading', { key: zone.key })}
        </Text>
        <FormField
          name="key"
          render={({ field, error }) => (
            <TextField
              label={t('zoneKeyField')}
              hint={t('zoneKeyHint')}
              {...(error ? { error: t('zoneKeyInvalid') } : {})}
              disabled={zone !== null}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <FormField
          name="name"
          render={({ field, error }) => (
            <TextField
              label={t('zoneNameField')}
              {...(error ? { error: t('nameRequired') } : {})}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <Stack orientation="horizontal" gap="sm">
          <Button variant="primary" isLoading={saving} onClick={submit}>
            {zone === null ? t('zoneAdd') : t('zoneSave')}
          </Button>
          {zone === null ? null : (
            <Button variant="secondary" disabled={saving} onClick={onCancelEdit}>
              {t('cancel')}
            </Button>
          )}
        </Stack>
      </Stack>
    </FormProvider>
  );
}
