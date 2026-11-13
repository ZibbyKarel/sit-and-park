'use client';

/**
 * The "Parkovací místa" tab (`doc/design/screens/04-admin-spots.png`): the spot
 * list, an inline category picker and activity switch per row, and add / edit /
 * delete.
 *
 * ## "Smazat" retires, it never deletes
 *
 * The button says *Smazat* because the design says so, but the procedure behind
 * it is `admin.spot.deactivate`, which sets `active: false`. A spot row can
 * never be deleted — `Reservation`, `WaitlistEntry` and `AuditLog` all point at
 * it — and the API refuses even the soft delete while somebody still holds the
 * spot from today onwards. That `CONFLICT` gets its own Czech sentence here,
 * because the generic one ("somebody else made the same change") would be a
 * false explanation. See
 * `doc/decision/0163-smazat-retires-a-spot-and-says-so-when-it-cannot.md`.
 *
 * ## The category chips are counts, not editors
 *
 * The design draws removable chips and an "Přidat kategorii" field. A category
 * is `PARKING_GROUPS` — a closed enum in `libs/sit-and-park/shared-types` backed by a Postgres
 * enum column — so there is nothing here that could add or remove one without a
 * schema change. The band renders the counts and says the list is fixed rather
 * than offering a control that cannot work. See
 * `doc/decision/0164-parking-categories-stay-a-closed-enum.md`.
 *
 * ## "Skryté" hides, it does not retire
 *
 * A hidden spot is seen and booked by admins only; normal users do not see it
 * anywhere (`doc/decision/0316-hidden-spots-are-seen-and-booked-by-admins-only`).
 * Unlike the activity switch it collides with nothing, so it has no conflict
 * copy of its own.
 *
 * ## "Nabíječka" is information only
 *
 * The EV-charger switch changes no booking rule and collides with nothing, so
 * like "Skryté" it has no conflict copy of its own. The bolt next to the label
 * is the same mark the lot draws, and it carries the same accessible name
 * (`doc/decision/0317-the-ev-charger-flag-is-informational-and-shown-to-everyone`).
 *
 * Presentational: `../admin-spots-panel.tsx` is the connected half.
 */

import { useState } from 'react';
import type {
  AdminOffice,
  CreateSpotInput,
  ParkingSpot,
  SpotListOutput,
  UpdateSpotInput,
} from '@sit-and-park/contract';
import { Button, Stack, Switch, Tag, Text } from '@shoptet/ui';
import { SingleSelect } from '../../../ui/client-select/client-select';
import { ConfirmDialog } from '../../../ui/confirm-dialog/confirm-dialog';
import { DataTable } from '../../../ui/data-table/data-table';
import type { DataTableColumn } from '../../../ui/data-table/data-table';
import { BoltIcon } from '../../../ui/icons/icons';
import { VisuallyHidden } from '../../../ui/visually-hidden/visually-hidden';
import { PARKING_GROUPS, useTranslations } from '@sit-and-park/i18n';
import { useNotify } from '../../notifications/toast-provider';
import { ScreenDataGuard, type ScreenData } from '../../screen-state/screen-state';
import { useAdminWriteError, type AdminWriteFailure } from '../admin-errors';
import {
  isDialogSaving,
  shouldShowFailureIn,
  type FailureSurface,
  type SpotDialog,
} from './spots-view';
import { CategoryBand } from './category-band';
import { SpotFormDialog } from './spot-form-dialog';

const GROUP_OPTIONS = PARKING_GROUPS.map((group) => ({ group }));

/** How a spot stands today, as the day overview reports it. */
export interface SpotToday {
  /** Name of whoever holds the spot today, or `null` when it is free. */
  readonly holderName: string | null;
  /** Whether that holder is a guest — meaningless when {@link holderName} is `null`. */
  readonly holderIsGuest: boolean;
}

/** A label/group/EV charger/office edit: `id`, `label` and `group` required, the rest optional. */
export type SaveSpotInput = Pick<UpdateSpotInput, 'id' | 'evCharger' | 'officeId'> &
  Required<Pick<UpdateSpotInput, 'label' | 'group'>>;

