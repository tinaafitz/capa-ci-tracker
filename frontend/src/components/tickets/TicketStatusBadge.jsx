import { Badge } from '@/components/ui/badge'

const statusConfig = {
  new: {
    label: 'New',
    className: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100',
  },
  investigating: {
    label: 'Investigating',
    className: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',
  },
  root_caused: {
    label: 'Root Caused',
    className: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50',
  },
  fix_in_progress: {
    label: 'Fix In Progress',
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  },
  resolved: {
    label: 'Resolved',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
  verified: {
    label: 'Verified',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
  },
}

export function TicketStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.new

  return (
    <Badge variant="outline" className={`text-xs font-medium ${config.className}`}>
      {config.label}
    </Badge>
  )
}

/**
 * All ticket statuses in pipeline order.
 */
export const TICKET_STATUSES = [
  'new',
  'investigating',
  'root_caused',
  'fix_in_progress',
  'resolved',
  'verified',
]

/**
 * Get the next status in the pipeline.
 */
export function getNextStatus(currentStatus) {
  const idx = TICKET_STATUSES.indexOf(currentStatus)
  if (idx === -1 || idx === TICKET_STATUSES.length - 1) return null
  return TICKET_STATUSES[idx + 1]
}

/**
 * Get a human-readable label for a status transition.
 */
export function getAdvanceLabel(currentStatus) {
  const next = getNextStatus(currentStatus)
  if (!next) return null
  const config = statusConfig[next]
  return `Advance to ${config?.label || next}`
}
