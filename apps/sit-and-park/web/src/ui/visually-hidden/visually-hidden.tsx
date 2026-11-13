'use client';

import { forwardRef, type HTMLAttributes, type Ref } from 'react';

import styles from './visually-hidden.module.css';

export type VisuallyHiddenAs = 'span' | 'div' | 'caption' | 'h1' | 'h2' | 'legend';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  /** Tag rendered. Defaults to `span`. */
  as?: VisuallyHiddenAs | undefined;
}

/** Content present for assistive technology and absent from the rendered page. */
export const VisuallyHidden = forwardRef<HTMLElement, VisuallyHiddenProps>(function VisuallyHidden(
  { as = 'span', children, ...rest },
  ref
) {
  const Component = as;

  // Polymorphic `as`: the ref type depends on the tag, which TypeScript cannot
  // express for a dynamic component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  const componentRef = ref as Ref<any>;

  return (
    <Component {...rest} ref={componentRef} className={styles.srOnly}>
      {children}
    </Component>
  );
});
