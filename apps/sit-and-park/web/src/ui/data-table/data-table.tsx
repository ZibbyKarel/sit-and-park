'use client';

import {
  Paragraph,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@shoptet/ui';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { EmptyState } from '../empty-state/empty-state';
import { VisuallyHidden } from '../visually-hidden/visually-hidden';

import { compareSortValues } from './compare-sort-values';
import styles from './data-table.module.css';

/**
 * What a column may be sorted by: the types `<` and `>` order meaningfully. A
 * column that needs anything else (a status ranking, say) maps it to a number
 * itself, which keeps the ordering rule in the caller's code.
 */
export type DataTableSortValue = string | number | boolean | null;

export type DataTableAlign = 'start' | 'end';

export interface DataTableColumn<TData> {
  /** Stable identity of the column. Also the key `sort` refers to. */
  id: string;
  /** Column heading. Rendered uppercase by the header's own styling. */
  header: ReactNode;
  /** Renders one body cell. */
  cell: (row: TData) => ReactNode;
  /**
   * Value this column sorts by. Omit it and the column cannot be sorted —
   * there is no separate `sortable` flag to disagree with it.
   */
  sortValue?: ((row: TData) => DataTableSortValue) | undefined;
  /** Horizontal alignment of the header and every cell. Defaults to `start`. */
  align?: DataTableAlign | undefined;
  /** Any CSS width, applied through `<colgroup>`. E.g. `'96px'`, `'30%'`. */
  width?: string | undefined;
}

/** Which column the table is ordered by, and which way. */
export interface DataTableSort {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<TData> {
  /** Column definitions, left to right. */
  columns: DataTableColumn<TData>[];
  /** The rows. Sorting is applied to a copy; this array is never mutated. */
  data: TData[];
  /**
   * Stable identity of a row: the React key and the `data-row-id` on the
   * `<tr>`. Required, because an index key re-uses the wrong DOM node the
   * moment the table is re-sorted.
   */
  getRowId: (row: TData) => string;
  /** The card's visible title and the table's accessible name (a hidden `<caption>`). */
  title: string;
  /** Second line under the title. */
  description?: ReactNode | undefined;
  /** Right-hand side of the header band — a search field, or a primary button. */
  actions?: ReactNode | undefined;
  /** A band under the header, for filters. */
  toolbar?: ReactNode | undefined;
  /** Minimum table width, e.g. `'560px'`. Below it the card scrolls sideways. */
  minWidth?: string | undefined;
  /** Initial ordering when the table owns its own sort state. */
  defaultSort?: DataTableSort | undefined;
  /**
   * Ordering, when the caller owns it; `null` is "unsorted". Supplying this
   * makes the table controlled: it only reports through `onSortChange`.
   */
  sort?: DataTableSort | null | undefined;
  /** Called with the ordering a header press asks for, in both modes. */
  onSortChange?: ((sort: DataTableSort) => void) | undefined;
  /** Title of the empty state. Required: this component carries no copy. */
  emptyTitle: string;
  /** Second line of the empty state. */
  emptyDescription?: ReactNode | undefined;
  /** Call to action in the empty state, usually a `Button`. */
  emptyAction?: ReactNode | undefined;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * A bordered card with a title band, an optional filter band and a sortable
 * `<table>` underneath, built from `@shoptet/ui`'s table parts.
 *
 * Sorting is a two-state toggle: pressing a sorted column flips it, pressing a
 * new one starts it ascending, and there is no "unsorted" press.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  title,
  description,
  actions,
  toolbar,
  minWidth,
  defaultSort,
  sort,
  onSortChange,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: DataTableProps<TData>) {
  const isControlled = sort !== undefined;
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(defaultSort ?? null);
  const activeSort = isControlled ? sort : internalSort;

  const rows = useMemo(() => {
    const column = columns.find((candidate) => candidate.id === activeSort?.columnId);
    const sortValue = column?.sortValue;

    if (activeSort === null || sortValue === undefined) {
      return data;
    }

    const sign = activeSort.direction === 'desc' ? -1 : 1;

    return [...data].sort((a, b) => sign * compareSortValues(sortValue(a), sortValue(b)));
  }, [columns, data, activeSort]);

  const press = (columnId: string) => {
    const next: DataTableSort = {
      columnId,
      direction:
        activeSort?.columnId === columnId && activeSort.direction === 'asc' ? 'desc' : 'asc',
    };

    // While controlled, `activeSort` never reads `internalSort`, so writing it
    // would be dead state and a wasted render.
    if (!isControlled) {
      setInternalSort(next);
    }
    onSortChange?.(next);
  };

  const hostStyle =
    minWidth === undefined ? undefined : ({ '--data-table-min-width': minWidth } as CSSProperties);

  return (
    // Deliberately unnamed: a `<section>` with a name becomes a landmark, and
    // the title is already announced by the table's caption.
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <Text appearance="strong-lg">{title}</Text>
          {description !== undefined && (
            <Paragraph appearance="sm" variant="secondary">
              {description}
            </Paragraph>
          )}
        </div>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>

      {toolbar !== undefined && <div className={styles.toolbar}>{toolbar}</div>}

      <div className={styles.host} style={hostStyle}>
        <Table>
          <VisuallyHidden as="caption">{title}</VisuallyHidden>
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const align = column.align ?? 'start';
                const sorted = activeSort?.columnId === column.id ? activeSort.direction : null;
                const canSort = column.sortValue !== undefined;

                return (
                  <TableHeaderCell
                    key={column.id}
                    data-align={align}
                    // Omitted on a column that cannot be sorted: `aria-sort="none"`
                    // would announce a control that is not there.
                    aria-sort={canSort ? (sorted === null ? 'none' : ARIA_SORT[sorted]) : undefined}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => press(column.id)}
                      >
                        {column.header}
                        {/* `aria-sort` on the header announces the direction. */}
                        <span aria-hidden="true" className={styles.sortGlyph}>
                          {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHeaderCell>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableBody.Empty colspan={columns.length}>
                <EmptyState
                  size="sm"
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              </TableBody.Empty>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);

                return (
                  <TableRow key={id} data-row-id={id}>
                    {columns.map((column) => (
                      <TableCell key={column.id} data-align={column.align ?? 'start'}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
