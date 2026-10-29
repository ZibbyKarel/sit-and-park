'use client';

/**
 * The dialog behind a parking bay: reserve, queue, cancel, or an explanation.
 *
 * Presentational — every decision is on {@link SpotDialogProps}, and the four
 * actions are callbacks. The design draws this as four variants of one modal
 * (`08-modal-reserve.png`, `09-modal-queue.png`), keyed off `modalTitle`,
 * `modalSub`, `modalCta`, `modalCancel`, `modalPrimaryShow` and `modalLocked`;
 * so does this.
 *
 * **Two places where the design draws something the contract will not let it,
 * and the contract wins** (`plan.md`: contract-first; `doc/decision/0004-*`
 * gives the design the casting vote on *visuals*, not on what may cross the
 * wire):
 *
 * 1. **A name/SPZ form, but only for an admin.** The design's reserve modal has
 *    "Jméno" and "SPZ" inputs bound to `resName`/`resPlate`. For a normal user
 *    the contract still has nowhere to put them — the holder *is* the caller and
 *    the plate is read off their profile, which they edit in Nastavení — so
 *    their modal remains a confirmation. For an **admin**,
 *    `createReservationInputSchema.holder` now exists (TODO item 3,
 *    `doc/decision/0304-*`), so the two fields are real: a holder selector over
 *    the active users plus a guest option, and an overridable plate. The form is
 *    `libs/shared/form`; the holder defaults to the admin themselves, so the dialog is
 *    still one click for the common case.
 * 2. **No list of who is queued.** The design lists the queue by name. The
 *    contract exposes `waitlistCount` plus **the caller's own** position and
 *    deliberately nothing else: `waitlistUpdatedEventSchema` states that "who
 *    is queued for a spot is not public". Listing the names would need a
 *    procedure that does not exist and should not. The count and the caller's
 *    own position are shown instead.
 */

import { useEffect } from 'react';
import { Avatar, Button, Modal, Spacer, SystemMessage, Tag } from '@shoptet/ui';
import { useDateFormatters, useTranslations } from '@garage/i18n';
import type { DateOnly } from '@garage/i18n';
import { FormProvider, useAppForm } from '@garage/form';
import type { ReservationHolderInput } from '@garage/contract';
import { toContractError } from '@garage/api-client';
import { useNotify } from '../../shell/notifications/toast-provider';
import { formatTimeRange } from '../lot-view';
import type { SpotView } from '../lot-view';
import { HolderFields } from './holder-fields';
import { GUEST_HOLDER_VALUE, holderFormSchema, toReservationRequest } from './holder-input';
import type { HolderFormValues, HolderOption } from './holder-input';
import styles from './spot-dialog.module.css';
import { QueueTargetFields } from './queue-target-fields';
import { defaultQueueTargetId, queueTargetFormSchema } from './queue-target-input';
import type { QueueTargetFormValues } from './queue-target-input';

