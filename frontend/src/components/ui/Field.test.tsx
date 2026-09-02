import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';
import { FormField } from './FormField';
import { Input } from './Input';
import { Checkbox } from './Checkbox';
import { Select } from './Select';

/**
 * Whether the hint and the error are actually attached to the control.
 *
 * axe cannot answer this. A hint rendered as a loose paragraph under an input is valid HTML and
 * passes every automated rule — it is simply never read out, because nothing tells the screen
 * reader the two are related. So the product looked accessible and, for anyone not using their
 * eyes, the guidance and the validation message both did not exist.
 *
 * These assert the association itself, which is the part that can silently come undone again.
 */
describe('Field', () => {
  it('reads the hint out with the control', () => {
    render(
      <Field label="Addresses" htmlFor="cidrs" hint="One per line, e.g. 203.0.113.0/24">
        <Input id="cidrs" />
      </Field>,
    );

    expect(screen.getByLabelText('Addresses')).toHaveAccessibleDescription(
      'One per line, e.g. 203.0.113.0/24',
    );
  });

  it('reads the error out with the control, and marks it invalid', () => {
    render(
      <Field label="Licence number" htmlFor="lic" error="That licence is already registered">
        <Input id="lic" />
      </Field>,
    );

    const input = screen.getByLabelText('Licence number');
    expect(input).toHaveAccessibleDescription('That licence is already registered');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('reads both when there is a hint and an error', () => {
    render(
      <Field label="Email" htmlFor="em" hint="We use this for reminders" error="Not a valid email">
        <Input id="em" />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'We use this for reminders Not a valid email',
    );
  });

  it('announces the error when it appears', () => {
    render(
      <Field label="Email" htmlFor="em" error="Not a valid email">
        <Input id="em" />
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid email');
  });

  it('leaves a description the control set for itself alone', () => {
    render(
      <Field label="Email" htmlFor="em" hint="A hint">
        <Input id="em" aria-describedby="somewhere-else" />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'somewhere-else');
  });

  it('describes controls that are not plain inputs', () => {
    render(
      <div>
        <Field label="Reminders" htmlFor="rem" hint="Two days before the deadline">
          <Checkbox id="rem" checked onChange={() => undefined} aria-label="Reminders" />
        </Field>
        <Field label="State" htmlFor="st" hint="Where the site is">
          <Select id="st" value="" onChange={() => undefined} options={[]} aria-label="State" />
        </Field>
      </div>,
    );

    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      'Two days before the deadline',
    );
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveAccessibleDescription(
      'Where the site is',
    );
  });
});

describe('FormField', () => {
  it('wires the control given as a render function', () => {
    render(
      <FormField htmlFor="em" label="Email" hint="For reminders" error="Not a valid email">
        {(field) => <Input {...field} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('For reminders Not a valid email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('wires a plain child too, so forgetting the render form costs only the id', () => {
    render(
      <FormField htmlFor="em" label="Email" error="Not a valid email">
        <Input id="em" />
      </FormField>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('Not a valid email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
