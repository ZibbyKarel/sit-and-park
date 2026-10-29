import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SingleSelectField } from '@shoptet/ui';

import { selectOption } from './select-option';

const OPTIONS = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gama' },
];

function Host({ onChange }: { readonly onChange: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>('a');

  return (
    <SingleSelectField
      label="Kategorie"
      options={OPTIONS}
      getOptionValue={(option) => option.value}
      getOptionLabel={(option) => option.label}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('selectOption', () => {
  it('opens the named combobox and picks the named option', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Host onChange={onChange} />);

    await selectOption(user, 'Kategorie', 'Gama');

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByLabelText('Kategorie')).toHaveTextContent('Gama');
  });
});