export interface AdminSpotsScreenProps {
  readonly onRetry: () => void;
  /** The spot list as one state. Inactive spots included. */
  readonly spots: ScreenData<SpotListOutput>;
  /**
   * Today's state per spot id. A spot missing from the map has no state to show
   * — an inactive spot is not in the day overview at all — and renders as a
   * dash rather than as "Volné", which would be a claim.
   */
  readonly todayBySpotId: ReadonlyMap<string, SpotToday>;
  /** Offices for the column and the form's picker. */
  readonly offices: readonly (Pick<AdminOffice, 'id' | 'name'> &
    Partial<Pick<AdminOffice, 'active'>>)[];
  /** Resolves when the spot exists; rejects to keep the dialog open. */
  readonly onCreate: (input: CreateSpotInput) => Promise<void>;
  /** Same contract, for a label/group/EV charger edit. */
  readonly onSave: (input: SaveSpotInput) => Promise<void>;
  /** Inline activity switch. Fire-and-forget: the row reports through `rowError`. */
  readonly onActiveChange: (id: string, active: boolean) => void;
  /** Inline "Skryté" switch. Fire-and-forget, like `onActiveChange`. */
  readonly onHiddenChange: (id: string, hidden: boolean) => void;
  /** Inline "Nabíječka" switch. Fire-and-forget, like `onActiveChange`. */
  readonly onEvChargerChange: (id: string, evCharger: boolean) => void;
  /** Resolves when the spot is retired; rejects to keep the dialog open. */
  readonly onDeactivate: (id: string) => Promise<void>;
  /**
   * A write is in flight for this spot id, if any. Scopes the row-level
   * disabling: only the row being written is frozen, not the whole table.
   */
  readonly pendingSpotId: string | null;
  /** Any write is in flight — including a create, which has no id yet. */
  readonly isSaving: boolean;
  /**
   * The failed write, or `null` when there is none. See
   * {@link AdminWriteFailure} for why the error and its origin are one value.
   */
  readonly writeFailure: AdminWriteFailure | null;
  /**
   * Throws away whatever `writeFailure` holds.
   *
   * Called on every dialog change — opened, swapped, cancelled or closed after
   * a success. A failure describes one attempt at one spot; the moment the
   * admin moves to a different dialog it describes nothing on screen, and
   * leaving it in state is how it gets re-shown under the wrong heading. See
   * `doc/decision/0167-*`.
   */
  readonly onDiscardFailure: () => void;
}

