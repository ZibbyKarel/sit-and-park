# 0318 – UI comes from @shoptet/ui and the in-house design system is deleted

**Date:** 2026-10-29 · **Status:** accepted · **Task:** repository owner's request ·
**Supersedes:** the in-house design system records listed under "Superseded records" below, and the Tailwind v4 and design-system-first choices in `plan.md`

## Context

Shoptet maintains a company-wide design system, published as `@shoptet/ui`
(React Aria based, Inter, its own spacing and colour tokens). This app carried a
second, private one: `libs/shared/design-system` (tokens, primitives, compounds,
Tailwind v4, Storybook, Neue Haas Grotesk fonts of unverified licence). Two
design systems in one company is the cost, and the in-house one was the one
that could not be shared with a second application anyway. On 2026-10-29 the
repository owner decided that the app moves to `@shoptet/ui`.

## What

- `libs/shared/design-system` is deleted entirely. No in-house design system lib remains; `libs/shared/*` is now `form`, `i18n` and `api-client`.
- Components come straight from `@shoptet/ui`, pinned exactly to `0.24.0-beta`. Feature code imports it directly; there is no wrapper lib for it.
- Tailwind is removed entirely (dependencies, PostCSS config, `@source` lines, theme import). Styling that `@shoptet/ui` props cannot express goes into colocated CSS Modules (`foo.module.css` next to `foo.tsx`), using `@shoptet/ui`'s custom properties.
- Storybook is removed (`build-storybook` leaves `npm run build`, `npm run affected` and CI).
- Components with no `@shoptet/ui` equivalent are thin compositions in `apps/garage/web/src/ui/`, one folder per component, built from `@shoptet/ui` parts plus CSS Modules, domain-free: toast, confirm-dialog, empty-state, data-table, toggle-tile, icon-circle, chip, icons, visually-hidden.
- Server components (`app/layout.tsx`, `app/not-found.tsx`, `app/(app)/layout.tsx`) never import `@shoptet/ui` directly.
- `@shoptet/ui/index.css` is imported once in `app/layout.tsx`; `LocalizationProvider` (`cs` to `cs-CZ`, `en` to `en-US`) and a `RouterProvider` backed by `next/navigation` live in `app/providers.tsx`.
- `Select` becomes `SingleSelectField`. The locale menu uses `Menu.Item` with a checkmark icon on the active locale (no `menuitemradio` exists).
- `libs/shared/form` stays UI-library-agnostic; its specs use native inputs. In the app, `field.value`, `field.onChange`, `field.onBlur` and `field.ref` are passed to `@shoptet/ui` inputs explicitly, error text goes to the field component's `error` prop.
- `DataTable` is a composition over `@shoptet/ui`'s `Table*` parts with a local `useMemo` sort (two-state toggle, same `sortValue`/`defaultSort` API), keeping `aria-sort`, `data-row-id` and a caption as accessible name. `@tanstack/react-table` is dropped from the project, and with it the `WRAPPED_LIBRARIES` entry for it.
- The numeric stepper is `CounterInput`; `@shoptet/ui`'s `Stepper` is a step indicator and is never used for that.
- The `className` ban of 0311 is removed; CSS Modules need `className={styles.x}`.
- ESLint: the `type:ui` tag, its npm allowlist and the form-spec exception are removed from the module-boundary constraints.

## Consequences

- **Visual change.** Inter replaces Neue Haas Grotesk, and the spacing scale is `@shoptet/ui`'s (xs 4, sm 8, md 12, lg 16, xl 24, xxl 48) instead of the open 4px ramp. The Claude Design export under `doc/design/` is historical.
- **Known gaps in `@shoptet/ui` 0.24.0-beta, worked around, not fixed:** components accept no `className`; `Modal` dismissal is all-or-nothing; `Menu` has no `menuitemradio`; `Tabs` has no tablist accessible name; `TextField`'s typings lack a `ref` although it forwards one at runtime; the package is a pinned beta, so an upgrade is a deliberate, reviewed step.
- Tailwind and Storybook are gone, together with `tailwindcss`, `@tailwindcss/*`, `storybook`, `@storybook/*`, `vite`, `ts-node` and `@tanstack/react-table` from the dependencies.
- `plan.md` is not edited. Its Tailwind v4 CSS-first tokens choice and its design-system-first rule are superseded by this record; the rule is now: UI comes from `@shoptet/ui`, and compositions it lacks live in `apps/garage/web/src/ui/`.
- Jest has to transform `@shoptet/ui` and the React Aria packages (they are ESM-only); `apps/garage/web/jest.config.cts` lists them.

## Superseded records

Each of these now carries a one-line pointer to this record. Fully superseded:
0002 (visual design source of truth), 0007 (ds tags), 0010, the two 0011s, 0012 (both), 0013 (Storybook), 0052 to 0056, 0070 to 0072, 0265 to 0271, 0299, 0301 and 0311. Partly superseded (the design system parts only): 0017, 0030, 0290 (the `@tanstack/react-table` row) and 0310 (the shared lib list).
