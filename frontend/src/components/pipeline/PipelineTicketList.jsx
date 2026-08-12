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
import { Skeleton } from '@/components/ui/skeleton'
import { SeverityBadge } from '@/components/tickets/SeverityBadge'
import { TicketPipelineStepper } from '@/components/tickets/TicketPipelineStepper'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'

const STAGE_NAMES = {
  1: 'Build Failed',
  2: 'Ticket Created',
  3: 'Diagnosed',
  4: 'PR Submitted',
  5: 'PR Merged',
  6: 'Verified',
}

const STAGE_STYLES = {
  1: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800',
  2: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  3: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  4: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
  5: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  6: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800',
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '--'
  if (seconds < 60) return '<1m'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

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
  // Unsorted indicator
  return (
    <svg className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l5 5 5-5M7 8l5-5 5 5" />
    </svg>
  )
}

export function PipelineTicketList({ tickets, loading, onTicketClick }) {
  const [sorting, setSorting] = useState([{ id: 'pipeline_stage', desc: false }])

  const columns = useMemo(
    () => [
      {
        id: 'ticket_number',
        accessorKey: 'ticket_number',
        header: 'Ticket',
        size: 90,
        cell: ({ row }) => (
          <span className="font-mono text-sm font-medium text-foreground">
            CAPA-{row.original.ticket_number}
          </span>
        ),
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: 'Title',
        size: 260,
        cell: ({ row }) => (
          <span className="text-sm line-clamp-1 text-foreground/90">{row.original.title}</span>
        ),
      },
      {
        id: 'severity',
        accessorKey: 'severity',
        header: 'Severity',
        size: 130,
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
      {
        id: 'pipeline_stage',
        accessorKey: 'pipeline_stage',
        header: 'Stage',
        size: 130,
        cell: ({ row }) => {
          const stage = row.original.pipeline_stage
          const style = STAGE_STYLES[stage] || ''
          return (
            <Badge variant="outline" className={`text-[11px] whitespace-nowrap font-medium ${style}`}>
              {STAGE_NAMES[stage] || 'Unknown'}
            </Badge>
          )
        },
      },
      {
        id: 'pipeline',
        header: 'Progress',
        size: 180,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="w-full min-w-[7rem] pr-2">
            <TicketPipelineStepper
              compact
              buildFailedAt={row.original.build_failed_at}
              ticketCreatedAt={row.original.ticket_created_at}
              diagnosedAt={row.original.diagnosed_at}
              prSubmittedAt={row.original.pr_submitted_at}
              prMergedAt={row.original.pr_merged_at}
              verifiedAt={row.original.verified_at}
            />
          </div>
        ),
      },
      {
        id: 'total_duration',
        accessorKey: 'total_lifecycle_seconds',
        header: 'Duration',
        size: 80,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums font-mono">
            {formatDuration(row.original.total_lifecycle_seconds)}
          </span>
        ),
      },
      {
        id: 'assignee',
        accessorKey: 'assignee',
        header: 'Assignee',
        size: 120,
        cell: ({ row }) => {
          const assignee = row.original.assignee
          if (!assignee) {
            return <span className="text-sm text-muted-foreground/40 italic">unassigned</span>
          }
          return (
            <span className="text-sm text-foreground/80 truncate block max-w-[7rem]">
              {assignee}
            </span>
          )
        },
      },
    ],
    []
  )

  const table = useReactTable({
    data: tickets || [],
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
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!tickets?.length) {
    return <EmptyState title="No tickets in pipeline" description="Tickets will appear here as CI failures are triaged." />
  }

  const ticketCount = tickets.length

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Table header with count */}
      <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {ticketCount} ticket{ticketCount !== 1 ? 's' : ''} in pipeline
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
            <TableRow
              key={row.id}
              className="cursor-pointer hover:bg-muted/40 transition-colors h-11"
              onClick={() => onTicketClick?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-2" style={{ width: cell.column.getSize() }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
