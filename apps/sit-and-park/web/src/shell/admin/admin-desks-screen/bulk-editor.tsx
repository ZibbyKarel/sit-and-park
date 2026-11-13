'use client';

/** The side panel for SEVERAL selected desks: bulk active / hive, bulk grant and revoke. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, SystemMessage } from '@shoptet/ui';
import { useTranslations } from '@sit-and-park/i18n';
import type {
  AdminBulkUpdateDesksInput,
  AdminDesk,
  AdminHive,
  AdminUser,
} from '@sit-and-park/contract';
import { useApi } from '../../api-provider/api-provider';
import { ConfirmDialog } from '../../../ui/confirm-dialog/confirm-dialog';
import { useDeskWriteError } from './admin-desks-errors';
import { bulkImpact } from './admin-desks-view';
import { ImpactWarnings } from './impact-warnings';
import { OptionSelect, type Option } from './option-select';
import styles from './admin-desks-screen.module.css';

/** "Leave as is" in the active and hive selects; never a real id. */
const KEEP = 'keep';
const ON = 'on';
const OFF = 'off';
/** Hive select: take the desks out of their hive. */
const NO_HIVE = 'none';

export interface BulkEditorProps {
  readonly desks: readonly AdminDesk[];
  readonly hives: readonly AdminHive[];
  readonly users: readonly AdminUser[];
  readonly onChanged: () => void;
}

export function BulkEditor({ desks, hives, users, onChanged }: BulkEditorProps) {
  const t = useTranslations('adminDesks');
  const api = useApi();
  const describe = useDeskWriteError();

  const [activeChoice, setActiveChoice] = useState<string>(KEEP);
  const [hiveChoice, setHiveChoice] = useState<string>(KEEP);
  const [grantUserId, setGrantUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminBulkUpdateDesksInput | null>(null);

  const bulk = useMutation({
    ...api.admin.desk.bulkUpdate.mutationOptions(),
    onSuccess: onChanged,
    onSettled: () => setPending(null),
  });
  const grant = useMutation({ ...api.admin.desk.setGrant.mutationOptions(), onSuccess: onChanged });

  const deskIds = desks.map((desk) => desk.id);
  const change: Omit<AdminBulkUpdateDesksInput, 'deskIds'> = {
    ...(activeChoice === KEEP ? {} : { active: activeChoice === ON }),
    ...(hiveChoice === KEEP ? {} : { hiveId: hiveChoice === NO_HIVE ? null : hiveChoice }),
  };
  const hasChange = activeChoice !== KEEP || hiveChoice !== KEEP;

  const apply = () => {
    const input = { deskIds, ...change };
    if (bulkImpact(desks, change) === null) bulk.mutate(input);
    else setPending(input);
  };

  const activeOptions: Option[] = [
    { value: KEEP, label: t('bulkKeep') },
    { value: ON, label: t('bulkActivate') },
    { value: OFF, label: t('bulkDeactivate') },
  ];
  const hiveOptions: Option[] = [
    { value: KEEP, label: t('bulkKeep') },
    { value: NO_HIVE, label: t('hiveNone') },
    ...hives.map((hive) => ({ value: hive.id, label: hive.name })),
  ];
  const userOptions: Option[] = users.map((user) => ({
    value: user.id,
    label: `${user.name} (${user.email})`,
  }));

  return (
    <section className={styles.panel} aria-label={t('bulkTitle', { count: desks.length })}>
      <h2>{t('bulkTitle', { count: desks.length })}</h2>

      <OptionSelect
        label={t('bulkActiveField')}
        options={activeOptions}
        value={activeChoice}
        onChange={(value) => setActiveChoice(value ?? KEEP)}
      />
      <OptionSelect
        label={t('bulkHiveField')}
        options={hiveOptions}
        value={hiveChoice}
        onChange={(value) => setHiveChoice(value ?? KEEP)}
      />
      <p className={styles.muted}>{t('warnChange')}</p>
      {bulk.error === null ? null : (
        <SystemMessage level="alert" description={describe('bulkUpdate', bulk.error)} />
      )}
      {bulk.data === undefined ? null : (
        <SystemMessage
          level="success"
          description={t('bulkUpdated', { count: bulk.data.updated })}
        />
      )}
      <div className={styles.row}>
        <Button
          variant="primary"
          size="sm"
          disabled={!hasChange}
          isLoading={bulk.isPending}
          onClick={apply}
        >
          {t('bulkApply')}
        </Button>
      </div>

      <div className={styles.section}>
        <h3>{t('bulkGrantsTitle')}</h3>
        <OptionSelect
          label={t('grantUserField')}
          options={userOptions}
          value={grantUserId}
          onChange={setGrantUserId}
        />
        {grant.error === null ? null : (
          <SystemMessage level="alert" description={describe('grant', grant.error)} />
        )}
        {grant.data === undefined ? null : (
          <SystemMessage
            level="success"
            description={t('grantsChanged', { count: grant.data.updated })}
          />
        )}
        <div className={styles.row}>
          {([true, false] as const).map((granted) => (
            <Button
              key={String(granted)}
              variant="secondary"
              size="sm"
              disabled={grantUserId === null}
              isLoading={grant.isPending && grant.variables?.granted === granted}
              onClick={() =>
                grantUserId !== null && grant.mutate({ deskIds, userId: grantUserId, granted })
              }
            >
              {granted ? t('bulkGrant') : t('bulkRevoke')}
            </Button>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={t('bulkConfirmTitle', { count: desks.length })}
        description={
          <ImpactWarnings impact={pending === null ? null : bulkImpact(desks, pending)} />
        }
        confirmLabel={t('confirmApply')}
        cancelLabel={t('confirmCancel')}
        tone="danger"
        loading={bulk.isPending}
        onConfirm={() => pending !== null && bulk.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
