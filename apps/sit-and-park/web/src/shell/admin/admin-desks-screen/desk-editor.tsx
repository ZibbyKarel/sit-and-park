'use client';

/**
 * The side panel for ONE selected desk: active / hive / zone / office,
 * permanent holder and direct grants. Each block is its own write, because the
 * API's side effects differ (see the warnings in the copy and `desk-view`).
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Switch, SystemMessage } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import type { AdminDesk, AdminHive, AdminOffice, AdminUser } from '@sit-and-park/contract';
import { useApi } from '../../api-provider/api-provider';
import { ConfirmDialog } from '../../../ui/confirm-dialog/confirm-dialog';
import { useDeskWriteError } from './admin-desks-errors';
import { patchImpact, toDeskPatch, type DeskDraft, type DeskPatch } from './admin-desks-view';
import { ImpactWarnings } from './impact-warnings';
import { OptionSelect, type Option } from './option-select';
import styles from './admin-desks-screen.module.css';

/** The "no hive" / "no holder" option of a select. */
export const NONE = 'none';

export interface DeskEditorProps {
  readonly desk: AdminDesk;
  readonly offices: readonly AdminOffice[];
  readonly hives: readonly AdminHive[];
  /** Active users, every office. */
  readonly users: readonly AdminUser[];
  readonly onChanged: () => void;
}

