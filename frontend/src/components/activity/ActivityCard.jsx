import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAppActions } from '@/store/AppContext'
import {
  formatRelative,
  formatAbsolute,
  truncateJobName,
  truncateBuildId,
} from '@/lib/utils'

const activityIcons = {
  build_completed: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  ticket_created: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  ticket_updated: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  note_added: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
    </svg>
  ),
  diagnosis_completed: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  fix_submitted: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  fix_merged: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  notification_sent: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
}

const activityColors = {
  build_completed: 'text-blue-600 bg-blue-50',
  ticket_created: 'text-emerald-600 bg-emerald-50',
  ticket_updated: 'text-amber-600 bg-amber-50',
  note_added: 'text-gray-600 bg-gray-50',
  diagnosis_completed: 'text-violet-600 bg-violet-50',
  fix_submitted: 'text-indigo-600 bg-indigo-50',
  fix_merged: 'text-emerald-600 bg-emerald-50',
  notification_sent: 'text-gray-600 bg-gray-50',
}

export function ActivityCard({ activity, isNew = false }) {
  const navigate = useNavigate()
  const { selectTicket, selectBuild } = useAppActions()

  const icon = activityIcons[activity.activity_type] || activityIcons.ticket_updated
  const colorClass = activityColors[activity.activity_type] || 'text-gray-600 bg-gray-50'

  const linkedTicket = activity.support_tickets
  const linkedBuild = activity.builds

  function handleTicketClick(e) {
    e.stopPropagation()
    if (linkedTicket) {
      navigate('/tickets')
      setTimeout(() => selectTicket(linkedTicket), 50)
    }
  }

  function handleBuildClick(e) {
    e.stopPropagation()
    if (linkedBuild) {
      navigate('/transactions')
      setTimeout(() => selectBuild(linkedBuild), 50)
    }
  }

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${
        isNew ? 'bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300' : ''
      }`}
    >
      {/* Icon */}
      <div
        className={`mt-0.5 p-1.5 rounded-md shrink-0 ${colorClass}`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium text-foreground truncate"
            title={activity.title}
          >
            {truncateJobName(activity.title)}
          </span>
          {linkedBuild && activity.activity_type === 'build_completed' && (
            <StatusBadge status={linkedBuild.status} />
          )}
        </div>

        {activity.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {activity.description}
          </p>
        )}

        <div className="flex items-center gap-3 pt-0.5">
          {linkedTicket && (
            <button
              onClick={handleTicketClick}
              className="text-xs font-mono text-primary hover:underline"
            >
              CAPA-{linkedTicket.ticket_number}
            </button>
          )}
          {linkedBuild && (
            <button
              onClick={handleBuildClick}
              className="text-xs font-mono text-primary hover:underline"
              title={`Build ${linkedBuild.external_id}`}
            >
              #{truncateBuildId(linkedBuild.external_id)}
            </button>
          )}
          {activity.actor && activity.actor !== 'system' && (
            <span className="text-xs text-muted-foreground">
              by @{activity.actor}
            </span>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <span
        className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5"
        title={formatAbsolute(activity.created_at)}
      >
        {formatRelative(activity.created_at)}
      </span>
    </div>
  )
}
