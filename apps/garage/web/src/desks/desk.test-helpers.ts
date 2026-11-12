import type { DeskDirectoryOutput, DirectoryDesk } from '@garage/contract';
import { T0 } from '../testing/fixtures';

/** One desk of the directory: free, directly bookable, no hive. */
export function directoryDesk(overrides: Partial<DirectoryDesk> = {}): DirectoryDesk {
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
    zoneName: 'Zóna A',
    hiveName: null,
    hiveColor: null,
    status: 'FREE',
    access: 'DIRECT',
    reservedByName: null,
    permanentAssigneeName: null,
    releasedOn: false,
    myReservationId: null,
    assignedToMe: false,
    grantedToMe: false,
    ...overrides,
  };
}

/** A directory of `desks` in the Prague office with its plan. */
export function directory(
  desks: DirectoryDesk[],
  overrides: Partial<DeskDirectoryOutput> = {}
): DeskDirectoryOutput {
  return {
    date: '2026-11-16',
    office: {
      id: 'office-1',
      name: 'Praha',
      floorPlan: 'praha',
      floorPlanWidth: 22473,
      floorPlanHeight: 5835,
    },
    zones: [{ id: 'zone-a', officeId: 'office-1', key: 'a', name: 'Zóna A' }],
    hives: [{ id: 'hive-1', name: 'Engineering', color: '#3366FF' }],
    desks,
    ...overrides,
  };
}
