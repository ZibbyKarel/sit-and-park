import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { contract, ERROR_CODES } from '@sit-and-park/contract';
import type { ErrorCode } from '@sit-and-park/contract';
import { IntlProvider } from '@sit-and-park/i18n';
import cs from '../../../../messages/cs.json';
import { failureWithCode } from '../../../testing/contract-failure';
import { DESK_WRITE_MESSAGES, useDeskWriteError, type DeskWrite } from './admin-desks-errors';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="cs" messages={cs}>
      {children}
    </IntlProvider>
  );
}

function describeWith() {
  return renderHook(() => useDeskWriteError(), { wrapper }).result.current;
}

describe('useDeskWriteError', () => {
  it('says nothing when nothing failed', () => {
    expect(describeWith()('update', null)).toBeNull();
  });

  it('reads the same code differently per operation', async () => {
    const describe_ = describeWith();
    const conflict = await failureWithCode('CONFLICT');

    expect(describe_('update', conflict)).toBe('errUpdateConflict');
    expect(describe_('holder', conflict)).toBe('errHolderConflict');
    expect(describe_('bulkUpdate', conflict)).toBe('errBulkConflict');
    // Granting declares no CONFLICT: no cause to name, so the fallback.
    expect(describe_('grant', conflict)).toBe('errFallback');
  });

  it('falls back for a transport failure and never leaks its message', () => {
    const message = describeWith()('update', new Error('ECONNREFUSED'));

    expect(message).toBe('errFallback');
  });

  it('names only declared codes, with a real Czech sentence behind every key', () => {
    const declared = new Set<string>(ERROR_CODES);
    for (const { byCode } of Object.values(DESK_WRITE_MESSAGES)) {
      for (const [code, key] of Object.entries(byCode)) {
        expect(declared.has(code)).toBe(true);
        expect(cs.adminDesks[key as keyof typeof cs.adminDesks]).toBeTruthy();
      }
    }
  });

  it('covers every code each admin desk procedure declares', () => {
    const declaredOn = (procedure: unknown): ErrorCode[] =>
      Object.keys(
        (procedure as { '~orpc': { errorMap: Record<string, unknown> } })['~orpc'].errorMap
      ) as ErrorCode[];
    const expectations: [DeskWrite, ErrorCode[]][] = [
      ['update', declaredOn(contract.admin.desk.update)],
      ['bulkUpdate', declaredOn(contract.admin.desk.bulkUpdate)],
      ['holder', declaredOn(contract.admin.desk.setPermanentAssignee)],
      ['grant', declaredOn(contract.admin.desk.setGrant)],
    ];
    for (const [write, codes] of expectations) {
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        expect(DESK_WRITE_MESSAGES[write].byCode[code]).toBeDefined();
      }
    }
  });
});
