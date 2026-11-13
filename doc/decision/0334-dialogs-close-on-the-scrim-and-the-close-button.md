# 0334 – Dialogs close on the scrim and the close button

**Date:** 2026-11-13 · **Status:** accepted · **Task:** TODO item 11 · **Partly supersedes:** `doc/decision/0150-*`

## Context

The bulk modals (parking and desks), the schedule preview and the settings dialog passed `canBeDismissed={false}` to the `@shoptet/ui` `Modal` and re-added Escape with a `useEscapeToClose` hook. The prop gates Escape, the scrim click and the × together, so these dialogs had no × and ignored an outside click. The intent was to protect unsaved input from a stray click.

## Decision

- Every dialog is dismissible: Escape, a scrim click and the × all call `onClose`. The `ui/use-escape-to-close` hook is deleted; `canBeDismissed` is the only mechanism.
- A dialog stays non-dismissible only while closing would be wrong right now, the rule `ConfirmDialog` already follows (`canBeDismissed={!loading}`):
  - bulk modals and the schedule preview: `canBeDismissed={!confirmBulk.isPending}`, since closing mid-confirm would hide the result;
  - settings: `canBeDismissed={!confirmOpen}`, because the nested regenerate `ConfirmDialog` owns Escape and the scrim while open, so one Escape closes only it.
- Protecting unsaved input by non-dismissal is dropped, by product decision.

## What this changes in 0150

0150's "no ×, and the scrim does not close the settings dialog" no longer holds.

## If wrong

If losing a picked selection to a stray click proves costly, confirm on close for the bulk modals rather than going back to non-dismissal.
