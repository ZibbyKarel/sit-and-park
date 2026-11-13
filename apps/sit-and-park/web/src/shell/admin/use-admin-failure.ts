'use client';

/**
 * The failure of the last admin write on a screen, as a Czech sentence.
 *
 * Used by the hive, office and sync screens, which have one failure at a time
 * and print it inside the dialog that started the write. `run` records which
 * write failed (the same code means different things per operation, see
 * `./admin-errors.ts`) and resolves `false` instead of throwing, so a caller
 * only decides whether to close its dialog.
 */

import { useState } from 'react';
import { useAdminWriteError, type AdminWrite, type AdminWriteFailure } from './admin-errors';

export function useAdminFailure() {
  const describe = useAdminWriteError();
  const [failure, setFailure] = useState<AdminWriteFailure | null>(null);

  return {
    message: failure === null ? null : describe(failure.from, failure.error),
    clear: () => setFailure(null),
    run: async (from: AdminWrite, write: Promise<unknown>): Promise<boolean> => {
      setFailure(null);
      try {
        await write;
        return true;
      } catch (error) {
        setFailure({ error, from });
        return false;
      }
    },
  };
}
