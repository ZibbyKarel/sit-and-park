'use client';

/**
 * The admin's one-field selector for who a bulk booking is for.
 *
 * Presentational, and deliberately **not** its own form: it renders inside
 * `BulkReservationModal`'s `FormProvider`, because the submit action lives in
 * the `Modal`'s footer, outside this subtree — the same shape as
 * `SpotDialog`'s `QueueTargetFields`.
 * */

import { SingleSelectField } from '@shoptet/ui';
import { FormField } from '@sit-and-park/form';
import { useTranslations } from '@sit-and-park/i18n';
import type { HolderOption } from '../spot-dialog/holder-input';
import type { BulkHolderFormValues } from './holder-input';
import styles from './bulk-modal.module.css';

export interface BulkHolderFieldsProps {
  readonly options: readonly HolderOption[];
}

export function BulkHolderFields({ options }: BulkHolderFieldsProps) {
  const t = useTranslations('bulk');

  return (
    <div className={styles.field}>
      <FormField<BulkHolderFormValues, 'userId'>
        name="userId"
        render={({ field, error: fieldError }) => (
          <SingleSelectField
            label={t('holderField')}
            error={fieldError}
            name={field.name}
            value={field.value}
            options={options.map((option) => ({ value: option.userId, label: option.name }))}
            getOptionValue={(option) => option.value}
            getOptionLabel={(option) => option.label}
            onChange={(value) => {
              field.onChange(value ?? '');
            }}
            ref={field.ref}
          />
        )}
      />
    </div>
  );
}