export function AdminSpotsScreen({
  onRetry,
  spots,
  todayBySpotId,
  offices,
  onCreate,
  onSave,
  onActiveChange,
  onHiddenChange,
  onEvChargerChange,
  onDeactivate,
  pendingSpotId,
  isSaving,
  writeFailure,
  onDiscardFailure,
}: AdminSpotsScreenProps) {
  const t = useTranslations('admin');
  // Same badge and key the spot dialog and the admin day table render —
  // `guestHolder` lives in the `lot` catalogue.
  const tLot = useTranslations('lot');
  const describeWriteError = useAdminWriteError();
  const [dialog, setDialog] = useState<SpotDialog | null>(null);

  /**
   * The only way the dialog changes. Every open, swap, cancel and
   * close-on-success goes through here so that the failure on screen is
   * discarded with it — see `onDiscardFailure`.
   */
  function changeDialog(next: SpotDialog | null) {
    onDiscardFailure();
    setDialog(next);
  }

  /**
   * The sentence to print on `where`, or `null` when nothing belongs there.
   *
   * {@link shouldShowFailureIn} holds the rule — which surface a failure is
   * shown on, and which surfaces could have produced it at all; this adds the
   * two things only the screen has, the failure itself and the translation of
   * it. Each call site therefore renders at most one `Toast`.
   */
  function failureShownIn(where: FailureSurface): string | null {
    if (writeFailure === null) {
      return null;
    }
    return shouldShowFailureIn(writeFailure.from, dialog?.kind ?? null, where)
      ? describeWriteError(writeFailure.from, writeFailure.error)
      : null;
  }

  const dialogSaving = isDialogSaving(isSaving, dialog, pendingSpotId);

  const officeNames = new Map(offices.map((office) => [office.id, office.name]));

  const columns: DataTableColumn<ParkingSpot>[] = [
    {
      id: 'label',
      header: t('spotsColumnLabel'),
      sortValue: (spot) => spot.label,
      cell: (spot) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Text appearance="strong-md">{spot.label}</Text>
          {spot.evCharger ? <BoltIcon label={tLot('evCharger')} /> : null}
          {spot.active ? null : <Tag level="default">{t('spotsInactive')}</Tag>}
          {spot.hidden ? <Tag level="default">{t('spotsHidden')}</Tag> : null}
        </Stack>
      ),
    },
    {
      id: 'group',
      header: t('spotsColumnGroup'),
      width: '160px',
      cell: (spot) => (
        <SingleSelect
          label={t('spotsGroupSelectLabel', { label: spot.label })}
          options={GROUP_OPTIONS}
          getOptionValue={(option) => option.group}
          getOptionLabel={(option) => option.group}
          value={spot.group}
          disabled={pendingSpotId === spot.id}
          onChange={(group) => {
            if (group !== null) {
              void onSave({ id: spot.id, label: spot.label, group }).catch(() => {
                // The row's failure is rendered by `writeFailure` above the table;
                // an unhandled rejection here would only add noise to the console.
              });
            }
          }}
        />
      ),
    },
    {
      id: 'office',
      header: t('spotsColumnOffice'),
      width: '160px',
      sortValue: (spot) => officeNames.get(spot.officeId) ?? '',
      cell: (spot) => <Text>{officeNames.get(spot.officeId) ?? spot.officeId}</Text>,
    },
    {
      id: 'today',
      header: t('spotsColumnToday'),
      cell: (spot) => {
        const today = todayBySpotId.get(spot.id);
        if (today === undefined) {
          return <Text variant="tertiary">{t('spotsTodayUnknown')}</Text>;
        }
        return today.holderName === null ? (
          <Text variant="tertiary">{t('dayStatusFree')}</Text>
        ) : (
          // Same `ml-2`-as-row-gap replacement as `AdminDayScreen`'s status
          // column — this cell renders the identical guest tag.
          <Stack orientation="horizontal" align="center" gap="sm">
            <Text>{t('dayStatusTaken', { name: today.holderName })}</Text>
            {today.holderIsGuest ? (
              <Tag size="sm" level="default" variant="secondary">
                {tLot('guestHolder')}
              </Tag>
            ) : null}
          </Stack>
        );
      },
    },
    {
      id: 'active',
      header: t('spotsColumnActive'),
      width: '110px',
      cell: (spot) => (
        <Switch
          checked={spot.active}
          label={t('spotsActiveToggleLabel', { label: spot.label })}
          disabled={pendingSpotId === spot.id}
          onChange={(next) => onActiveChange(spot.id, next)}
        />
      ),
    },
    {
      id: 'hidden',
      header: t('spotsColumnHidden'),
      width: '110px',
      cell: (spot) => (
        <Switch
          checked={spot.hidden}
          label={t('spotsHiddenToggleLabel', { label: spot.label })}
          disabled={pendingSpotId === spot.id}
          onChange={(next) => onHiddenChange(spot.id, next)}
        />
      ),
    },
    {
      id: 'evCharger',
      header: t('spotsColumnEvCharger'),
      width: '110px',
      cell: (spot) => (
        <Switch
          checked={spot.evCharger}
          label={t('spotsEvChargerToggleLabel', { label: spot.label })}
          disabled={pendingSpotId === spot.id}
          onChange={(next) => onEvChargerChange(spot.id, next)}
        />
      ),
    },
    {
      id: 'actions',
      header: <VisuallyHidden>{t('spotsColumnActions')}</VisuallyHidden>,
      align: 'end',
      width: '210px',
      cell: (spot) => (
        <Stack orientation="horizontal" align="center" gap="sm">
          <Button
            variant="secondary"
            disabled={pendingSpotId === spot.id}
            onClick={() => changeDialog({ kind: 'edit', spot })}
          >
            {t('spotsEdit')}
          </Button>
          <Button
            variant="destructive"
            disabled={pendingSpotId === spot.id}
            onClick={() => changeDialog({ kind: 'delete', spot })}
          >
            {t('spotsDelete')}
          </Button>
        </Stack>
      ),
    },
  ];

  const tableError = failureShownIn('table');
  // Only the delete dialog carries its failure inside itself; the form dialog
  // takes the same value through its own `errorMessage` prop.
  const deleteError = dialog?.kind === 'delete' ? failureShownIn('dialog') : null;

  useNotify(tableError, 'danger');
  useNotify(deleteError, 'danger');

  return (
    <ScreenDataGuard state={spots} onRetry={onRetry} headingLevel={3}>
      {(loaded) => (
        <Stack gap="lg">
          <DataTable
            columns={columns}
            data={[...loaded.spots]}
            getRowId={(spot) => spot.id}
            title={t('spotsTitle')}
            description={t('spotsDescription')}
            actions={
              <Button variant="primary" size="lg" onClick={() => changeDialog({ kind: 'create' })}>
                {t('spotsAdd')}
              </Button>
            }
            toolbar={<CategoryBand spots={loaded.spots} />}
            defaultSort={{ columnId: 'label', direction: 'asc' }}
            minWidth="1060px"
            emptyTitle={t('spotsEmpty')}
            emptyDescription={t('spotsEmptyDescription')}
          />

          {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
            <SpotFormDialog
              // A fresh form per spot. Without it an edit→edit transition would
              // reuse the mounted form and its previous `defaultValues`.
              key={dialog.kind === 'edit' ? dialog.spot.id : 'create'}
              spot={dialog.kind === 'edit' ? dialog.spot : null}
              offices={offices}
              errorMessage={failureShownIn('dialog')}
              saving={dialogSaving}
              onCancel={() => changeDialog(null)}
              onSubmit={async (values) => {
                if (dialog.kind === 'edit') {
                  await onSave({ id: dialog.spot.id, ...values });
                } else {
                  await onCreate(values);
                }
                changeDialog(null);
              }}
            />
          ) : null}

          <ConfirmDialog
            open={dialog?.kind === 'delete'}
            title={t('spotsDeleteTitle', {
              label: dialog?.kind === 'delete' ? dialog.spot.label : '',
            })}
            description={t('spotsDeleteDescription')}
            confirmLabel={t('spotsDeleteConfirm')}
            cancelLabel={t('spotsCancel')}
            tone="danger"
            loading={dialogSaving}
            onConfirm={() => {
              if (dialog?.kind !== 'delete') {
                return;
              }
              void onDeactivate(dialog.spot.id).then(
                () => changeDialog(null),
                () => {
                  // Left open on purpose: the sentence below is the retry
                  // affordance, and closing would hide why nothing happened.
                }
              );
            }}
            onCancel={() => changeDialog(null)}
          />
        </Stack>
      )}
    </ScreenDataGuard>
  );
}
