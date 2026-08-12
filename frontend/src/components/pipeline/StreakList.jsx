import { Fragment, useState, useMemo } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { StreakDetail, StreakStatusBadge } from './StreakDetail'
import { useStreaks } from '@/hooks/useStreaks'

function SortIcon({ direction }) {
  if (direction === 'asc') {
    return (
      <svg className="h-3 w-3 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    )
  }
  if (direction === 'desc') {
    return (
      <svg className="h-3 w-3 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }
  return (
    <svg className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l5 5 5-5M7 8l5-5 5 5" />
    </svg>
  )
}

function formatDate(timestamp) {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function StreakList() {
  const { data: streaks, loading, error } = useStreaks()
  const [sorting, setSorting] = useState([{ id: 'started_at', desc: false }])
  const [expandedRows, setExpandedRows] = useState({})

  const toggleRow = (streakId) => {
    setExpandedRows((prev) => ({
      ...prev,
      [streakId]: !prev[streakId],
    }))
  }

  const columns = useMemo(
    () => [
      {
        id: 'expand',
        header: '',
        size: 32,
        enableSorting: false,
        cell: ({ row }) => (
          <button
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              toggleRow(row.original.id)
            }}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${
                expandedRows[row.original.id] ? 'rotate-90' : ''
              }`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
          </button>
        ),
      },
      {
        id: 'job_name',
        accessorKey: 'job_name',
        header: 'Job',
        size: 300,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-foreground truncate block max-w-[280px]">
            {row.original.job_name}
          </span>
        ),
      },
      {
        id: 'streak_length',
        accessorKey: 'streak_length',
        header: 'Days',
        size: 60,
        cell: ({ row }) => (
          <span className="text-sm font-medium tabular-nums text-foreground">
            {row.original.streak_length}
          </span>
        ),
      },
      {
        id: 'phase_count',
        accessorKey: 'phase_count',
        header: 'Phases',
        size: 70,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.original.phase_count}
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => <StreakStatusBadge status={row.original.status} />,
      },
      {
        id: 'started_at',
        accessorKey: 'started_at',
        header: 'Started',
        size: 90,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDate(row.original.started_at)}
          </span>
        ),
      },
      {
        id: 'latest_error',
        header: 'Latest Error',
        size: 260,
        enableSorting: false,
        cell: ({ row }) => {
          const phases = row.original.phases || []
          const latest = phases[phases.length - 1]
          if (!latest) return <span className="text-xs text-muted-foreground/40">--</span>
          return (
            <span className="text-xs text-muted-foreground truncate block max-w-[240px]">
              {latest.summary || latest.matched_pattern || latest.error_signature?.slice(0, 30) || '--'}
            </span>
          )
        },
      },
    ],
    [expandedRows]
  )

  const table = useReactTable({
    data: streaks || [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (loading) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/30 px-4 py-3 border-b border-border">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Failed to load streaks"
        description={error.message || 'Check that the failure_streaks table exists and is accessible.'}
      />
    )
  }

  if (!streaks?.length) {
    return (
      <EmptyState
        title="No failure streaks detected"
        description="Streaks are created automatically when a CI job fails for 2+ consecutive days. When the streak analyzer runs, they will appear here."
      />
    )
  }

  const activeCount = streaks.filter((s) => s.status === 'active').length

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Table header with count */}
      <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {streaks.length} streak{streaks.length !== 1 ? 's' : ''}
          {activeCount > 0 && (
            <span className="ml-1">
              ({activeCount} active)
            </span>
          )}
        </span>
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    className={`text-xs font-medium h-9 group ${canSort ? 'cursor-pointer select-none' : ''}`}
                    style={{ width: header.getSize() }}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort && <SortIcon direction={sorted} />}
                    </div>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/40 transition-colors h-11"
                onClick={() => toggleRow(row.original.id)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2" style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              {/* Expanded detail row */}
              {expandedRows[row.original.id] && (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={columns.length} className="p-0">
                    <div className="border-t border-border">
                      <StreakDetail streakId={row.original.id} />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

