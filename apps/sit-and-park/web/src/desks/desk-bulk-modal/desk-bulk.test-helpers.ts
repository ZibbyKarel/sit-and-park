import type { DeskBulkPreviewOutput } from '@sit-and-park/contract';

export const D1 = { id: 'desk-1', code: 'D-001', zoneName: 'Zóna A' };
export const D2 = { id: 'desk-2', code: 'D-002', zoneName: 'Zóna A' };
export const D3 = { id: 'desk-3', code: 'D-003', zoneName: 'Zóna B' };

/**
 * Two people, two days (Mon 16 and Tue 17 Nov 2026): Karel has a preferred
 * desk on Monday and none free on Tuesday; Jana is bookable Monday only.
 */
export function preview(overrides: Partial<DeskBulkPreviewOutput> = {}): DeskBulkPreviewOutput {
  return {
    month: '2026-11',
    people: [
      { id: 'user-viewer', name: 'Karel Zíbar', officeId: 'office-1', preferredDeskId: D1.id },
      { id: 'user-jana', name: 'Jana Nováková', officeId: 'office-1', preferredDeskId: null },
    ],
    rows: [
      {
        outcome: 'ASSIGNED',
        userId: 'user-viewer',
        date: '2026-11-16',
        deskId: D1.id,
        deskCode: D1.code,
        zoneName: D1.zoneName,
        isPreferred: true,
      },
      { outcome: 'UNASSIGNED', userId: 'user-viewer', date: '2026-11-17' },
      { outcome: 'UNASSIGNED', userId: 'user-jana', date: '2026-11-16' },
      {
        outcome: 'UNAVAILABLE',
        userId: 'user-jana',
        date: '2026-11-17',
        reason: 'PERMANENT_DESK_HOLDER',
      },
    ],
    freeDesks: [
      { officeId: 'office-1', date: '2026-11-16', desks: [D1, D2, D3] },
      { officeId: 'office-1', date: '2026-11-17', desks: [D2, D3] },
    ],
    ...overrides,
  };
}
