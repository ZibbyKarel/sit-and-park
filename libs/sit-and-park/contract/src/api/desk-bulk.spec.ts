import { UUID_A, UUID_B, UUID_C } from '../__fixtures__/fixtures';
import {
  deskBulkConfirmInputSchema,
  deskBulkPlanRowSchema,
  deskBulkPreviewInputSchema,
} from './desk-bulk';

describe('desk.previewBulk input', () => {
  it('accepts distinct days of one month, optional people and pool', () => {
    expect(deskBulkPreviewInputSchema.safeParse({ dates: ['2099-01-05'] }).success).toBe(true);
    expect(
      deskBulkPreviewInputSchema.safeParse({
        dates: ['2099-01-06', '2099-01-05'],
        userIds: [UUID_A, UUID_B],
        deskIds: [UUID_C],
      }).success
    ).toBe(true);
  });

  it.each([
    ['no day', { dates: [] }],
    ['a duplicate day', { dates: ['2099-01-05', '2099-01-05'] }],
    ['two months', { dates: ['2099-01-31', '2099-02-01'] }],
    ['a duplicate person', { dates: ['2099-01-05'], userIds: [UUID_A, UUID_A] }],
    ['an empty pool', { dates: ['2099-01-05'], deskIds: [] }],
  ])('rejects %s', (_, input) => {
    expect(deskBulkPreviewInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('desk.confirmBulk input', () => {
  const row = (userId: string, deskId: string, date = '2099-01-05') => ({ userId, deskId, date });

  it('accepts one desk per person and day', () => {
    expect(
      deskBulkConfirmInputSchema.safeParse({
        assignments: [row(UUID_A, UUID_C), row(UUID_B, UUID_A), row(UUID_A, UUID_C, '2099-01-06')],
      }).success
    ).toBe(true);
  });

  it.each([
    ['nothing', []],
    ['two desks for one person on a day', [row(UUID_A, UUID_B), row(UUID_A, UUID_C)]],
    ['one desk twice on a day', [row(UUID_A, UUID_C), row(UUID_B, UUID_C)]],
    ['two months', [row(UUID_A, UUID_C, '2099-01-31'), row(UUID_A, UUID_C, '2099-02-01')]],
  ])('rejects %s', (_, assignments) => {
    expect(deskBulkConfirmInputSchema.safeParse({ assignments }).success).toBe(false);
  });
});

describe('desk bulk plan row', () => {
  it('discriminates on outcome', () => {
    expect(
      deskBulkPlanRowSchema.safeParse({
        outcome: 'UNAVAILABLE',
        userId: UUID_A,
        date: '2099-01-05',
        reason: 'PERMANENT_DESK_HOLDER',
      }).success
    ).toBe(true);
    expect(
      deskBulkPlanRowSchema.safeParse({ outcome: 'UNASSIGNED', userId: UUID_A, date: 'x' }).success
    ).toBe(false);
  });
});
