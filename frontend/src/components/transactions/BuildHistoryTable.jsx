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
import { StatusBadge } from '@/components/shared/StatusBadge'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatRelative, formatAbsolute } from '@/lib/utils'

function statusBorderClass(status) {
  switch (status) {
    case 'failure':
    case 'failed':
      return 'border-l-4 border-l-red-500'
    case 'passed':
    case 'success':
      return 'border-l-4 border-l-green-500'
    case 'pending':
    case 'running':
      return 'border-l-4 border-l-yellow-500'
    default:
      return 'border-l-4 border-l-muted'
  }
}

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Passed' },
  { value: 'failure', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'unstable', label: 'Unstable' },
]

export function BuildHistoryTable({
  builds,
  loading,
  totalCount,
  page,
  totalPages,
  filters,
  onFiltersChange,
  onPageChange,
  onBuildClick,
}) {
  const columns = useMemo(
    () => [
      {
        accessorKey: 'external_id',
        header: 'Build',
        cell: ({ row }) => {
          const externalId = row.getValue('external_id')
          const jobUrl = row.original.job_url
          if (jobUrl) {
            return (
              <a
                href={jobUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-mono text-xs font-medium"
                onClick={(e) => e.stopPropagation()}
              >
                #{externalId}
              </a>
            )
          }
          return (
            <span className="font-mono text-xs font-medium">#{externalId}</span>
          )
        },
        size: 80,
      },
      {
        accessorKey: 'job_name',
        header: 'Job',
        cell: ({ row }) => {
          const fullName = row.getValue('job_name') || ''
          const repo = extractRepo(row.original.job_name, row.original.source)
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-mono break-all whitespace-normal">
                {fullName}
              </span>
              {repo && (
                <span className="text-xs text-muted-foreground font-mono break-all">
                  {repo}
                </span>
              )}
            </div>
          )
        },
        size: 500,
        meta: { cellClassName: 'whitespace-normal' },
      },
      {
        accessorKey: 'source',
        header: 'Source',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground capitalize">
            {row.getValue('source')}
          </span>
        ),
        size: 80,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.getValue('status')} />,
        size: 100,
      },
      {
        id: 'tests',
        header: 'Tests',
        enableSorting: false,
        cell: ({ row }) => {
          const pass = row.original.pass_count
          const fail = row.original.fail_count
          const skip = row.original.skip_count
          return (
            <span className="text-sm font-mono whitespace-nowrap">
              <span className={pass > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                {pass ?? '--'}
              </span>
              <span className="text-muted-foreground"> / </span>
              <span
                className={
                  fail > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'
                }
              >
                {fail ?? '--'}
              </span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-muted-foreground">{skip ?? '--'}</span>
            </span>
          )
        },
        size: 120,
      },
      {
        accessorKey: 'started_at',
        header: 'Started',
        cell: ({ row }) => {
          const started = row.getValue('started_at')
          return (
            <span
              className="text-xs text-muted-foreground whitespace-nowrap"
              title={formatAbsolute(started)}
            >
              {formatRelative(started)}
            </span>
          )
        },
        size: 120,
      },
      {
        accessorKey: 'duration_ms',
        header: 'Duration',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground font-mono">
            {formatDuration(row.getValue('duration_ms'))}
          </span>
        ),
        size: 80,
      },
    ],
    []
  )

  const [sorting, setSorting] = useState([
    { id: 'started_at', desc: true },
  ])

  const table = useReactTable({
    data: builds || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
    getRowId: (row) => row.id,
  })

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <FilterSelect
          value={filters.job || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, job: v })}
          options={[{ value: 'all', label: 'All Jobs' }]}
          className="w-48 h-8"
        />

        <FilterSelect
          value={filters.status || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v })}
          options={statusOptions}
          className="w-36 h-8"
        />

        <DateRangeFilter
          value={filters.dateRange || '7d'}
          onChange={(v) => onFiltersChange({ ...filters, dateRange: v })}
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
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((col, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48">
                  <EmptyState
                    title="No builds found"
                    description="No builds match your current filters."
                    actionLabel="Clear filters"
                    onAction={() =>
                      onFiltersChange({
                        job: 'all',
                        status: 'all',
                        dateRange: '7d',
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isFailed = row.original.status === 'failure'
                return (
                  <TableRow
                    key={row.id}
                    className={`cursor-pointer hover:bg-muted/50 ${statusBorderClass(
                      row.original.status
                    )} ${isFailed ? 'font-medium' : ''}`}
                    onClick={() => onBuildClick(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const cellClassName = cell.column.columnDef.meta?.cellClassName || ''
                      return (
                        <TableCell key={cell.id} className={`py-2 ${cellClassName}`}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {builds.length} of {totalCount} builds
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

function formatDuration(ms) {
  if (!ms) return '--'
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60

  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${minutes}m`
}

function extractRepo(jobName, source) {
  if (source === 'prow' && jobName) {
    if (jobName.includes('openshift-online-rosa-e2e')) {
      return 'stolostron/rosa-hcp-e2e-test'
    }
    const match = jobName.match(/^(?:periodic|pull|batch)-ci-(.+?)-(main|master|release-[\d.]+)/)
    if (match) {
      const parts = match[1].split('-')
      const knownOrgs = ['openshift-online', 'stolostron', 'openshift']
      for (const org of knownOrgs) {
        const orgParts = org.split('-')
        if (parts.slice(0, orgParts.length).join('-') === org) {
          const repo = parts.slice(orgParts.length).join('-')
          return `${org}/${repo}`
        }
      }
      return `${parts[0]}/${parts.slice(1).join('-')}`
    }
  }
  if (source === 'jenkins') {
    return 'stolostron/rosa-hcp-e2e-test'
  }
  return null
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
