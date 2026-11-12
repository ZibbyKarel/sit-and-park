'use client';

/**
 * The "Hivy" tab: teams that own a set of desks. A hive has a name, a colour
 * and an owner (who decides approval requests for its desks); a user is in at
 * most one hive, so adding someone who is in another one moves them — the
 * confirmation names the hive they leave. Deleting a hive frees its desks and
 * rejects pending requests, which the confirmation also says.
 *
 * Connected: fetches `admin.hive.list` and `admin.user.list`, writes through
 * `admin.hive.*`, and refetches rather than patching (the API decides what a
 * change did).
 */

import { useState } from 'react';
import { useRequireAuth } from '@garage/auth/client';
import type { AdminHive } from '@garage/contract';
import { useTranslations } from '@garage/i18n';
import { Button, Stack, Text } from '@shoptet/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../../ui/confirm-dialog/confirm-dialog';
import { DataTable, type DataTableColumn } from '../../../ui/data-table/data-table';
import { VisuallyHidden } from '../../../ui/visually-hidden/visually-hidden';
import { useApi } from '../../api-provider/api-provider';
import { ScreenDataGuard, screenDataOf } from '../../screen-state/screen-state';
import { useAdminFailure } from '../use-admin-failure';
import { HiveFormDialog } from './hive-form-dialog';
import { HiveMembersDialog, type MemberCandidate } from './hive-members-dialog';
import { addableUsers, hiveOfUser } from './hives-view';
import styles from './admin-hives-screen.module.css';

type Dialog =
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly hive: AdminHive }
  | { readonly kind: 'delete'; readonly hive: AdminHive }
  | { readonly kind: 'members'; readonly hiveId: string }
  | {
      readonly kind: 'move';
      readonly hiveId: string;
      readonly candidate: MemberCandidate;
    };

