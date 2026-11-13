'use client';

/**
 * The admin's one-field selector for adding somebody else to a spot's queue.
 *
 * Presentational, and — like `HolderFields` — deliberately **not** its own
 * form: it renders inside `SpotDialog`'s `FormProvider`, because the submit
 * button lives in the `Modal`'s footer, outside this subtree.
 *
 * Narrower than `HolderFields` on purpose: a waitlist entry has no guest
 * branch and no plate override (`WaitlistEntry.userId` is non-nullable), so
 * this is the selector alone.
 * */

import { SingleSelectField } from '@shoptet/ui';
import { FormField } from '@sit-and-park/form';
import { useTranslations } from '@sit-and-park/i18n';
import type { HolderOption } from './holder-input';
import type { QueueTargetFormValues } from './queue-target-input';
import styles from './spot-dialog.module.css';

export interface QueueTargetFieldsProps {
  readonly options: readonly HolderOption[];
}

export function QueueTargetFields({ options }: QueueTargetFieldsProps) {
  const t = useTranslations('lot');

  return (
    <div className={styles.queueTarget}>
      <FormField<QueueTargetFormValues, 'userId'>
        name="userId"
        render={({ field, error: fieldError }) => (
          <SingleSelectField
            label={t('queueHolderField')}
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
