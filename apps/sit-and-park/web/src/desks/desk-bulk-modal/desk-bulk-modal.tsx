'use client';

/**
 * "Hromadná rezervace stolů": the desk twin of parking's bulk modal
 * (`../../lot/bulk-modal/bulk-modal.tsx`), reusing its month grid.
 *
 * Step 1 picks days (and, for an admin, people); step 2 shows the editable
 * schedule `desk.previewBulk` proposes; confirming sends the **explicit**
 * assignments through `desk.confirmBulk`, and a third step compares the result
 * with what was proposed. Every rule is a pure function in `./desk-bulk-view`.
 *
 * Render it only while it is open: each mount starts from step 1, which is the
 * reset parking's modal gets from its `key`.
 */

import { useState } from 'react';
import {
  parseDateOnly,
  todayInPrague,
  useDateFormatters,
  useTranslations,
  type DateOnly,
} from '@sit-and-park/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, SystemMessage, Tag } from '@shoptet/ui';
import type { DeskBulkPreviewOutput } from '@sit-and-park/contract';
import { MultiSelect, SingleSelect } from '../../ui/client-select/client-select';
import { ToggleTile } from '../../ui/toggle-tile/toggle-tile';
import { VisuallyHidden } from '../../ui/visually-hidden/visually-hidden';
import { useEscapeToClose } from '../../ui/use-escape-to-close/use-escape-to-close';
import { useApi } from '../../shell/api-provider/api-provider';
import { useNotify } from '../../shell/notifications/toast-provider';
import { useAdminUserOptions } from '../../lot/use-admin-user-options';
import { buildMonthGrid, weekendColumns } from '../../lot/bulk-modal/bulk-view';
import {
  buildPlan,
  NO_DESK,
  SKIP_REASON_KEYS,
  summarizePlan,
  toAssignments,
  toDeskBulkErrorKey,
  toResultView,
  type DeskPicks,
} from './desk-bulk-view';
import styles from './desk-bulk-modal.module.css';

export interface DeskBulkModalProps {
  readonly onClose: () => void;
  /** Any day of the month the grid shows: the desks screen's own day. */
  readonly anchorDate: DateOnly;
  readonly isAdmin: boolean;
  /** `null` while the profile is loading. */
  readonly viewerUserId: string | null;
  /** Desks pre-selected on the screen (admin); the allocator uses only these. */
  readonly deskIds?: readonly string[] | undefined;
}

const WEEKDAY_KEYS = [
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
  'weekdaySun',
] as const;

const NO_RESERVED_DATES: ReadonlySet<DateOnly> = new Set();

