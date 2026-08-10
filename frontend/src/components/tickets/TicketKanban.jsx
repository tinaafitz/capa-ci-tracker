import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SeverityBadge } from './SeverityBadge'
import { TICKET_STATUSES } from './TicketStatusBadge'

/**
 * Status column configuration — display labels and dot colors for each status.
 * Colors are intentionally kept in sync with TicketStatusBadge so the board
 * reads consistently with badge styling elsewhere in the app.
 */
const STATUS_CONFIG = {
  new: {
    label: 'New',
    dotColor: 'bg-slate-400',
    columnBg: 'bg-slate-50/60 dark:bg-slate-900/20',
  },
  investigating: {
    label: 'Investigating',
    dotColor: 'bg-blue-500',
    columnBg: 'bg-blue-50/40 dark:bg-blue-900/20',
  },
  root_caused: {
    label: 'Root Caused',
    dotColor: 'bg-violet-500',
    columnBg: 'bg-violet-50/40 dark:bg-violet-900/20',
  },
  fix_in_progress: {
    label: 'Fix In Progress',
    dotColor: 'bg-amber-500',
    columnBg: 'bg-amber-50/40 dark:bg-amber-900/20',
  },
  resolved: {
    label: 'Resolved',
    dotColor: 'bg-emerald-500',
    columnBg: 'bg-emerald-50/40 dark:bg-emerald-900/20',
  },
  verified: {
    label: 'Verified',
    dotColor: 'bg-emerald-600',
    columnBg: 'bg-emerald-50/30 dark:bg-emerald-900/15',
  },
}

/**
 * Compute a relative time string from a timestamp.
 */
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

/**
 * Single ticket card rendered within a Kanban column.
 */
function TicketCard({ ticket, onClick }) {
  const taskCount = ticket.task_count || 0
  const tasksDone = ticket.tasks_done || 0
  const hasProgress = taskCount > 0
  const progressPct = hasProgress ? Math.round((tasksDone / taskCount) * 100) : 0

  return (
    <Card
      size="sm"
      className="cursor-pointer hover:ring-foreground/20 transition-[box-shadow] duration-150 bg-card"
      onClick={() => onClick(ticket)}
    >
      <div className="px-3 py-2.5 space-y-2">
        {/* Row 1: Ticket number + relative time */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            CAPA-{ticket.ticket_number}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTime(ticket.created_at)}
          </span>
        </div>

        {/* Row 2: Title (2-line clamp) */}
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {ticket.title}
        </p>

        {/* Row 3: Severity badge + assignee */}
        <div className="flex items-center justify-between gap-2">
          <SeverityBadge severity={ticket.severity} />
          {ticket.assignee ? (
            <span className="text-xs text-muted-foreground truncate max-w-[100px]">
              @{ticket.assignee}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/60 italic">
              unassigned
            </span>
          )}
        </div>

        {/* Row 4: Task progress bar (only if tasks exist) */}
        {hasProgress && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {tasksDone}/{taskCount}
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Skeleton card shown during loading state.
 */
function TicketCardSkeleton() {
  return (
    <Card size="sm">
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      </div>
    </Card>
  )
}

/**
 * Single Kanban column for one status.
 */
function KanbanColumn({ status, tickets, loading, onTicketClick }) {
  const config = STATUS_CONFIG[status]
  const count = tickets.length

  return (
    <div className="flex flex-col min-w-[200px] flex-1">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 mb-2">
        <span className={`h-2.5 w-2.5 rounded-full ${config.dotColor}`} />
        <span className="text-sm font-medium text-foreground">
          {config.label}
        </span>
        <Badge
          variant="secondary"
          className="h-5 min-w-5 px-1.5 text-xs font-medium ml-auto"
        >
          {loading ? '-' : count}
        </Badge>
      </div>

      {/* Column body — scrollable card list */}
      <div
        className={`flex-1 rounded-lg px-2 py-2 space-y-2 overflow-y-auto ${config.columnBg}`}
      >
        {loading ? (
          // Skeleton loading cards
          <>
            <TicketCardSkeleton />
            <TicketCardSkeleton />
            <TicketCardSkeleton />
          </>
        ) : count === 0 ? (
          // Empty column state
          <div className="flex items-center justify-center py-8 px-2">
            <span className="text-xs text-muted-foreground/70">
              No tickets
            </span>
          </div>
        ) : (
          // Ticket cards
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onClick={onTicketClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Kanban board for tickets, grouped by status columns.
 *
 * @param {Object} props
 * @param {Array} props.tickets - Array of ticket objects from v_ticket_summary
 * @param {boolean} props.loading - Whether data is still loading
 * @param {Function} props.onTicketClick - Called with a ticket when a card is clicked
 */
export function TicketKanban({ tickets = [], loading, onTicketClick }) {
  // Group tickets by status into columns
  const columns = useMemo(() => {
    const grouped = {}
    for (const status of TICKET_STATUSES) {
      grouped[status] = []
    }

    if (tickets) {
      for (const ticket of tickets) {
        const status = ticket.status || 'new'
        if (grouped[status]) {
          grouped[status].push(ticket)
        }
      }
    }

    return grouped
  }, [tickets])

  return (
    <div className="flex gap-4 h-full overflow-x-auto pb-4 px-1">
      {TICKET_STATUSES.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tickets={columns[status]}
          loading={loading}
          onTicketClick={onTicketClick}
        />
      ))}
    </div>
  )
}