export function AdminHivesScreen() {
  const t = useTranslations('adminHives');
  const api = useApi();
  const queryClient = useQueryClient();
  const { status } = useRequireAuth();
  const enabled = status === 'authenticated';
  const failure = useAdminFailure();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const hivesQuery = useQuery({ ...api.admin.hive.list.queryOptions({ input: {} }), enabled });
  const usersQuery = useQuery({ ...api.admin.user.list.queryOptions({ input: {} }), enabled });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: api.admin.hive.key() });
    // Desks show their hive (name, colour, access) and a delete frees them.
    queryClient.invalidateQueries({ queryKey: api.desk.key() });
    queryClient.invalidateQueries({ queryKey: api.admin.desk.key() });
  };
  const createHive = useMutation({
    ...api.admin.hive.create.mutationOptions(),
    onSettled: refresh,
  });
  const updateHive = useMutation({
    ...api.admin.hive.update.mutationOptions(),
    onSettled: refresh,
  });
  const deleteHive = useMutation({
    ...api.admin.hive.delete.mutationOptions(),
    onSettled: refresh,
  });
  const setMembership = useMutation({
    ...api.admin.hive.setMembership.mutationOptions(),
    onSettled: refresh,
  });
  const saving =
    createHive.isPending || updateHive.isPending || deleteHive.isPending || setMembership.isPending;

  function changeDialog(next: Dialog | null) {
    failure.clear();
    setDialog(next);
  }

  const columns: DataTableColumn<AdminHive>[] = [
    {
      id: 'name',
      header: t('columnName'),
      sortValue: (hive) => hive.name.toLocaleLowerCase('cs-CZ'),
      cell: (hive) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <span className={styles.swatch} style={{ backgroundColor: hive.color }} aria-hidden />
          <Text appearance="strong-md">{hive.name}</Text>
          <Text variant="tertiary">{hive.color}</Text>
        </Stack>
      ),
    },
    {
      id: 'owner',
      header: t('columnOwner'),
      sortValue: (hive) => hive.ownerName.toLocaleLowerCase('cs-CZ'),
      cell: (hive) => <Text>{hive.ownerName}</Text>,
    },
    {
      id: 'members',
      header: t('columnMembers'),
      align: 'end',
      width: '110px',
      sortValue: (hive) => hive.members.length,
      cell: (hive) => <Text>{hive.members.length}</Text>,
    },
    {
      id: 'desks',
      header: t('columnDesks'),
      align: 'end',
      width: '110px',
      sortValue: (hive) => hive.deskCount,
      cell: (hive) => <Text>{hive.deskCount}</Text>,
    },
    {
      id: 'actions',
      header: <VisuallyHidden>{t('columnActions')}</VisuallyHidden>,
      align: 'end',
      width: '320px',
      cell: (hive) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Button
            variant="secondary"
            aria-label={t('membersFor', { name: hive.name })}
            onClick={() => changeDialog({ kind: 'members', hiveId: hive.id })}
          >
            {t('members')}
          </Button>
          <Button
            variant="secondary"
            aria-label={t('editFor', { name: hive.name })}
            onClick={() => changeDialog({ kind: 'edit', hive })}
          >
            {t('edit')}
          </Button>
          <Button
            variant="destructive"
            aria-label={t('deleteFor', { name: hive.name })}
            onClick={() => changeDialog({ kind: 'delete', hive })}
          >
            {t('delete')}
          </Button>
        </Stack>
      ),
    },
  ];

  return (
    <ScreenDataGuard
      state={screenDataOf(hivesQuery)}
      onRetry={() => void hivesQuery.refetch()}
      headingLevel={3}
    >
      {({ hives }) => {
        const users = usersQuery.data?.users ?? [];
        const membersHive =
          dialog?.kind === 'members' || dialog?.kind === 'move'
            ? (hives.find((hive) => hive.id === dialog.hiveId) ?? null)
            : null;
        const candidates: MemberCandidate[] =
          membersHive === null
            ? []
            : addableUsers(users, membersHive).map((user) => ({
                id: user.id,
                name: user.name,
                currentHiveName: hiveOfUser(hives, user.id)?.name ?? null,
              }));
        const move = dialog?.kind === 'move' ? dialog : null;

        function setMember(hiveId: string, userId: string, member: boolean) {
          return failure.run(
            'hiveMembership',
            setMembership.mutateAsync({ hiveId, userId, member })
          );
        }

        return (
          <Stack gap="lg">
            <DataTable
              columns={columns}
              data={[...hives]}
              getRowId={(hive) => hive.id}
              title={t('title')}
              description={t('description')}
              actions={
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => changeDialog({ kind: 'create' })}
                >
                  {t('add')}
                </Button>
              }
              defaultSort={{ columnId: 'name', direction: 'asc' }}
              minWidth="860px"
              emptyTitle={t('empty')}
              emptyDescription={t('emptyDescription')}
            />

            {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
              <HiveFormDialog
                key={dialog.kind === 'edit' ? dialog.hive.id : 'create'}
                hive={dialog.kind === 'edit' ? dialog.hive : null}
                owners={users.filter((user) => user.active)}
                errorMessage={failure.message}
                saving={saving}
                onCancel={() => changeDialog(null)}
                onSubmit={async (values) => {
                  const ok =
                    dialog.kind === 'edit'
                      ? await failure.run(
                          'hiveUpdate',
                          updateHive.mutateAsync({ hiveId: dialog.hive.id, ...values })
                        )
                      : await failure.run('hiveCreate', createHive.mutateAsync(values));
                  if (ok) changeDialog(null);
                }}
              />
            ) : null}

            {dialog?.kind === 'members' && membersHive !== null ? (
              <HiveMembersDialog
                hive={membersHive}
                candidates={candidates}
                errorMessage={failure.message}
                saving={saving}
                onAdd={(candidate) => {
                  if (candidate.currentHiveName === null) {
                    void setMember(membersHive.id, candidate.id, true);
                  } else {
                    changeDialog({ kind: 'move', hiveId: membersHive.id, candidate });
                  }
                }}
                onRemove={(userId) => void setMember(membersHive.id, userId, false)}
                onClose={() => changeDialog(null)}
              />
            ) : null}

            <ConfirmDialog
              open={move !== null && membersHive !== null}
              title={t('moveTitle', { name: move?.candidate.name ?? '' })}
              description={t('moveDescription', {
                name: move?.candidate.name ?? '',
                from: move?.candidate.currentHiveName ?? '',
                to: membersHive?.name ?? '',
              })}
              confirmLabel={t('moveConfirm')}
              cancelLabel={t('cancel')}
              loading={saving}
              onCancel={() =>
                changeDialog(move === null ? null : { kind: 'members', hiveId: move.hiveId })
              }
              onConfirm={() => {
                if (move === null) return;
                void setMember(move.hiveId, move.candidate.id, true).then((ok) => {
                  if (ok) changeDialog({ kind: 'members', hiveId: move.hiveId });
                });
              }}
            >
              {dialog?.kind === 'move' && failure.message ? (
                <Text variant="secondary">{failure.message}</Text>
              ) : null}
            </ConfirmDialog>

            <ConfirmDialog
              open={dialog?.kind === 'delete'}
              tone="danger"
              title={t('deleteTitle', { name: dialog?.kind === 'delete' ? dialog.hive.name : '' })}
              description={t('deleteDescription')}
              confirmLabel={t('deleteConfirm')}
              cancelLabel={t('cancel')}
              loading={saving}
              onCancel={() => changeDialog(null)}
              onConfirm={() => {
                if (dialog?.kind !== 'delete') return;
                void failure
                  .run('hiveDelete', deleteHive.mutateAsync({ hiveId: dialog.hive.id }))
                  .then((ok) => {
                    if (ok) changeDialog(null);
                  });
              }}
            >
              {dialog?.kind === 'delete' && failure.message ? (
                <Text variant="secondary">{failure.message}</Text>
              ) : null}
            </ConfirmDialog>
          </Stack>
        );
      }}
    </ScreenDataGuard>
  );
}
