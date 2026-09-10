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
import { Badge } from '@/components/ui/badge'
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

/**
 * Map a failure_class value to a short human label for the infra badge.
 * infra_lease -> "lease", infra_auth -> "auth", etc.
 */
function infraClassLabel(failureClass) {
  if (!failureClass) return 'infra'
  if (failureClass.startsWith('infra_')) return failureClass.slice(6)
  return failureClass // e.g. "aborted"
}

/**
 * Badge shown on infra/harness failure builds.
 * Uses amber styling to distinguish from red "Failed" status.
 */
function InfraBadge({ failureClass, failureReason, title }) {
  const label = infraClassLabel(failureClass)
  const displayTitle = title || failureReason || undefined
  return (
    <Badge
      variant="outline"
      className="bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-50 font-mono text-[11px]"
      title={displayTitle}
    >
      infra:{label}
    </Badge>
  )
}

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
  hideInfra = false,
  onHideInfraChange,
  onFiltersChange,
  onPageChange,
  onBuildClick,
}) {
  // `size` below is a RELATIVE WEIGHT, not a pixel width. The header render
  // divides each one by the table's total to emit a percentage, so the columns
  // always sum to 100% and share any surplus width in proportion. Fixed pixel
  // widths pooled all the leftover space into whichever column absorbed it,
  // leaving a blank gap mid-row on wide screens.
  const columns = useMemo(
    () => [
      {
        // Job, build, repo and params all identify the same run, so they share
        // one stacked column. Splitting them across four columns spent width on
        // repeated separators and left every field cramped.
        accessorKey: 'job_name',
        header: 'Job / Build',
        cell: ({ row }) => {
          const fullName = row.getValue('job_name') || ''
          const externalId = row.original.external_id
          const jobUrl = row.original.job_url
          const repo = extractRepo(row.original.job_name, row.original.source)
          const paramChips = buildParamChips(row.original).join(' • ')

          // Jenkins job names are short ("capi_tests") with a 3-digit build, so
          // they fit on one line together. Prow pairs a very long generated job
          // name with a 19-digit build id and needs its own line for each.
          const inline = row.original.source === 'jenkins'

          const jobName = (
            <span className="text-sm font-mono truncate" title={fullName}>
              {fullName}
            </span>
          )
          const buildRef = jobUrl ? (
            <a
              href={jobUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline font-mono text-xs font-medium w-fit shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              #{externalId}
            </a>
          ) : (
            <span className="font-mono text-xs font-medium shrink-0">#{externalId}</span>
          )

          return (
            <div className="flex flex-col gap-0.5">
              {inline ? (
                <span className="flex items-baseline gap-2 min-w-0">
                  {jobName}
                  {buildRef}
                </span>
              ) : (
                <>
                  {jobName}
                  {buildRef}
                </>
              )}
              {repo && (
                <span
                  className="text-xs text-muted-foreground font-mono truncate"
                  title={repo}
                >
                  {repo}
                </span>
              )}
              {paramChips && (
                <span
                  className="text-xs text-muted-foreground font-mono truncate"
                  title={paramChips}
                >
                  {paramChips}
                </span>
              )}
            </div>
          )
        },
        // Roughly 38% of the table -- it carries four stacked lines including
        // the longest content on the row (a Prow job name), so it earns the
        // largest share. See the `size` note above the column list.
        size: 400,
        meta: { cellClassName: 'whitespace-nowrap' },
      },
      {
        accessorKey: 'source',
        header: 'Source',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground capitalize">
            {row.getValue('source')}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.getValue('status')} />,
        size: 105,
      },
      {
        id: 'class',
        header: 'Reason',
        enableSorting: false,
        cell: ({ row }) => {
          const isInfra = row.original.is_infra === 1 || row.original.is_infra === '1'
          const failureClass = row.original.failure_class
          const failureReason = row.original.failure_reason

          // Show badge for infra failures or cleanup verification failures
          if (isInfra || failureClass === 'cleanup_verification_failure') {
            return (
              <InfraBadge
                failureClass={failureClass}
                failureReason={failureReason}
              />
            )
          }
          return null
        },
        // Widest of the metric columns: the badge text is a failure class
        // ("infra:teardown", "infra:provision"), not a fixed-width value.
        size: 130,
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
        size: 100,
      },
      {
        accessorKey: 'started_at',
        header: 'Started',
        // Weight nudged up over Tests/Duration to cover the sort caret that the
        // header adds ("Started ▼") -- it is the default sort column.
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
        size: 110,
      },
      {
        accessorKey: 'duration_ms',
        header: 'Duration',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground font-mono">
            {formatDuration(row.getValue('duration_ms'))}
          </span>
        ),
        size: 110,
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

  // Denominator that turns each column's `size` weight into a percentage.
  const totalWidth = table.getTotalSize()

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

        {/* Hide infra failures toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none ml-auto">
          <span className="relative inline-flex h-5 w-9 shrink-0">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={hideInfra}
              onChange={(e) => onHideInfraChange && onHideInfraChange(e.target.checked)}
            />
            <span className="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-amber-500" />
            <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Hide infra failures
          </span>
        </label>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        {/*
          table-fixed, not auto: under auto layout the browser reads the column
          widths as hints and re-derives them from cell content, so a single
          long Prow job name could blow one column out and squeeze the rest.
          Fixed layout honours the percentages exactly.
        */}
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: `${(header.getSize() / totalWidth) * 100}%`,
                      }}
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

/**
 * Condense a build's Jenkins parameters into short display chips.
 * Returns [] for builds with no recognisable parameters (e.g. Prow rows).
 */
function buildParamChips(build) {
  const chips = []
  try {
    // parameters can be either a JSON string or already parsed object
    const params =
      typeof build.parameters === 'string'
        ? JSON.parse(build.parameters || '{}')
        : build.parameters || {}

    if (params.FEATURE_GROUP) chips.push(`group:${params.FEATURE_GROUP}`)
    if (params.NAME_PREFIX) chips.push(`prefix:${params.NAME_PREFIX}`)

    // Extract host from OCP_HUB_API_URL
    if (params.OCP_HUB_API_URL) {
      const hostMatch = params.OCP_HUB_API_URL.match(/api\.([^.]+)\./)
      if (hostMatch) chips.push(`host:${hostMatch[1]}`)
    }

    let requestedVersion = null
    if (params.EXTRA_FEATURE_VARS) {
      const channelMatch = params.EXTRA_FEATURE_VARS.match(/channel_group=(\S+)/)
      if (channelMatch) chips.push(`channel:${channelMatch[1]}`)
      const versionMatch = params.EXTRA_FEATURE_VARS.match(/openshift_version=([^\s]+)/)
      if (versionMatch) {
        requestedVersion = versionMatch[1]
        chips.push(`ocp:${requestedVersion}`)
      }
    }

    // Add the resolved cluster OCP version, but only when it differs from the
    // requested one — ingest now derives ocp_version from the same
    // EXTRA_FEATURE_VARS string, so showing both would repeat the value.
    // When they DO differ the gap is the interesting part.
    if (build.ocp_version && build.ocp_version !== requestedVersion) {
      chips.push(`version:${build.ocp_version}`)
    }
  } catch {
    // Malformed parameters JSON — show no chips rather than breaking the row.
  }
  return chips
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
