import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Hook that fetches sidebar badge counts:
 * - openTickets: tickets with status in (new, investigating, root_caused, fix_in_progress)
 * - failedBuilds24h: builds with status = 'failure' started in the last 24 hours
 *
 * Subscribes to realtime changes on support_tickets and builds tables
 * so counts stay current without polling.
 */
export function useSidebarCounts() {
  const [counts, setCounts] = useState({ openTickets: 0, failedBuilds24h: 0 })
  const channelRef = useRef(null)

  const fetchCounts = useCallback(async () => {
    const openStatuses = ['new', 'investigating', 'root_caused', 'fix_in_progress']
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [ticketResult, buildResult] = await Promise.all([
      supabase
        .from('v_ticket_summary')
        .select('id', { count: 'exact', head: true })
        .in('status', openStatuses),
      supabase
        .from('builds')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failure')
        .gte('started_at', twentyFourHoursAgo),
    ])

    setCounts({
      openTickets: ticketResult.count ?? 0,
      failedBuilds24h: buildResult.count ?? 0,
    })
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  // Realtime subscriptions to keep counts fresh
  useEffect(() => {
    const channelName = `sidebar-counts-${Date.now()}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets' },
        () => fetchCounts()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'builds' },
        () => fetchCounts()
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [fetchCounts])

  return counts
}
