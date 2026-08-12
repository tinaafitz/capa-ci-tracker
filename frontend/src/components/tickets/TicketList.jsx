import { useMemo, useState } from 'react'
import {
  useLegacyTable as useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from '@tanstack/react-table/legacy'
import { flexRender } from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FilterSelect } from '@/components/shared/FilterSelect'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { TicketStatusBadge } from './TicketStatusBadge'
import { SeverityBadge, SEVERITY_ORDER } from './SeverityBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatAssignee } from '@/lib/utils'

const statusOptions = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'root_caused', label: 'Root Caused' },
  { value: 'fix_in_progress', label: 'Fix In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'verified', label: 'Verified' },
]

const severityOptions = [
  { value: 'all', label: 'All Severities' },
  { value: 'nightly_blocker', label: 'Nightly Blocker' },
  { value: 'test_regression', label: 'Test Regression' },
  { value: 'flaky', label: 'Flaky' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'upstream_breakage', label: 'Upstream Breakage' },
]

export function TicketList({
  tickets,
  loading,
  totalCount,
  page,
  totalPages,
  filters,
  onFiltersChange,
  onPageChange,
  onTicketClick,
}) {
  const [rowSelection, setRowSelection] = useState({})
  const [sorting, setSorting] = useState([
    { id: 'severity', desc: false },
  ])

  const columns = useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
            className="translate-y-[2px]"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            className="translate-y-[2px]"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        size: 40,
      },
      {
        accessorKey: 'ticket_number',
        header: 'ID',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            CAPA-{row.getValue('ticket_number')}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <div className="max-w-md">
            <span className="text-sm font-medium truncate block">
              {row.getValue('title')}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ row }) => <SeverityBadge severity={row.getValue('severity')} />,
        sortingFn: (rowA, rowB) => {
          return SEVERITY_ORDER.indexOf(rowA.getValue('severity')) - SEVERITY_ORDER.indexOf(rowB.getValue('severity'))
        },
        size: 140,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <TicketStatusBadge status={row.getValue('status')} />
        ),
        size: 130,
      },
      {
        accessorKey: 'assignee',
        header: 'Assignee',
        cell: ({ row }) => {
          const assignee = row.getValue('assignee')
          return assignee ? (
            <span className="text-sm" title={assignee}>
              @{formatAssignee(assignee)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground border border-dashed border-border rounded px-2 py-0.5 cursor-pointer hover:bg-muted">
              Assign
            </span>
          )
        },
        size: 120,
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(row.getValue('created_at'))}
          </span>
        ),
        size: 80,
      },
    ],
    []
  )

  const table = useReactTable({
    data: tickets || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: {
      rowSelection,
      sorting,
    },
    getRowId: (row) => row.id,
  })

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <FilterSelect
          value={filters.status}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v })}
          options={statusOptions}
          className="w-40 h-8"
        />

        <FilterSelect
          value={filters.severity}
          onValueChange={(v) => onFiltersChange({ ...filters, severity: v })}
          options={severityOptions}
          className="w-44 h-8"
        />

        <Input
          placeholder="Search tickets..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="w-64 h-8"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className={`h-9 text-xs group${canSort ? ' cursor-pointer select-none hover:bg-muted/50' : ''}`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {canSort && (
                            <span className="text-muted-foreground">
                              {sorted === 'asc' ? (
                                <span className="text-foreground">{'▲'}</span>
                              ) : sorted === 'desc' ? (
                                <span className="text-foreground">{'▼'}</span>
                              ) : (
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity">{'↕'}</span>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              // Skeleton loading rows
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell className="w-10">
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-12" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48">
                  <EmptyState
                    title="No tickets match your filters"
                    description="Try adjusting your filters or create a new ticket."
                    actionLabel="Clear filters"
                    onAction={() =>
                      onFiltersChange({
                        status: 'open',
                        severity: 'all',
                        assignee: 'all',
                        search: '',
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onTicketClick(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {tickets.length} of {totalCount} tickets
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {generatePageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <PaginationItem key={`ellipsis-${i}`}>
                    <span className="px-2 text-muted-foreground">...</span>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => onPageChange(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '--'
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`

  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function generatePageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = []
  pages.push(1)

  if (current > 3) pages.push('...')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) pages.push('...')

  pages.push(total)

  return pages
}
