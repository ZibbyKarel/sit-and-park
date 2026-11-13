'use client';

import { TextField as ShoptetTextField } from '@shoptet/ui';
import type { ComponentProps, ForwardRefExoticComponent, RefAttributes } from 'react';

/**
 * `@shoptet/ui`'s `TextField`, typed with the ref it already forwards to its
 * `<input>` at runtime — react-hook-form's focus-on-error needs it.
 */
// ponytail: typing gap in @shoptet/ui 0.24.0-beta (declared as `React.FC`);
// delete this file once the library declares the forwardRef itself.
export const TextField = ShoptetTextField as ForwardRefExoticComponent<
  ComponentProps<typeof ShoptetTextField> & RefAttributes<HTMLInputElement>
>;
