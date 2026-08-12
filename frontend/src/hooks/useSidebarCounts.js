import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Hook that fetches sidebar badge counts:
 * - openTickets: tickets with status in (new, investigating, root_caused, fix_in_progress)
 * - failedBuilds24h: builds with status = 'failure' started in the last 24 hours
 * - activeTickets: tickets not in resolved/verified status
 *
 * Polls every 30 seconds to keep counts fresh (replaces Supabase Realtime).
 */
export function useSidebarCounts() {
  const [counts, setCounts] = useState({ openTickets: 0, failedBuilds24h: 0, activeTickets: 0 })

  const fetchCounts = useCallback(async () => {
    const openStatuses = ['new', 'investigating', 'root_caused', 'fix_in_progress']
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [ticketResult, buildResult, activeResult] = await Promise.all([
      supabase
        .from('v_ticket_summary')
        .select('id', { count: 'exact', head: true })
        .in('status', openStatuses),
      supabase
        .from('builds')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failure')
        .gte('started_at', twentyFourHoursAgo),
      supabase
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("resolved","verified")'),
    ])

    setCounts({
      openTickets: ticketResult.count ?? 0,
      failedBuilds24h: buildResult.count ?? 0,
      activeTickets: activeResult.count ?? 0,
    })
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  // Poll every 30 seconds instead of Supabase Realtime
  useEffect(() => {
    const interval = setInterval(fetchCounts, 30000)
    return () => clearInterval(interval)
  }, [fetchCounts])

  return counts
}