export function DeskEditor({ desk, offices, hives, users, onChanged }: DeskEditorProps) {
  const t = useTranslations('adminDesks');
  const api = useApi();
  const describe = useDeskWriteError();

  const [draft, setDraft] = useState<DeskDraft>({
    active: desk.active,
    hiveId: desk.hiveId,
    officeId: desk.officeId,
    zoneId: desk.zoneId,
  });
  const [pending, setPending] = useState<DeskPatch | null>(null);
  const [holderId, setHolderId] = useState<string | null>(desk.permanentAssigneeId);
  const [grantUserId, setGrantUserId] = useState<string | null>(null);

  const zonesQuery = useQuery(
    api.admin.zone.list.queryOptions({ input: { officeId: draft.officeId } })
  );
  const grantsQuery = useQuery(api.admin.desk.grants.queryOptions({ input: { deskId: desk.id } }));

  const update = useMutation({
    ...api.admin.desk.update.mutationOptions(),
    onSuccess: onChanged,
    onSettled: () => setPending(null),
  });
  const setHolder = useMutation({
    ...api.admin.desk.setPermanentAssignee.mutationOptions(),
    onSuccess: onChanged,
  });
  const setGrant = useMutation({
    ...api.admin.desk.setGrant.mutationOptions(),
    onSuccess: () => {
      setGrantUserId(null);
      onChanged();
    },
  });

  const patch = toDeskPatch(desk, draft);
  const dirty = Object.keys(patch).length > 0;
  // A new office needs a zone of that office, so the draft's zone is empty until one is picked.
  const missingZone = draft.zoneId === '';

  const save = () => {
    if (patchImpact(patch) === null) update.mutate({ deskId: desk.id, ...patch });
    else setPending(patch);
  };

  const hiveOptions: Option[] = [
    { value: NONE, label: t('hiveNone') },
    ...hives.map((hive) => ({ value: hive.id, label: hive.name })),
  ];
  const officeOptions: Option[] = offices.map((office) => ({
    value: office.id,
    label: office.name,
  }));
  const zoneOptions: Option[] = (zonesQuery.data?.zones ?? []).map((zone) => ({
    value: zone.id,
    label: zone.name,
  }));
  const officeUsers = users.filter((user) => user.officeId === desk.officeId);
  const holderOptions: Option[] = [
    { value: NONE, label: t('holderNone') },
    ...officeUsers.map((user) => ({ value: user.id, label: `${user.name} (${user.email})` })),
  ];
  const grants = grantsQuery.data?.grants ?? [];
  const grantOptions: Option[] = officeUsers
    .filter((user) => !grants.some((grant) => grant.userId === user.id))
    .map((user) => ({ value: user.id, label: `${user.name} (${user.email})` }));

  return (
    <section className={styles.panel} aria-label={t('editorTitle', { code: desk.code })}>
      <h2>{t('editorTitle', { code: desk.code })}</h2>

      <Switch
        checked={draft.active}
        label={t('activeToggle')}
        onChange={(active) => setDraft((current) => ({ ...current, active }))}
      />
      <OptionSelect
        label={t('fieldHive')}
        options={hiveOptions}
        value={draft.hiveId ?? NONE}
        onChange={(value) =>
          setDraft((current) => ({
            ...current,
            hiveId: value === null || value === NONE ? null : value,
          }))
        }
      />
      <OptionSelect
        label={t('fieldOffice')}
        options={officeOptions}
        value={draft.officeId}
        onChange={(value) =>
          value !== null &&
          setDraft((current) => ({
            ...current,
            officeId: value,
            // Back on the desk's own office its zone is valid again; elsewhere one must be picked.
            zoneId: value === desk.officeId ? desk.zoneId : '',
          }))
        }
      />
      <OptionSelect
        label={t('fieldZone')}
        options={zoneOptions}
        value={missingZone ? null : draft.zoneId}
        onChange={(value) =>
          value !== null && setDraft((current) => ({ ...current, zoneId: value }))
        }
      />
      <p className={styles.muted}>{t('warnChange')}</p>
      {update.error === null ? null : (
        <SystemMessage level="alert" description={describe('update', update.error)} />
      )}
      <div className={styles.row}>
        <Button
          variant="primary"
          size="sm"
          disabled={!dirty || missingZone}
          isLoading={update.isPending}
          onClick={save}
        >
          {t('save')}
        </Button>
      </div>

      <div className={styles.section}>
        <h3>{t('holderTitle')}</h3>
        <OptionSelect
          label={t('holderField')}
          options={holderOptions}
          value={holderId ?? NONE}
          onChange={(value) => setHolderId(value === null || value === NONE ? null : value)}
        />
        <p className={styles.muted}>{t('warnHolder')}</p>
        {setHolder.error === null ? null : (
          <SystemMessage level="alert" description={describe('holder', setHolder.error)} />
        )}
        <div className={styles.row}>
          <Button
            variant="secondary"
            size="sm"
            disabled={holderId === desk.permanentAssigneeId}
            isLoading={setHolder.isPending}
            onClick={() => setHolder.mutate({ deskId: desk.id, userId: holderId })}
          >
            {t('holderSave')}
          </Button>
        </div>
      </div>

      <div className={styles.section}>
        <h3>{t('grantsTitle')}</h3>
        {grants.length === 0 ? (
          <p className={styles.muted}>{t('grantsEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {grants.map((grant) => (
              <li key={grant.userId} className={styles.listItem}>
                <span>{grant.name}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t('grantRemoveFor', { name: grant.name })}
                  disabled={setGrant.isPending}
                  onClick={() =>
                    setGrant.mutate({ deskIds: [desk.id], userId: grant.userId, granted: false })
                  }
                >
                  {t('grantRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <OptionSelect
          label={t('grantUserField')}
          options={grantOptions}
          value={grantUserId}
          onChange={setGrantUserId}
        />
        {setGrant.error === null ? null : (
          <SystemMessage level="alert" description={describe('grant', setGrant.error)} />
        )}
        <div className={styles.row}>
          <Button
            variant="secondary"
            size="sm"
            disabled={grantUserId === null}
            isLoading={setGrant.isPending}
            onClick={() =>
              grantUserId !== null &&
              setGrant.mutate({ deskIds: [desk.id], userId: grantUserId, granted: true })
            }
          >
            {t('grantAdd')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={t('confirmTitle', { code: desk.code })}
        description={<ImpactWarnings impact={pending === null ? null : patchImpact(pending)} />}
        confirmLabel={t('confirmApply')}
        cancelLabel={t('confirmCancel')}
        tone="danger"
        loading={update.isPending}
        onConfirm={() => pending !== null && update.mutate({ deskId: desk.id, ...pending })}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
