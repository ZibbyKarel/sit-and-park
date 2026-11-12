import type { AdminDesk } from '@garage/contract';
import { T0 } from '../../../testing/fixtures';

/** One desk of the admin list: free, active, no hive, in zone A of office 1. */
export function adminDesk(overrides: Partial<AdminDesk> = {}): AdminDesk {
  return {
    id: 'desk-1',
    officeId: 'office-1',
    zoneId: 'zone-a',
    code: 'D-001',
    active: true,
    hiveId: null,
    permanentAssigneeId: null,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    createdAt: T0,
    updatedAt: T0,
    status: 'FREE',
    reservedByName: null,
    permanentAssigneeName: null,
    hiveName: null,
    hiveColor: null,
    zoneName: 'Zóna A',
    officeName: 'Praha',
    ...overrides,
  };
}
