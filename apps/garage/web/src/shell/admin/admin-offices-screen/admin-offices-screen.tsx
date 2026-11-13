'use client';

/**
 * The "Kanceláře" tab: offices with their desk, parking spot and user counts,
 * create / edit (name, active) and, per office, its zones. A floor plan is a
 * bundled asset set by a migration, so nothing here uploads one.
 */

import { useState } from 'react';
import { useRequireAuth } from '@garage/auth/client';
import type { AdminOffice } from '@garage/contract';
import { useTranslations } from '@garage/i18n';
import { Button, Stack, Tag, Text } from '@shoptet/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type DataTableColumn } from '../../../ui/data-table/data-table';
import { VisuallyHidden } from '../../../ui/visually-hidden/visually-hidden';
import { useApi } from '../../api-provider/api-provider';
import { ScreenDataGuard, screenDataOf } from '../../screen-state/screen-state';
import { useAdminFailure } from '../use-admin-failure';
import { OfficeFormDialog } from './office-form-dialog';
import { ZonesDialog } from './zones-dialog';

type Dialog =
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly office: AdminOffice }
  | { readonly kind: 'zones'; readonly office: AdminOffice };

export function AdminOfficesScreen() {
  const t = useTranslations('adminOffices');
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const failure = useAdminFailure();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const officesQuery = useQuery({
    ...api.admin.office.list.queryOptions({ input: {} }),
    enabled: status === 'authenticated',
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: api.admin.office.key() });
  };
  const createOffice = useMutation({
    ...api.admin.office.create.mutationOptions(),
    onSettled: refresh,
  });
  const updateOffice = useMutation({
    ...api.admin.office.update.mutationOptions(),
    onSettled: refresh,
  });
  const saving = createOffice.isPending || updateOffice.isPending;

  function changeDialog(next: Dialog | null) {
    failure.clear();
    setDialog(next);
  }

  const columns: DataTableColumn<AdminOffice>[] = [
    {
      id: 'name',
      header: t('columnName'),
      sortValue: (office) => office.name.toLocaleLowerCase('cs-CZ'),
      cell: (office) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Text appearance="strong-md">{office.name}</Text>
          {office.active ? null : <Tag level="default">{t('inactive')}</Tag>}
        </Stack>
      ),
    },
    {
      id: 'desks',
      header: t('columnDesks'),
      align: 'end',
      width: '100px',
      sortValue: (office) => office.deskCount,
      cell: (office) => <Text>{office.deskCount}</Text>,
    },
    {
      id: 'spots',
      header: t('columnSpots'),
      align: 'end',
      width: '100px',
      sortValue: (office) => office.spotCount,
      cell: (office) => <Text>{office.spotCount}</Text>,
    },
    {
      id: 'users',
      header: t('columnUsers'),
      align: 'end',
      width: '100px',
      sortValue: (office) => office.userCount,
      cell: (office) => <Text>{office.userCount}</Text>,
    },
    {
      id: 'actions',
      header: <VisuallyHidden>{t('columnActions')}</VisuallyHidden>,
      align: 'end',
      width: '240px',
      cell: (office) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Button variant="secondary" onClick={() => changeDialog({ kind: 'zones', office })}>
            {t('zones')}
          </Button>
          <Button variant="secondary" onClick={() => changeDialog({ kind: 'edit', office })}>
            {t('edit')}
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <ScreenDataGuard
      state={screenDataOf(officesQuery)}
      onRetry={() => void officesQuery.refetch()}
      headingLevel={3}
    >
      {({ offices }) => (
        <Stack gap="lg">
          <DataTable
            columns={columns}
            data={[...offices]}
            getRowId={(office) => office.id}
            title={t('title')}
            description={t('description')}
            actions={
              <Button variant="primary" size="lg" onClick={() => changeDialog({ kind: 'create' })}>
                {t('add')}
              </Button>
            }
            defaultSort={{ columnId: 'name', direction: 'asc' }}
            minWidth="760px"
            emptyTitle={t('empty')}
          />

          {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
            <OfficeFormDialog
              key={dialog.kind === 'edit' ? dialog.office.id : 'create'}
              office={dialog.kind === 'edit' ? dialog.office : null}
              errorMessage={failure.message}
              saving={saving}
              onCancel={() => changeDialog(null)}
              onSubmit={async (values) => {
                const ok =
                  dialog.kind === 'edit'
                    ? await failure.run(
                        'officeUpdate',
                        updateOffice.mutateAsync({ officeId: dialog.office.id, ...values })
                      )
                    : await failure.run('officeCreate', createOffice.mutateAsync(values));
                if (ok) changeDialog(null);
              }}
            />
          ) : null}

          {dialog?.kind === 'zones' ? (
            <ZonesDialog office={dialog.office} onClose={() => changeDialog(null)} />
          ) : null}
        </Stack>
      )}
    </ScreenDataGuard>
  );
}
