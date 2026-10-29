import type { ReactElement } from 'react';
import { useController } from 'react-hook-form';
import type { Control, ControllerRenderProps, FieldPath, FieldValues } from 'react-hook-form';

export interface FormFieldRenderArgs<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  /**
   * Carries `name`, `value`, `onChange`, `onBlur` and `ref`. Spread it onto a
   * native control, or pass the members to a component library's input
   * explicitly — `onChange` accepts either a DOM event or a raw value.
   */
  readonly field: ControllerRenderProps<TFieldValues, TName>;
  /**
   * This field's Zod issue message, or `undefined` while valid. Hand it to
   * whatever the control uses to show an error message.
   */
  readonly error: string | undefined;
}

export interface FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  /** Path into the form's values, typed against the schema passed to `useAppForm`. */
  readonly name: TName;
  /** Renders exactly one input control for this field. */
  readonly render: (args: FormFieldRenderArgs<TFieldValues, TName>) => ReactElement;
  /**
   * Only needed when rendering outside a `FormProvider` tree. Normally
   * omitted — `useController` reads the surrounding form context instead.
   */
  readonly control?: Control<TFieldValues> | undefined;
}

/**
 * Connects one field of an `useAppForm` form to one input control.
 *
 * Built on `useController` rather than `register`, specifically because
 * `useController` already resolves `formState.errors` down to *this* field's
 * message (`fieldState.error`) — `FormField` does not re-implement error-path
 * lookup, it just forwards what react-hook-form already computed. This is
 * also what keeps the controls themselves free of react-hook-form: they
 * only ever see plain props (`value`, `onChange`, `error`, ...), never a
 * `Control` or a registered ref API.
 */
export function FormField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(
  props: FormFieldProps<TFieldValues, TName>
): ReactElement {
  const { name, render, control } = props;
  const { field, fieldState } = useController<TFieldValues, TName>(
    control === undefined ? { name } : { name, control }
  );

  return render({ field, error: fieldState.error?.message });
}