export interface SpotDialogProps {
  /** `null` closes the dialog. */
  readonly spot: SpotView | null;
  readonly date: DateOnly;
  /**
   * From `overview.day`. Gates the two *write* actions the reservation window
   * blocks — creating a reservation and joining a queue, which declare the
   * same two window error codes. It does **not** gate cancelling: the contract
   * gives `reservation.cancel` no window errors at all, because "a locked
   * window stops people from taking spots, not from giving them back".
   */
  readonly canReserve: boolean;
  readonly isAdmin: boolean;
  /** The month name, for the yellow "locked" note. */
  readonly monthName: string;
  /** Whatever the last action threw, or `null`. Rendered by code, never by message. */
  readonly error: unknown;
  /**
   * Overrides {@link error}'s code-mapped copy — the one case is `onReserve`
   * naming a holder other than the viewer and getting back
   * `RESERVATION_LIMIT_REACHED`, where the code-mapped sentence ("you already
   * have a reservation") is false for the caller. The caller (`LotScreen`)
   * resolves this, because only it knows who a given submission named;
   * `undefined` for every other failure, including a self-booking create with
   * the same code, so those keep the plain catalogue string.
   */
  readonly errorMessage?: string;
  readonly pending: boolean;
  /**
   * The signed-in user's id, or `null` while `me.get` is in flight. The admin's
   * holder selector defaults to it — see `onReserve`.
   */
  readonly viewerUserId: string | null;
  /**
   * The users an admin may book for. Empty for a normal user, and empty for an
   * admin whose user list has not arrived — in both cases the holder form is not
   * rendered and `onReserve` is called with no argument.
   */
  readonly holderOptions: readonly HolderOption[];
  /**
   * `true` while an admin's `admin.user.list` is still in flight, `false` for
   * a normal user always. The holder form (and its selector) is not on screen
   * yet in that state — see {@link holderOptions} — so this disables the
   * reserve button rather than let one click silently book the bay for the
   * admin themselves before the selector has had a chance to appear.
   */
  readonly holderPending: boolean;
  /**
   * The users an admin may add to this spot's queue on this day — already
   * excludes anyone who holds a reservation that day or is already in this
   * queue (`libs/garage/contract/src/api/users.ts`'s `excludingReservedOrQueuedFor`).
   * Distinct from {@link holderOptions}: naming a reservation holder and
   * naming a queue target are refused for different reasons, so the two lists
   * are fetched, and can be empty, independently.
   */
  readonly queueTargetOptions: readonly HolderOption[];
  /** Same shape as {@link holderPending}, for {@link queueTargetOptions}. */
  readonly queueTargetPending: boolean;
  readonly onClose: () => void;
  /**
   * Reserve the bay. **No argument means "for the caller"** — the contract's
   * `holder` is optional precisely so a normal user's request is byte-for-byte
   * what it has always been.
   *
   * Called with a holder only from the admin form, and it defaults to the admin
   * themselves: `apps/garage/web-e2e/src/support/lot-page.ts:122-125` opens this dialog
   * and clicks "Rezervovat" once, as an admin, so a form that required a
   * selection first would never submit and the journey would hang on a dialog
   * that never hides.
   */
  readonly onReserve: (holder?: ReservationHolderInput) => void;
  /**
   * Join the queue. **No argument means "for the caller"**, exactly like
   * `onReserve` — see its doc comment. Called with a `userId` only from the
   * admin's queue-target selector, which defaults to the admin themselves for
   * the same one-click reason `onReserve`'s does.
   */
  readonly onJoinWaitlist: (holderId?: string) => void;
  readonly onLeaveWaitlist: () => void;
  readonly onCancelReservation: () => void;
  /**
   * Book one guest half-hour block — only reachable from the guest holder
   * form's `duration: 'TIMED'` branch, or from a `'timed'` spot's dialog
   * (`timedOnly`, where the holder is a fixed guest).
   */
  readonly onReserveTimed: (block: {
    guestName: string;
    licensePlate: string | null;
    startTime: string;
    endTime: string;
  }) => void;
  /** Remove one guest block from a `'timed'` spot's list. */
  readonly onCancelTimedReservation: (timedReservationId: string) => void;
}

/**
 * The holder form's defaults, given the two things they depend on: whether
 * the caller can even choose a holder (`viewerUserId`), and whether this is a
 * `'timed'` spot's dialog, where the holder is a fixed guest and the
 * duration a fixed block (`HolderFields`' `timedOnly`).
 */
function defaultHolderFormValues(
  isTimedSpot: boolean,
  viewerUserId: string | null
): HolderFormValues {
  return {
    holderId: isTimedSpot ? GUEST_HOLDER_VALUE : (viewerUserId ?? ''),
    guestName: '',
    licensePlate: '',
    duration: isTimedSpot ? 'TIMED' : 'FULL_DAY',
    startTime: '08:00',
    endTime: '09:00',
  };
}

