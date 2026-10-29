/**
 * The whole point of `libs/shared/form` is that a real, validated, submittable form
 * can be built from `@garage/form` plus plain elements without ever importing
 * `react-hook-form` directly (`doc/wrappers.md`). This file's own import list —
 * `@garage/form` and `zod`, nothing else — *is* that proof, and the last test
 * below reads this file's own source back off disk to make the claim
 * self-checking rather than something a reviewer has to take on faith.
 *
 * Native `<input>`/`<select>` on purpose: the lib is UI-library-agnostic, so
 * its spec depends on no component library either.
 */
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import * as z from 'zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, FormProvider, useAppForm } from '@garage/form';

const demoSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.email('Enter a valid email'),
  role: z.enum(['driver', 'admin']),
  acceptsTerms: z.boolean().refine((value) => value === true, {
    message: 'You must accept the terms',
  }),
});

type DemoValues = z.infer<typeof demoSchema>;

/** A label, a control and the field's resolved error as an announced message. */
function Row({
  label,
  error,
  children,
}: {
  readonly label: string;
  readonly error: string | undefined;
  readonly children: (props: { 'aria-invalid': boolean }) => ReactNode;
}) {
  return (
    <label>
      {label}
      {children({ 'aria-invalid': error !== undefined })}
      {error === undefined ? null : <span role="alert">{error}</span>}
    </label>
  );
}

/**
 * A complete form: text input, select, checkbox, all validated by one Zod
 * schema and rendered as native elements. Each `FormField` hands the control
 * plain `value`/`onChange`/`onBlur`/`name`/`ref` props and a resolved `error`
 * string.
 */
function DemoForm({ onValid }: { readonly onValid: (values: DemoValues) => void }) {
  const form = useAppForm({
    schema: demoSchema,
    defaultValues: { name: '', email: '', role: 'driver', acceptsTerms: false },
  });

  return (
    <FormProvider {...form}>
      {/* `handleSubmit` returns a promise; React ignores a handler's return
          value, so `void` says the detachment is deliberate. */}
      <form onSubmit={(event) => void form.handleSubmit(onValid)(event)}>
        <FormField
          name="name"
          render={({ field, error }) => (
            <Row label="Name" error={error}>
              {(aria) => <input {...aria} {...field} />}
            </Row>
          )}
        />
        <FormField
          name="email"
          render={({ field, error }) => (
            <Row label="Email" error={error}>
              {(aria) => <input {...aria} {...field} />}
            </Row>
          )}
        />
        <FormField
          name="role"
          render={({ field, error }) => (
            <Row label="Role" error={error}>
              {(aria) => (
                <select {...aria} {...field}>
                  <option value="driver">Driver</option>
                  <option value="admin">Admin</option>
                </select>
              )}
            </Row>
          )}
        />
        <FormField
          name="acceptsTerms"
          render={({ field, error }) => (
            <Row label="I accept the terms" error={error}>
              {(aria) => (
                <input
                  {...aria}
                  type="checkbox"
                  name={field.name}
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            </Row>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

describe('a form built only from @garage/form + native elements', () => {
  it('reflects Zod validation errors into each control error state, observably', async () => {
    const user = userEvent.setup();
    render(<DemoForm onValid={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const nameField = screen.getByRole('textbox', { name: /^Name/ });
    const emailField = screen.getByRole('textbox', { name: /^Email/ });
    const termsField = screen.getByRole('checkbox', { name: /I accept the terms/ });

    // What a screen reader/user actually observes: an announced message
    // (`role="alert"`) plus `aria-invalid`, not merely an errors object.
    const alerts = await screen.findAllByRole('alert');
    const alertText = alerts.map((alert) => alert.textContent);
    expect(alertText).toEqual(
      expect.arrayContaining([
        'Name is required',
        'Enter a valid email',
        'You must accept the terms',
      ])
    );
    expect(nameField).toHaveAttribute('aria-invalid', 'true');
    expect(emailField).toHaveAttribute('aria-invalid', 'true');
    expect(termsField).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits the Zod-parsed values once every field is valid', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    render(<DemoForm onValid={onValid} />);

    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Jana Nováková');
    await user.type(screen.getByRole('textbox', { name: /^Email/ }), 'jana@example.com');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Role/ }), 'admin');
    await user.click(screen.getByRole('checkbox', { name: /I accept the terms/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid).toHaveBeenCalledWith(
      {
        name: 'Jana Nováková',
        email: 'jana@example.com',
        role: 'admin',
        acceptsTerms: true,
      },
      expect.anything()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never imports react-hook-form directly in this file', () => {
    // A demonstration that the wrapper's API is *sufficient* for the whole form
    // above — **not** the defence against the ban being broken. This file is
    // inside the lib that owns `react-hook-form`, where the import is legal and
    // ESLint would not object to it. The ban is `no-restricted-imports` in
    // `eslint.config.mjs` (`WRAPPED_LIBRARIES`), verified separately by linting
    // `apps/**`; delete that rule and this test still passes.
    const source = readFileSync(__filename, 'utf-8');
    expect(source).not.toMatch(/from ['"]react-hook-form['"]/);
    expect(source).not.toMatch(/require\(['"]react-hook-form['"]\)/);
  });
});
