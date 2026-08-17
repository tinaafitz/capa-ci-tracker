import { Fragment, useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { StreakDetail, StreakStatusBadge } from './StreakDetail'
import { useStreaks } from '@/hooks/useStreaks'
import { supabase } from '@/config/supabase'

// Sort priority for streak statuses: active first, then partial_fix, then resolved.
const STATUS_ORDER = { active: 0, partial_fix: 1, resolved: 2 }

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
  const [sorting, setSorting] = useState([])
  const [expandedRows, setExpandedRows] = useState({})
  const navigate = useNavigate()

  // Map of streak_id -> originating ticket { id, ticket_number }.
  const [ticketsByStreak, setTicketsByStreak] = useState({})

  const toggleRow = (streakId) => {
    setExpandedRows((prev) => ({
      ...prev,
      [streakId]: !prev[streakId],
    }))
  }

  // Streaks pre-sorted by status priority (active -> partial_fix -> resolved),
  // then by most recent start. Used as the table's default order.
  const sortedStreaks = useMemo(() => {
    const rows = streaks || []
    return [...rows].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 99
      const sb = STATUS_ORDER[b.status] ?? 99
      if (sa !== sb) return sa - sb
      return new Date(b.started_at || 0) - new Date(a.started_at || 0)
    })
  }, [streaks])

  // Job names that appear in more than one streak row -> "Recurring".
  const recurringJobs = useMemo(() => {
    const counts = {}
    for (const s of streaks || []) {
      if (!s.job_name) continue
      counts[s.job_name] = (counts[s.job_name] || 0) + 1
    }
    return new Set(Object.keys(counts).filter((j) => counts[j] > 1))
  }, [streaks])

  // Fetch originating tickets for the visible streaks in a single query.
  useEffect(() => {
    const ids = (streaks || []).map((s) => s.id).filter(Boolean)
    if (!ids.length) {
      setTicketsByStreak({})
      return
    }
    let cancelled = false
    supabase
      .from('support_tickets')
      .select('id,ticket_number,streak_id')
      .in('streak_id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return
        const map = {}
        for (const t of data) {
          // Keep the first (lowest ticket_number) per streak.
          if (!map[t.streak_id] || t.ticket_number < map[t.streak_id].ticket_number) {
            map[t.streak_id] = { id: t.id, ticket_number: t.ticket_number }
          }
        }
        setTicketsByStreak(map)
      })
    return () => {
      cancelled = true
    }
  }, [streaks])

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
        size: 360,
        meta: { cellClassName: 'whitespace-normal' },
        cell: ({ row }) => (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="font-mono text-xs text-foreground break-all whitespace-normal">
              {row.original.job_name}
            </span>
            {recurringJobs.has(row.original.job_name) && (
              <Badge
                variant="outline"
                className="text-[10px] font-medium bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700"
                title="This job appears in multiple failure streaks"
              >
                Recurring
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: 'ticket',
        header: 'Ticket',
        size: 90,
        enableSorting: false,
        cell: ({ row }) => {
          const ticket = ticketsByStreak[row.original.id]
          if (!ticket) return <span className="text-xs text-muted-foreground/40">--</span>
          return (
            <button
              className="inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/tickets/${ticket.id}`)
              }}
              title="Open originating ticket"
            >
              CAPA-{ticket.ticket_number}
            </button>
          )
        },
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
    [expandedRows, recurringJobs, ticketsByStreak, navigate]
  )

  const table = useReactTable({
    data: sortedStreaks,
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

  // Zero streaks at all: show the explanatory empty state.
  if (!streaks?.length) {
    return (
      <EmptyState
        title="No failure streaks detected"
        description="Streaks are created automatically when a CI job fails for 2+ consecutive days. When the streak analyzer runs, they will appear here."
      />
    )
  }

  const activeCount = streaks.filter((s) => s.status === 'active').length

  // Streaks exist but none are active: reassuring "all passing" state.
  if (activeCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/50">
          <svg
            className="h-6 w-6 text-green-600 dark:text-green-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h3 className="mt-4 text-sm font-medium text-foreground">
          No active failure streaks — all jobs passing
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {streaks.length} past streak{streaks.length !== 1 ? 's' : ''} on record, all resolved.
        </p>
      </div>
    )
  }

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
                {row.getVisibleCells().map((cell) => {
                  const cellClassName = cell.column.columnDef.meta?.cellClassName || ''
                  return (
                    <TableCell key={cell.id} className={`py-2 ${cellClassName}`} style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  )
                })}
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

