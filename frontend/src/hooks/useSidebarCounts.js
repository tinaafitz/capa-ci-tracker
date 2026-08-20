import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Hook that fetches sidebar badge counts:
 * - openTickets: tickets with status in (new, investigating, root_caused, fix_in_progress)
 * - failedBuilds: builds with status = 'failure'
 * - activeTickets: tickets not in resolved/verified status
 *
 * Polls every 30 seconds to keep counts fresh (replaces Supabase Realtime).
 */
export function useSidebarCounts() {
  const [counts, setCounts] = useState({ openTickets: 0, failedBuilds: 0, activeTickets: 0 })

  const fetchCounts = useCallback(async () => {
    const openStatuses = ['new', 'investigating', 'root_caused', 'fix_in_progress']

    const [ticketResult, buildResult, activeResult] = await Promise.all([
      supabase
        .from('v_ticket_summary')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('builds')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failure'),
      supabase
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("resolved","verified")'),
    ])

    setCounts({
      openTickets: ticketResult.count ?? 0,
      failedBuilds: buildResult.count ?? 0,
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
