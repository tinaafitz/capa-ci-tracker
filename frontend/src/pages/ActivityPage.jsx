import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FilterSelect } from '@/components/shared/FilterSelect'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import { useActivities } from '@/hooks/useActivities'
import { useTriageSummary } from '@/hooks/useTriageSummary'

const activityTypeOptions = [
  { value: 'all', label: 'All Events' },
  { value: 'build_completed', label: 'Build Events' },
  { value: 'ticket_created', label: 'Tickets Created' },
  { value: 'ticket_updated', label: 'Tickets Updated' },
  { value: 'note_added', label: 'Notes Added' },
  { value: 'diagnosis_completed', label: 'Diagnosis' },
  { value: 'fix_submitted', label: 'Fixes Submitted' },
  { value: 'fix_merged', label: 'Fixes Merged' },
  { value: 'notification_sent', label: 'Notifications' },
]

export function ActivityPage() {
  // Restore filters from localStorage
  const [filters, setFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('activity-filters')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { type: 'all', dateRange: '24h', ticket: 'all' }
  })

  const [newEventCount, setNewEventCount] = useState(0)
  const [actionableOnly, setActionableOnly] = useState(false)
  const prevDataLengthRef = useRef(0)

  // Persist filters to localStorage
  useEffect(() => {
    localStorage.setItem('activity-filters', JSON.stringify(filters))
  }, [filters])

  const triageSummary = useTriageSummary(filters.dateRange)

  const { data, loading, groupedByDay, count } = useActivities({
    type: filters.type,
    dateRange: filters.dateRange,
    limit: 100,
  })

  // Apply the "Actionable only" filter to the grouped days.
  const displayGroups = useMemo(() => {
    if (!actionableOnly) return groupedByDay

    return groupedByDay
      .map((group) => {
        const items = group.items.filter((activity) => {
          const type = activity.activity_type
          const linkedBuild = activity.builds
          const linkedTicket = activity.support_tickets

          // Hide notifications outright.
          if (type === 'notification_sent') return false

          // Hide passed/successful build events.
          if (type === 'build_completed') {
            const status = linkedBuild?.status
            if (status === 'success' || status === 'passed') return false
            return true
          }

          // Always show ticket lifecycle events.
          if (type === 'ticket_created' || type === 'ticket_updated') return true

          // Show anything tied to a ticket that has no assignee.
          if (linkedTicket && !linkedTicket.assignee) return true

          return false
        })
        return { ...group, items }
      })
      .filter((group) => group.items.length > 0)
  }, [groupedByDay, actionableOnly])

  // Track new events
  useEffect(() => {
    if (data.length > prevDataLengthRef.current && prevDataLengthRef.current > 0) {
      setNewEventCount((prev) => prev + (data.length - prevDataLengthRef.current))
    }
    prevDataLengthRef.current = data.length
  }, [data.length])

  const handleJumpToTop = useCallback(() => {
    setNewEventCount(0)
  }, [])

  const handleFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Activity</h2>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} event{count !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <FilterSelect
            value={filters.type}
            onValueChange={(v) => handleFilterChange('type', v)}
            options={activityTypeOptions}
            className="w-44 h-8"
          />

          <DateRangeFilter
            value={filters.dateRange}
            onChange={(v) => handleFilterChange('dateRange', v)}
          />

          <Button
            variant={actionableOnly ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActionableOnly((v) => !v)}
            className={`h-8 rounded-full px-3 text-xs ${
              actionableOnly ? '' : 'border border-border text-muted-foreground'
            }`}
            aria-pressed={actionableOnly}
          >
            Actionable only
          </Button>
        </div>
      </div>

      {/* Triage summary banner */}
      {!triageSummary.loading && (
        <div className="mx-6 mt-3 flex items-center gap-6 px-4 py-3 bg-muted/30 rounded-lg border border-border shrink-0">
          <Link
            to="/transactions?status=failure"
            className="text-sm hover:underline underline-offset-4 cursor-pointer"
          >
            <span className="font-semibold text-red-600">{triageSummary.failedBuilds}</span>{' '}
            failed build{triageSummary.failedBuilds !== 1 ? 's' : ''}
          </Link>
          <Link
            to="/tickets"
            className="text-sm hover:underline underline-offset-4 cursor-pointer"
          >
            <span className="font-semibold text-foreground">{triageSummary.openTickets}</span>{' '}
            open ticket{triageSummary.openTickets !== 1 ? 's' : ''}
          </Link>
          <Link
            to="/tickets?assignee=unassigned"
            className="text-sm hover:underline underline-offset-4 cursor-pointer"
          >
            <span className="font-semibold text-amber-600">{triageSummary.unassignedTickets}</span>{' '}
            unassigned
          </Link>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-hidden">
        {loading && displayGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="space-y-3 text-center">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">
                Loading activity feed...
              </p>
            </div>
          </div>
        ) : (
          <ActivityTimeline
            groupedByDay={displayGroups}
            newEventCount={newEventCount}
            onJumpToTop={handleJumpToTop}
          />
        )}
      </div>
    </div>
  )
}
