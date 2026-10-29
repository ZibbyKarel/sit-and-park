'use client';

import { Tag } from '@shoptet/ui';
import { BoltIcon, EyeOffIcon } from '../../ui/icons/icons';
import { useTranslations } from '@garage/i18n';
import { formatTimeRange, type SpotView } from '../lot-view';
import { CarGlyph } from './car-glyph';
import styles from './spot-tile.module.css';

export interface SpotTileProps {
  readonly spot: SpotView;
  /** Opening the spot's modal. Not called for an `editing` tile. */
  readonly onOpen: (spotId: string) => void;
  /**
   * The `⋯` button, admins only, on a taken spot. It opens the **same**
   * dialog `onOpen` does, deliberately: the contract exposes no procedure to
   * edit somebody else's reservation (only create-for-self and cancel), so
   * there is no second surface to route to. `SpotDialog` already renders the
   * admin-flavoured copy (`titleEdit`/`subAdmin`) and the cancel button off
   * `isAdmin` alone, regardless of which button opened it. What `⋯` adds is
   * discoverability that matches the design's own affordance
   * (`01-lot-admin.png`) — not a different modal. See `doc/decision/0125-*`.
   */
  readonly onAdminOpen: (spotId: string) => void;
}

/**
 * One parking bay.
 *
 * A **real `<button>`**, not a clickable `<div>`: Enter and Space, the focus
 * ring and the disabled state all come from the platform that way. An
 * `editing` tile is genuinely `disabled` rather than merely ignoring clicks,
 * which is also what keeps it out of the tab order — the design's `if
 * (locked) return;` is a pointer-only version of the same rule.
 *
 * The `⋯` button is a sibling button rather than a nested one: a button
 * inside a button is invalid HTML and browsers recover from it
 * unpredictably. It is not a menu — see {@link SpotTileProps.onAdminOpen}.
 */
export function SpotTile({ spot, onOpen, onAdminOpen }: SpotTileProps) {
  const t = useTranslations('lot');
  const inert = spot.action === 'none';

  /**
   * The bay's whole state, in its accessible name.
   *
   * `aria-label` **replaces** the button's contents as its accessible name,
   * and a screen reader treats a `<button>` as a single node — so everything
   * rendered inside it below ("Volné", the holder's name and plate,
   * "rezervace uzamčeny", "právě upravuje" and the editor) used to be
   * announced to nobody. A taken bay, a window-locked bay and a bay somebody
   * else is editing all read as "Otevřít místo E2.93", with no way to tell
   * them apart; the only state that survived was the waitlist `Badge`, which
   * happens to sit outside the button. See `doc/decision/0257-*`.
   *
   * Built from the **same keys the tile draws**, not from a second set written
   * for screen readers. Two catalogues saying nearly the same thing is how
   * they drift, and the visible text is already the true statement of the
   * state — an alternative wording could only ever be a worse copy of it.
   *
   * The waitlist pill is deliberately left out: it is a sibling of this
   * button, not a child, so it already has its own place in the reading order.
   */
  const stateWords: readonly (string | null)[] =
    spot.appearance === 'free'
      ? [t('free')]
      : spot.appearance === 'taken'
        ? [spot.holderName, spot.holderPlate]
        : spot.appearance === 'window-locked'
          ? [t('tileLocked')]
          : spot.appearance === 'timed'
            ? // `tileTimedLabel` builds the whole accessible name below rather
              // than joining onto the "Rezervovat/Otevřít místo" prefix — see
              // `accessibleName`.
              []
            : // "právě upravuje Jana Dvořáková" reads as one clause and is joined
              // with a space; the tile draws the same two strings on two lines.
              [
                spot.editorName === null
                  ? t('tileEditing')
                  : `${t('tileEditing')} ${spot.editorName}`,
              ];

  const accessibleName =
    spot.appearance === 'timed'
      ? t('tileTimedLabel', {
          label: spot.label,
          times: spot.timedBlocks.map((block) => formatTimeRange(block)).join(', '),
        })
      : [
          spot.appearance === 'free'
            ? t('reserveSpotAction', { label: spot.label })
            : t('openSpotAction', { label: spot.label }),
          ...stateWords,
        ]
          .filter((word): word is string => word !== null && word !== '')
          .join(', ');

  return (
    <div className="lot-bay">
      <button
        type="button"
        disabled={inert}
        onClick={() => {
          onOpen(spot.spotId);
        }}
        aria-label={accessibleName}
        className="lot-bay-button"
      >
        <span className="lot-bay-label">{spot.label}</span>

        {spot.appearance === 'free' ? (
          <span className="lot-bay-free">
            <span aria-hidden="true" className="lot-bay-glyph lot-bay-glyph--plus">
              +
            </span>
            <span className="lot-bay-caption">{t('free')}</span>
          </span>
        ) : null}

        {spot.appearance === 'timed' ? (
          // Same frame as `'free'`, with the blocks' time ranges in place of
          // "Volné" and no car glyph.
          <span className="lot-bay-free">
            {spot.timedBlocks.slice(0, 2).map((block) => (
              <span key={block.id} className="lot-bay-caption">
                {formatTimeRange(block)}
              </span>
            ))}
            {spot.timedBlocks.length > 2 ? (
              <span className="lot-bay-caption">
                {t('tileMoreBlocks', { count: spot.timedBlocks.length - 2 })}
              </span>
            ) : null}
          </span>
        ) : null}

        {spot.appearance === 'taken' && spot.carColorClass !== null ? (
          <span className="lot-bay-taken">
            <CarGlyph colorVar={spot.carColorClass} />
            <span className="lot-bay-name">{spot.holderName}</span>
            {spot.holderPlate === null ? null : (
              <span className="lot-bay-plate">{spot.holderPlate}</span>
            )}
          </span>
        ) : null}

        {spot.appearance === 'window-locked' ? (
          <span className="lot-bay-locked">
            <span aria-hidden="true" className="lot-bay-glyph">
              ⊘
            </span>
            <span className={`lot-bay-caption ${styles.padded}`}>{t('tileLocked')}</span>
          </span>
        ) : null}

        {spot.appearance === 'editing' ? (
          <span className="lot-hatch lot-bay-editing">
            <span aria-hidden="true" className="lot-bay-glyph lot-bay-glyph--editing">
              ✎
            </span>
            <span className={`lot-bay-caption ${styles.padded}`}>
              {t('tileEditing')}
              <br />
              <strong>{spot.editorName}</strong>
            </span>
          </span>
        ) : null}
      </button>

      {spot.evCharger ? (
        // A sibling of the bay's button, like the waitlist pill: the bolt has
        // its own accessible name and its own place in the reading order, so
        // the button's `accessibleName` above stays exactly what it was.
        <div className={`${styles.corner} ${styles.topLeft}`}>
          <BoltIcon label={t('evCharger')} />
        </div>
      ) : null}

      {spot.waitlistCount > 0 ? (
        <div className={`${styles.corner} ${styles.bottomCenter}`}>
          <Tag level="alert">{t('waiting', { count: spot.waitlistCount })}</Tag>
        </div>
      ) : null}

      {spot.hidden || spot.showAdminMenu ? (
        <div className={`${styles.corner} ${styles.topRight}`}>
          {spot.showAdminMenu ? (
            <button
              type="button"
              onClick={() => {
                onAdminOpen(spot.spotId);
              }}
              aria-label={t('spotMenu', { label: spot.label })}
              className="lot-spot-menu"
            >
              ⋯
            </button>
          ) : null}
          {spot.hidden ? <EyeOffIcon label={t('hiddenSpot')} /> : null}
        </div>
      ) : null}
    </div>
  );
}
