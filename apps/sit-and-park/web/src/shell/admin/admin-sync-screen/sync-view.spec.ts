import { EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT } from '@sit-and-park/i18n';
import { isCapped, reasonDetailOf, reasonKeyOf } from './sync-view';

describe('reasonKeyOf', () => {
  it('maps the machine code a reason opens with', () => {
    expect(reasonKeyOf('LIST_SHRANK: 10 of 100 rows')).toBe('reasonListShrank');
    expect(reasonKeyOf('EMPTY_LIST: no rows')).toBe('reasonEmptyList');
  });

  it('answers null for a code it does not know', () => {
    expect(reasonKeyOf('SOMETHING_NEW: x')).toBeNull();
  });
});

describe('reasonDetailOf', () => {
  it('drops the code, keeps the English detail', () => {
    expect(reasonDetailOf('LIST_SHRANK: 10 of 100 rows')).toBe('10 of 100 rows');
    expect(reasonDetailOf('SOMETHING_NEW: x')).toBe('SOMETHING_NEW: x');
  });
});

describe('isCapped', () => {
  it('is true only at the cap', () => {
    expect(isCapped(new Array(EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT - 1))).toBe(false);
    expect(isCapped(new Array(EMPLOYEE_SYNC_SUMMARY_LIST_LIMIT))).toBe(true);
  });
});
