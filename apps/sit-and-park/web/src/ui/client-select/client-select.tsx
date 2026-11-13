'use client';

/**
 * `SingleSelect` / `SingleSelectField` / `MultiSelect` / `DateField` that never render on the server.
 *
 * `@shoptet/ui` builds its `matchMedia` breakpoint queries when the module is
 * evaluated (`hooks/useScreenHasMinWidth.js`), so anything that pulls in a
 * component using them throws `window is not defined` during SSR and Next
 * falls back to client rendering. `"use client"` does not help — client
 * components are still rendered on the server — so the selects are loaded
 * with `ssr: false` instead. Drop this once the library defers the call.
 */

import dynamic from 'next/dynamic';
import type {
  MultiSelect as MultiSelectType,
  SingleSelect as SingleSelectType,
  SingleSelectField as SingleSelectFieldType,
  DateField as DateFieldType,
} from '@shoptet/ui';

export const SingleSelect = dynamic(() => import('@shoptet/ui').then((m) => m.SingleSelect), {
  ssr: false,
}) as unknown as typeof SingleSelectType;

export const SingleSelectField = dynamic(
  () => import('@shoptet/ui').then((m) => m.SingleSelectField),
  {
    ssr: false,
  }
) as unknown as typeof SingleSelectFieldType;

export const DateField = dynamic(() => import('@shoptet/ui').then((m) => m.DateField), {
  ssr: false,
}) as unknown as typeof DateFieldType;

export const MultiSelect = dynamic(() => import('@shoptet/ui').then((m) => m.MultiSelect), {
  ssr: false,
}) as unknown as typeof MultiSelectType;