export function DeskBulkModal({
  onClose,
  anchorDate,
  isAdmin,
  viewerUserId,
  deskIds,
}: DeskBulkModalProps) {
  const t = useTranslations('deskBulk');
  const grid = useTranslations('bulk');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();
  useEscapeToClose(true, onClose);

  const [selected, setSelected] = useState<readonly DateOnly[]>([]);
  // `null` until the user toggles someone: the selection then follows the viewer, who may
  // only become known (profile loaded) after the modal opened.
  const [pickedPeople, setPeople] = useState<readonly string[] | null>(null);
  const people = pickedPeople ?? (viewerUserId === null ? [] : [viewerUserId]);
  const [proposal, setProposal] = useState<DeskBulkPreviewOutput | null>(null);
  const [picks, setPicks] = useState<DeskPicks>({});
  const [failure, setFailure] = useState<unknown>(null);

  const userOptions = useAdminUserOptions({ input: { active: true }, enabled: isAdmin });

  const previewBulk = useMutation({
    ...api.desk.previewBulk.mutationOptions(),
    onSuccess: (output) => {
      setFailure(null);
      setPicks({});
      setProposal(output);
    },
    onError: setFailure,
  });
  const confirmBulk = useMutation({
    ...api.desk.confirmBulk.mutationOptions(),
    onSuccess: () => {
      setFailure(null);
    },
    onError: setFailure,
    // Also on failure: an unknown error (timeout, 500) may have booked some of the rows.
    // The directory, my reservations and every other desk query.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: api.desk.key() }),
  });
  const result = confirmBulk.data ?? null;
  const pending = previewBulk.isPending || confirmBulk.isPending;

  const baseErrorKey = failure === null ? null : toDeskBulkErrorKey(failure);
  // A confirm that failed for an unknown reason may have booked part of the schedule.
  const errorKey =
    baseErrorKey === 'errorUnknown' && failure === confirmBulk.error
      ? 'errorUnknownConfirm'
      : baseErrorKey;
  useNotify(errorKey === null ? null : t(errorKey), 'danger');
  useNotify(isAdmin && userOptions.error !== null ? t('peopleLoadError') : null, 'danger');

  const weekdayDate = (date: DateOnly) => `${f.dayAndMonth(date)} · ${f.weekdayName(date)}`;

  // ----------------------------------------------------------------- result
  if (result !== null && proposal !== null) {
    const view = toResultView(proposal, result);
    return (
      <Modal isOpen onClose={onClose} canBeDismissed={false} maxWidth>
        <Modal.Header subheader={t('resultDescription')}>{t('resultTitle')}</Modal.Header>
        <Modal.Content>
          <div className={styles.stack}>
            <p role="status">
              {view.reserved.length === 0
                ? t('resultNothingBooked')
                : t('resultBooked', { count: view.reserved.length })}
            </p>
            {view.reserved.length === 0 ? null : (
              <ul className={styles.list}>
                {view.reserved.map((line) => (
                  <li key={line.key}>
                    {weekdayDate(line.date)} · {line.personName} · {line.deskCode}
                  </li>
                ))}
              </ul>
            )}
            {view.skipped.length === 0 ? (
              <p>{t('resultAllAsProposed')}</p>
            ) : (
              <div role="alert">
                <SystemMessage
                  level="alert"
                  title={t('resultSkippedTitle', { count: view.skipped.length })}
                  description={
                    <>
                      {view.brokenPromises === 0 ? null : (
                        <span>{t('resultChangedDescription')}</span>
                      )}
                      <span className={styles.block}>
                        {view.skipped.map((line) => (
                          <span key={line.key} className={styles.block}>
                            <strong>
                              {weekdayDate(line.date)} · {line.personName}
                            </strong>{' '}
                            · {t('resultProposedDesk', { code: line.deskCode })}:{' '}
                            {t(SKIP_REASON_KEYS[line.reason])}
                          </span>
                        ))}
                      </span>
                    </>
                  }
                />
              </div>
            )}
          </div>
        </Modal.Content>
        <Modal.Footer>
          {({ primaryButtonProps }) => (
            <Button {...primaryButtonProps} onClick={onClose}>
              {t('ctaDone')}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    );
  }

  // --------------------------------------------------------------- schedule
  if (proposal !== null) {
    const plan = buildPlan(proposal, picks);
    const summary = summarizePlan(plan);
    const assignments = toAssignments(plan);
    return (
      <Modal isOpen onClose={onClose} canBeDismissed={false} maxWidth>
        <Modal.Header subheader={t('scheduleDescription')}>{t('scheduleTitle')}</Modal.Header>
        <Modal.Content>
          <table className={styles.table}>
            <VisuallyHidden as="caption">{t('scheduleTitle')}</VisuallyHidden>
            <thead>
              <tr>
                <th scope="col">{t('columnPerson')}</th>
                <th scope="col">{t('columnDate')}</th>
                <th scope="col">{t('columnDesk')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((row) => (
                <tr key={row.key}>
                  <td>{row.personName}</td>
                  <td>{weekdayDate(row.date)}</td>
                  <td>
                    {row.kind === 'UNAVAILABLE' ? (
                      t(SKIP_REASON_KEYS[row.reason])
                    ) : (
                      <span className={styles.deskCell}>
                        <SingleSelect
                          label={t('deskSelectLabel', {
                            person: row.personName,
                            date: f.fullDate(row.date),
                          })}
                          placeholder={t('deskSelectPlaceholder')}
                          options={[
                            { value: NO_DESK, label: t('noDesk') },
                            ...row.choices.map((desk) => ({
                              value: desk.id,
                              label: `${desk.code} · ${desk.zoneName}`,
                            })),
                          ]}
                          getOptionValue={(option) => option.value}
                          getOptionLabel={(option) => option.label}
                          value={row.deskId ?? NO_DESK}
                          disabled={!isAdmin}
                          onChange={(value) => {
                            setPicks((current) => ({
                              ...current,
                              [row.key]: value === null || value === NO_DESK ? null : value,
                            }));
                          }}
                        />
                        {row.isPreferred ? <Tag level="success">{t('preferredTag')}</Tag> : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.summary}>{t('scheduleSummary', { ...summary })}</p>
        </Modal.Content>
        <Modal.Footer>
          {({ primaryButtonProps, secondaryButtonProps }) => (
            <>
              <Button
                {...secondaryButtonProps}
                disabled={pending}
                onClick={() => {
                  setProposal(null);
                  setFailure(null);
                }}
              >
                {t('ctaBack')}
              </Button>
              <Button
                {...primaryButtonProps}
                isLoading={confirmBulk.isPending}
                disabled={pending || assignments.length === 0}
                onClick={() => {
                  confirmBulk.mutate({ assignments });
                }}
              >
                {t('ctaConfirm', { count: assignments.length })}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal>
    );
  }

  // ----------------------------------------------------------------- select
  const today = todayInPrague();
  const monthGrid = buildMonthGrid(anchorDate, today, NO_RESERVED_DATES);
  const weekendHeads = weekendColumns(monthGrid);
  const selectedSet = new Set(selected);

  return (
    <Modal isOpen onClose={onClose} canBeDismissed={false} maxWidth>
      <Modal.Header
        subheader={t('description', { month: f.monthLocative(parseDateOnly(anchorDate).month) })}
      >
        {t('title')}
      </Modal.Header>
      <Modal.Content>
        {isAdmin && userOptions.options.length > 0 ? (
          <div className={styles.people}>
            <MultiSelect
              label={t('peopleLegend')}
              options={[...userOptions.options]}
              getOptionValue={(option) => option.userId}
              getOptionLabel={(option) => option.name}
              value={[...people]}
              onChange={setPeople}
              mode="dropdown"
            />
          </div>
        ) : null}

        <table className="calendar-grid">
          <VisuallyHidden as="caption">{grid('gridLabel')}</VisuallyHidden>
          <thead>
            <tr>
              {WEEKDAY_KEYS.map((key, column) => (
                <th
                  key={key}
                  scope="col"
                  data-weekend={weekendHeads[column] === true ? '' : undefined}
                >
                  {grid(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid.weeks.map((week) => (
              <tr key={week.key}>
                {week.slots.map(({ key, day }) =>
                  day === null ? (
                    <td key={key} />
                  ) : (
                    <td key={key}>
                      <ToggleTile
                        shape="cell"
                        transition="base"
                        today={day.date === today}
                        selected={day.selectable ? selectedSet.has(day.date) : false}
                        selectable={day.selectable}
                        aria-pressed={day.selectable ? selectedSet.has(day.date) : undefined}
                        aria-label={
                          day.selectable
                            ? grid('dayCell', { date: f.fullDate(day.date) })
                            : grid('dayCellBlocked', { date: f.fullDate(day.date) })
                        }
                        onClick={() => {
                          setSelected((current) =>
                            current.includes(day.date)
                              ? current.filter((date) => date !== day.date)
                              : [...current, day.date].sort()
                          );
                        }}
                      >
                        {day.dayOfMonth}
                      </ToggleTile>
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <p className={styles.note}>{grid('nonSelectableNote')}</p>
        {deskIds === undefined ? null : (
          <p className={styles.note}>
            <strong>{t('poolNote', { count: deskIds.length })}</strong>
          </p>
        )}
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            <Button {...secondaryButtonProps} onClick={onClose}>
              {grid('close')}
            </Button>
            <Button
              {...primaryButtonProps}
              isLoading={previewBulk.isPending}
              disabled={selected.length === 0 || pending || (isAdmin && people.length === 0)}
              onClick={() => {
                previewBulk.mutate({
                  dates: [...selected],
                  ...(isAdmin ? { userIds: [...people] } : {}),
                  ...(deskIds === undefined ? {} : { deskIds: [...deskIds] }),
                });
              }}
            >
              {selected.length === 0
                ? t('ctaSelectDays')
                : t('ctaGenerate', { count: selected.length })}
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
