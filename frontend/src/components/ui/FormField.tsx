import type { ReactNode } from 'react';
import { Field, type FieldControlProps } from './Field';

/** The props a control receives: its id, plus the invalid state and description `Field` computes. */
export interface FormFieldControlProps extends FieldControlProps {
  id: string;
}

/**
 * RHF-aware form row (FRONTEND_STANDARDS §4). Renders label + control + error and owns
 * `aria-invalid` / `aria-describedby` so the control lights up red without hand-wiring.
 * Pass the control as a render function to receive the props to spread:
 *
 *   <FormField htmlFor="email" label="Email" error={errors.email?.message}>
 *     {(field) => <Input type="email" {...field} {...register('email')} />}
 *   </FormField>
 *
 * A plain child works too and is wired the same way — `Field` attaches the description to it —
 * so forgetting the render form costs the `id`, not the accessibility.
 */
export function FormField({
  htmlFor,
  label,
  error,
  hint,
  info,
  required,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  hint?: string;
  info?: string;
  required?: boolean;
  children: ReactNode | ((field: FormFieldControlProps) => ReactNode);
}) {
  return (
    <Field
      label={label}
      htmlFor={htmlFor}
      error={error}
      hint={hint}
      info={info}
      required={required}
    >
      {typeof children === 'function'
        ? (field: FieldControlProps) => children({ ...field, id: htmlFor })
        : children}
    </Field>
  );
}
