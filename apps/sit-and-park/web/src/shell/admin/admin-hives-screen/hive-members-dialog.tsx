'use client';

import { useState } from 'react';
import type { AdminHive } from '@sit-and-park/contract';
import { useTranslations } from '@sit-and-park/i18n';
import { Button, Modal, Stack, Text } from '@shoptet/ui';
import { SingleSelect } from '../../../ui/client-select/client-select';
import { Toast } from '../../../ui/toast/toast';
import styles from './admin-hives-screen.module.css';

export interface MemberCandidate {
  readonly id: string;
  readonly name: string;
  /** Name of the hive the user is in today, if any; adding moves them. */
  readonly currentHiveName: string | null;
}

export interface HiveMembersDialogProps {
  readonly hive: AdminHive;
  readonly candidates: readonly MemberCandidate[];
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onAdd: (candidate: MemberCandidate) => void;
  readonly onRemove: (userId: string) => void;
  readonly onClose: () => void;
}

export function HiveMembersDialog({
  hive,
  candidates,
  errorMessage,
  saving,
  onAdd,
  onRemove,
  onClose,
}: HiveMembersDialogProps) {
  const t = useTranslations('adminHives');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = candidates.find((candidate) => candidate.id === pickedId) ?? null;

  return (
    <Modal isOpen onClose={onClose}>
      <Modal.Header>{t('membersTitle', { name: hive.name })}</Modal.Header>
      <Modal.Content>
        <Stack gap="xl">
          {hive.members.length === 0 ? (
            <Text variant="secondary">{t('membersEmpty')}</Text>
          ) : (
            <ul className={styles.members}>
              {hive.members.map((member) => (
                <li key={member.userId} className={styles.member}>
                  <Text>{member.name}</Text>
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => onRemove(member.userId)}
                  >
                    {t('memberRemove', { name: member.name })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Stack orientation="horizontal" align="end" gap="md">
            <SingleSelect
              label={t('memberAddField')}
              options={[...candidates]}
              getOptionValue={(candidate) => candidate.id}
              getOptionLabel={(candidate) =>
                candidate.currentHiveName === null
                  ? candidate.name
                  : t('memberOption', { name: candidate.name, hive: candidate.currentHiveName })
              }
              value={pickedId}
              onChange={setPickedId}
            />
            <Button
              variant="primary"
              disabled={picked === null || saving}
              onClick={() => {
                if (picked !== null) {
                  setPickedId(null);
                  onAdd(picked);
                }
              }}
            >
              {t('memberAdd')}
            </Button>
          </Stack>
          {errorMessage ? <Toast tone="danger">{errorMessage}</Toast> : null}
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
