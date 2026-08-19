/**
 * A clickable, sort-state-aware <th>. Shared by every sortable table in the
 * app (ClientDetail's Orders/Invoices/Payments/Statement, Clients' list)
 * instead of duplicating the same click-to-toggle-direction markup per page.
 * Purely presentational — each table owns its own sort state and decides
 * what "sortKey" means for its rows; this component only renders the header
 * cell and the active-column indicator arrow.
 */
export default function SortHeader<K extends string>({
  label, sortKey, sort, onSort, width, align,
}: {
  label: string
  sortKey: K
  sort: { key: K; order: 'asc' | 'desc' } | null
  onSort: (key: K) => void
  width?: number
  align?: 'right'
}) {
  const active = sort?.key === sortKey
  return (
    <th
      className={align === 'right' ? 'right' : undefined}
      style={{ width, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <i
        className={`ti ti-arrow-${active && sort!.order === 'asc' ? 'up' : 'down'}`}
        style={{ fontSize: 11, marginLeft: 4, opacity: active ? 1 : 0.25 }}
      />
    </th>
  )
}

/** "click same column = flip direction, click a new column = start descending" — shared toggler. */
export function toggleSort<K extends string>(
  current: { key: K; order: 'asc' | 'desc' } | null,
  setSort: (v: { key: K; order: 'asc' | 'desc' } | null) => void,
  key: K,
) {
  if (current?.key === key) setSort({ key, order: current.order === 'asc' ? 'desc' : 'asc' })
  else setSort({ key, order: 'desc' })
}
