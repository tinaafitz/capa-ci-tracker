import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Hook that fetches triage summary counts for the Activity page banner:
 * - failedBuilds: count of builds with status = 'failure' within the given date range
 * - openTickets: count of tickets in open statuses (new, investigating, root_caused, fix_in_progress)
 * - unassignedTickets: count of open tickets with no assignee
 *
 * @param {string} dateRange - '24h' | '7d' | '30d' | 'all'
 */
export function useTriageSummary(dateRange = '24h') {
  const [stats, setStats] = useState({
    failedBuilds: 0,
    openTickets: 0,
    unassignedTickets: 0,
    loading: true,
  })

  const startDate = useMemo(() => {
    if (dateRange === 'all') return null
    const now = new Date()
    switch (dateRange) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    }
  }, [dateRange])

  const fetchStats = useCallback(async () => {
    const openStatuses = ['new', 'investigating', 'root_caused', 'fix_in_progress']

    let buildsQuery = supabase
      .from('builds')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failure')

    if (startDate) {
      buildsQuery = buildsQuery.gte('started_at', startDate)
    }

    const [buildsResult, openResult, unassignedResult] = await Promise.all([
      buildsQuery,
      supabase
        .from('v_ticket_summary')
        .select('id', { count: 'exact', head: true })
        .in('status', openStatuses),
      supabase
        .from('v_ticket_summary')
        .select('id', { count: 'exact', head: true })
        .in('status', openStatuses)
        .is('assignee', null),
    ])

    setStats({
      failedBuilds: buildsResult.count ?? 0,
      openTickets: openResult.count ?? 0,
      unassignedTickets: unassignedResult.count ?? 0,
      loading: false,
    })
  }, [startDate])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  return stats
}
