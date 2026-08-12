import { useState, useEffect, useCallback } from 'react'
import { useRealtimeTable } from './useRealtimeTable'
import { supabase } from '@/config/supabase'

/**
 * Fetch all failure streaks, ordered by most recent first.
 * Polls every 30s via useRealtimeTable.
 */
export function useStreaks() {
  return useRealtimeTable('failure_streaks', {
    orderBy: 'started_at',
    ascending: false,
    limit: 50,
    realtime: true,
    realtimeTable: 'failure_streaks',
  })
}

/**
 * Fetch a single streak's detail plus its associated builds and logs.
 * Returns the streak record, timeline entries from v_failure_timeline,
 * and build_logs for builds in the streak.
 */
export function useStreakDetail(streakId) {
  const [streak, setStreak] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [buildLogs, setBuildLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchDetail = useCallback(async () => {
    if (!streakId) return
    setLoading(true)
    setError(null)

    try {
      // Fetch the streak record
      const { data: streakData, error: streakErr } = await supabase
        .from('failure_streaks')
        .select('*')
        .eq('id', streakId)
        .maybeSingle()

      if (streakErr) throw streakErr
      setStreak(streakData)

      // Fetch timeline entries for this streak
      const { data: timelineData, error: timelineErr } = await supabase
        .from('v_failure_timeline')
        .select('*')
        .eq('streak_id', streakId)
        .order('started_at', { ascending: true })

      if (timelineErr) throw timelineErr
      setTimeline(timelineData || [])

      // Fetch build logs for builds in this streak
      if (timelineData?.length > 0) {
        const buildIds = timelineData.map((t) => t.build_id)
        const { data: logsData, error: logsErr } = await supabase
          .from('build_logs')
          .select('*')
          .in('build_id', buildIds)

        if (!logsErr) {
          setBuildLogs(logsData || [])
        }
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [streakId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  // Poll every 30s
  useEffect(() => {
    if (!streakId) return
    const interval = setInterval(fetchDetail, 30000)
    return () => clearInterval(interval)
  }, [streakId, fetchDetail])

  return { streak, timeline, buildLogs, loading, error, refetch: fetchDetail }
}

/**
 * Fetch build logs for a specific build_id.
 * Used by TicketDetail to show error context.
 */
export function useBuildLogs(buildId) {
  const [buildLog, setBuildLog] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!buildId) {
      setBuildLog(null)
      return
    }

    setLoading(true)
    setError(null)

    supabase
      .from('build_logs')
      .select('*')
      .eq('build_id', buildId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) {
          setError(err)
        } else {
          setBuildLog(data)
        }
        setLoading(false)
      })
  }, [buildId])

  return { buildLog, loading, error }
}

/**
 * Returns the count of active streaks.
 * Used by the Pipeline page Failure Streaks tab badge.
 */
export function useActiveStreakCount() {
  const { data: streaks } = useStreaks()
  return (streaks || []).filter((s) => s.status === 'active').length
}

/**
 * Fetch the streak associated with a ticket's streak_id.
 * Returns the streak record with phases, upstream_commits, analysis_summary.
 */
export function useTicketStreak(streakId) {
  const [streak, setStreak] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!streakId) {
      setStreak(null)
      return
    }

    setLoading(true)

    supabase
      .from('failure_streaks')
      .select('*')
      .eq('id', streakId)
      .maybeSingle()
      .then(({ data }) => {
        setStreak(data)
        setLoading(false)
      })
  }, [streakId])

  return { streak, loading }
}