export function SpotDialog({
  spot,
  date,
  canReserve,
  isAdmin,
  monthName,
  error,
  errorMessage,
  pending,
  viewerUserId,
  holderOptions,
  holderPending,
  queueTargetOptions,
  queueTargetPending,
  onClose,
  onReserve,
  onJoinWaitlist,
  onLeaveWaitlist,
  onCancelReservation,
  onReserveTimed,
  onCancelTimedReservation,
}: SpotDialogProps) {
  const t = useTranslations('lot');
  const tShell = useTranslations('shell');
  const errors = useTranslations('errors');
  const f = useDateFormatters();

  // A `'timed'` spot's holder is a fixed guest (Task 7's `HolderFields`
  // `timedOnly`), so the holder form is offered without needing the admin's
  // user list to have arrived — unlike a free bay's full holder selector,
  // which does need it (`holderOptions.length > 0`).
  const isTimedSpot = spot?.appearance === 'timed';
  const showHolderForm =
    isAdmin &&
    viewerUserId !== null &&
    spot?.action === 'reserve' &&
    (isTimedSpot || holderOptions.length > 0);

  const form = useAppForm<HolderFormValues>({
    schema: holderFormSchema,
    defaultValues: defaultHolderFormValues(isTimedSpot, viewerUserId),
  });
  const holderId = form.watch('holderId');
  const duration = form.watch('duration');
  const submitHolder = form.handleSubmit((values) => {
    const request = toReservationRequest(values);
    if (request.kind === 'TIMED') {
      const { kind: _kind, ...block } = request;
      onReserveTimed(block);
    } else {
      onReserve(request.holder);
    }
  });

  const showQueueTargetForm =
    isAdmin &&
    queueTargetOptions.length > 0 &&
    viewerUserId !== null &&
    spot?.action === 'queue' &&
    spot.viewerWaitlistEntryId === null;

  const queueForm = useAppForm<QueueTargetFormValues>({
    schema: queueTargetFormSchema,
    defaultValues: { userId: defaultQueueTargetId(viewerUserId, queueTargetOptions) },
  });
  const submitQueueTarget = queueForm.handleSubmit((values) => onJoinWaitlist(values.userId));

  // `defaultValues` are captured once, at mount — and this component mounts with
  // the screen, before `me.get` has necessarily resolved, so `viewerUserId` can
  // still be `null` then. React Hook Form never re-applies `defaultValues`, so
  // without this the admin's holder would stay `''` and `holderId:
  // z.string().min(1)` would refuse the submit — and since that rule carries no
  // message, the refusal is *silent*: the Rezervovat button simply does nothing.
  //
  // This is defensive rather than load-bearing, and it is worth being precise
  // about which: `lot-screen.tsx:218-219` renders `<ScreenLoading />` while
  // `dayQuery.isPending`, so this component does not mount until the day has
  // resolved, and on the mount that follows, no bay is open yet — the guard
  // below returns. The window the reset actually changes is narrower: a bay
  // opened while `me.get` is *still* in flight, with the profile resolving
  // while that same dialog stays open.
  //
  // Resetting on *open* is the right behaviour in its own right: a guest name
  // typed for one bay must not survive into the next bay's dialog.
  const openSpotId = spot?.spotId ?? null;
  useEffect(() => {
    if (openSpotId === null) return;
    form.reset(defaultHolderFormValues(isTimedSpot, viewerUserId));
    queueForm.reset({ userId: defaultQueueTargetId(viewerUserId, queueTargetOptions) });
    // `form`/`queueForm` are stable across renders; `.reset` is the documented
    // way to re-seed, and listing them keeps the exhaustive-deps rule satisfied.
    // `queueTargetOptions` is a dependency too, not just `viewerUserId`: the
    // default now depends on whether the viewer is even IN the (filtered)
    // list, and that list can arrive — or change, as the admin opens a
    // different spot — after this effect has already run once. `isTimedSpot`
    // is a dependency for the same reason: it can change from one open bay to
    // the next and `defaultHolderFormValues` reads it too.
  }, [openSpotId, viewerUserId, isTimedSpot, queueTargetOptions, form, queueForm]);

  // Same rule `ScreenError` documents: keyed off the contract error's
  // **code**, never its message — a contract message is developer-facing
  // English and a transport failure's is stack-adjacent.
  // `errorMessage` overrides it — see `SpotDialogProps.errorMessage`'s doc
  // comment for the one caller (a named-holder `RESERVATION_LIMIT_REACHED`).
  const contractError = toContractError(error);
  const failureMessage =
    error === null || error === undefined
      ? null
      : (errorMessage ??
        (contractError === null ? tShell('errorUnknown') : errors(contractError.code)));
  useNotify(failureMessage, 'danger');

  if (spot === null) return null;

  const isTaken = spot.appearance === 'taken';
  const isInfo = spot.action === 'info';
  const isQueued = spot.viewerWaitlistEntryId !== null;

  // `modalCancel` in the design: the holder or an admin may cancel. Never
  // gated on the window — see `canReserve` on the props.
  const showCancel = isTaken && (isAdmin || spot.isMine);
  // `modalPrimaryShow`. Reserving and queueing are both writes the window
  // blocks, and both are absent rather than disabled when it does.
  const showPrimary = canReserve && !spot.isMine && !isInfo;

  // `isQueued` is tested **before** `isAdmin`, in both the title and the
  // description, because it is the more specific true statement about the
  // caller and it is the one the footer button already acts on. The design's
  // state machine has no such branch — its prototype had no waitlist
  // membership, so it only ever offered "join" — and a browser run against the
  // real API showed the consequence: a modal headed "Přidat se do fronty" above
  // a button reading "Odejít z fronty". An admin who is queued sees the queue
  // copy too; their cancel button is governed by `showCancel` and is unaffected.
  const title = isInfo
    ? spot.infoReason === 'already-reserved'
      ? t('titleInfoAlreadyReserved')
      : t('titleInfo')
    : spot.isMine
      ? t('titleMine')
      : isTaken
        ? isQueued
          ? t('titleQueued')
          : isAdmin
            ? t('titleEdit')
            : t('titleQueue')
        : t('titleReserve');

  const description = isInfo
    ? spot.infoReason === 'already-reserved'
      ? t('subInfoAlreadyReserved')
      : spot.infoReason === 'timed'
        ? t('infoTimedBlocks')
        : t('subInfo')
    : spot.isMine
      ? canReserve
        ? t('subMine')
        : t('subMineLocked')
      : isTaken
        ? isQueued
          ? t('subQueued')
          : isAdmin
            ? t('subAdmin')
            : canReserve
              ? t('subQueue')
              : t('subTaken')
        : t('subReserve', { date: f.dayAndMonth(date) });

  return (
    <Modal
      isOpen
      onClose={onClose}
      // The design's modal has no × in the corner — its only close control is
      // the footer button. Escape, the scrim and the × all dismiss; none of
      // them guards unsaved input, which is a trade-off the design's own
      // modals make everywhere else.
    >
      <Modal.Header subheader={description}>{title}</Modal.Header>
      <Modal.Content>
        <p className={styles.eyebrow}>{t('modalEyebrow', { label: spot.label })}</p>

        {showHolderForm ? (
          <FormProvider {...form}>
            <HolderFields
              options={holderOptions}
              holderId={holderId}
              duration={duration}
              timedOnly={isTimedSpot}
            />
          </FormProvider>
        ) : null}

        {spot.timedBlocks.length > 0 ? (
          // Guest blocks already on this spot — a `'timed'` appearance never
          // co-occurs with `isTaken` (`toSpotView`'s precedence), so this and
          // the taken-holder panel below are mutually exclusive in practice.
          <section className={styles.section}>
            <h3 className={styles.heading}>{t('timedBlocksHeading')}</h3>
            <ul className={styles.blocks}>
              {spot.timedBlocks.map((block) => (
                <li key={block.id} className={styles.block}>
                  <strong>{formatTimeRange(block)}</strong>
                  <span>{block.guestName}</span>
                  {block.licensePlate === null ? null : (
                    <span className={styles.muted}>{block.licensePlate}</span>
                  )}
                  {isAdmin ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={pending}
                      onClick={() => onCancelTimedReservation(block.id)}
                    >
                      {t('timedBlockCancel')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isTaken && spot.holderName !== null ? (
          <section className={styles.section}>
            <div className={styles.holder}>
              <Avatar
                name={spot.holderName}
                {...(spot.holderPlate === null
                  ? {}
                  : { description: t('occupiedBy', { plate: spot.holderPlate }) })}
              />
              {spot.holderIsGuest ? <Tag size="sm">{t('guestHolder')}</Tag> : null}
            </div>

            {isAdmin || spot.waitlistCount > 0 ? (
              <>
                <h3 className={styles.heading}>{t('queueHeading')}</h3>
                <p className={styles.muted}>
                  {spot.waitlistCount === 0
                    ? t('queueEmpty')
                    : t('waiting', { count: spot.waitlistCount })}
                </p>
                {spot.viewerWaitlistPosition !== null ? (
                  <p className={styles.position}>
                    {t('queuePosition', { position: spot.viewerWaitlistPosition })}
                  </p>
                ) : null}
                {showQueueTargetForm ? (
                  <FormProvider {...queueForm}>
                    <QueueTargetFields options={queueTargetOptions} />
                  </FormProvider>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {!canReserve && !isInfo ? (
          <div className={styles.section}>
            <SystemMessage level="alert" description={t('lockNote', { month: monthName })} />
          </div>
        ) : null}
      </Modal.Content>
      <Modal.Footer>
        {({ primaryButtonProps, secondaryButtonProps }) => (
          <>
            {showCancel ? (
              <>
                <Button
                  {...primaryButtonProps}
                  variant="destructive"
                  isLoading={pending}
                  onClick={onCancelReservation}
                >
                  {t('cancelReservation')}
                </Button>
                {/* Pushes the cancel button to the left edge while the rest stay on the right. */}
                <Spacer grow />
              </>
            ) : null}
            <Button {...secondaryButtonProps} onClick={onClose}>
              {t('close')}
            </Button>
            {showPrimary ? (
              isTaken ? (
                isQueued ? (
                  <Button {...secondaryButtonProps} isLoading={pending} onClick={onLeaveWaitlist}>
                    {t('leaveQueue')}
                  </Button>
                ) : (
                  <Button
                    {...primaryButtonProps}
                    isLoading={pending}
                    disabled={queueTargetPending}
                    onClick={showQueueTargetForm ? submitQueueTarget : () => onJoinWaitlist()}
                  >
                    {t('ctaQueue')}
                  </Button>
                )
              ) : (
                <Button
                  {...primaryButtonProps}
                  isLoading={pending}
                  disabled={holderPending}
                  onClick={showHolderForm ? submitHolder : () => onReserve()}
                >
                  {t('ctaReserve')}
                </Button>
              )
            ) : null}
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}
