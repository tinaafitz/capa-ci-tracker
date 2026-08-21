import { useMemo } from 'react'
import { useRealtimeTable } from './useRealtimeTable'

/**
 * Hook for fetching and subscribing to activities.
 *
 * @param {Object} filterOptions
 * @param {string} filterOptions.type - 'all' | specific activity_type
 * @param {string} filterOptions.dateRange - '24h' | '7d' | '30d' | 'all'
 * @param {string} filterOptions.ticketId - 'all' | specific ticket UUID (for scoped timelines)
 * @param {string} filterOptions.buildId - 'all' | specific build UUID
 * @param {number} filterOptions.limit - Max items (default: 50)
 */
export function useActivities(filterOptions = {}) {
  const {
    type = 'all',
    dateRange = '30d',
    ticketId = 'all',
    buildId = 'all',
    limit = 50,
  } = filterOptions

  const filters = useMemo(() => {
    const f = {}

    if (type !== 'all') {
      f.activity_type = type
    }

    if (ticketId !== 'all') {
      f.ticket_id = ticketId
    }

    if (buildId !== 'all') {
      f.build_id = buildId
    }

    if (dateRange !== 'all') {
      const now = new Date()
      let start
      switch (dateRange) {
        case '24h':
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        case '7d':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case '30d':
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          start = null
      }
      if (start) {
        f.created_at_gte = start.toISOString()
      }
    }

    return f
  }, [type, dateRange, ticketId, buildId])

  const result = useRealtimeTable('activities', {
    filters,
    orderBy: 'created_at',
    ascending: false,
    limit,
    select: '*, support_tickets:ticket_id(id, ticket_number, title, status, assignee), builds:build_id(id, external_id, job_name, status)',
    realtime: true,
    realtimeTable: 'activities',
  })

  // Group activities by day for timeline display
  const groupedByDay = useMemo(() => {
    const groups = {}
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    for (const activity of result.data) {
      const date = new Date(activity.created_at).toISOString().split('T')[0]
      let label
      if (date === today) {
        label = 'TODAY'
      } else if (date === yesterday) {
        label = 'YESTERDAY'
      } else {
        label = new Date(activity.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      }

      if (!groups[label]) {
        groups[label] = { label, date, items: [] }
      }
      groups[label].items.push(activity)
    }

    return Object.values(groups)
  }, [result.data])

  return {
    ...result,
    groupedByDay,
  }
}
