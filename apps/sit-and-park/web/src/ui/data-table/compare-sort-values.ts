import type { DataTableSortValue } from './data-table';

/**
 * Orders two cell values. `null` sorts last ascending and, because the
 * direction is applied by negating this result, first descending.
 */
export function compareSortValues(a: DataTableSortValue, b: DataTableSortValue): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }

  return a < b ? -1 : 1;
}
