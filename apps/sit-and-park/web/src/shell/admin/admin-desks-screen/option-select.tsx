'use client';

import { SingleSelectField } from '../../../ui/client-select/client-select';

export interface Option {
  readonly value: string;
  readonly label: string;
}

export interface OptionSelectProps {
  readonly label: string;
  readonly options: readonly Option[];
  /** `null` = nothing chosen. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly disabled?: boolean;
}

/** `SingleSelectField` over `{ value, label }` options. */
export function OptionSelect({ label, options, value, onChange, disabled }: OptionSelectProps) {
  return (
    <SingleSelectField
      label={label}
      options={[...options]}
      getOptionValue={(option) => option.value}
      getOptionLabel={(option) => option.label}
      value={value}
      onChange={onChange}
      disabled={disabled ?? false}
    />
  );
}
