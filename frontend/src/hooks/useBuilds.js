import { useMemo, useState, useEffect } from 'react'
import { useRealtimeTable } from './useRealtimeTable'
import { supabase } from '@/config/supabase'

/**
 * Hook for fetching and subscribing to builds.
 *
 * @param {Object} filterOptions
 * @param {string} filterOptions.job - 'all' | specific job_name
 * @param {string} filterOptions.status - 'all' | specific build_status
 * @param {string} filterOptions.dateRange - '24h' | '7d' | '30d' | 'all'
 * @param {string} filterOptions.source - 'all' | 'jenkins' | 'prow'
 * @param {number} filterOptions.page - Page number (1-indexed)
 * @param {number} filterOptions.pageSize - Items per page (default: 20)
 */
export function useBuilds(filterOptions = {}) {
  const {
    job = 'all',
    status = 'all',
    dateRange = '7d',
    source = 'all',
    page = 1,
    pageSize = 20,
  } = filterOptions

  const filters = useMemo(() => {
    const f = {}

    if (job !== 'all') {
      f.job_name = job
    }

    if (status !== 'all') {
      f.status = status
    }

    if (source !== 'all') {
      f.source = source
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
        f.started_at_gte = start.toISOString()
      }
    }

    return f
  }, [job, status, dateRange, source])

  const offset = (page - 1) * pageSize

  const result = useRealtimeTable('builds', {
    filters,
    orderBy: 'started_at',
    ascending: false,
    limit: pageSize,
    offset,
    realtime: true,
  })

  const totalPages = Math.ceil(result.count / pageSize)

  return {
    ...result,
    totalPages,
    page,
    pageSize,
  }
}

/**
 * Fetch daily build stats for the trend chart.
 * Returns aggregated pass/fail/skip counts per day for the last N days.
 */
export function useBuildTrendData(days = 30) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchTrend() {
      setLoading(true)
      try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

        const { data: builds, error: fetchError } = await supabase
          .from('builds')
          .select('started_at, status, pass_count, fail_count, skip_count')
          .gte('started_at', since)
          .order('started_at', { ascending: true })
          .limit(1000)

        if (fetchError) {
          setError(fetchError)
          setData([])
          return
        }

        // Group by date
        const grouped = {}
        for (const build of builds || []) {
          const date = new Date(build.started_at).toISOString().split('T')[0]
          if (!grouped[date]) {
            grouped[date] = { date, pass: 0, fail: 0, skip: 0, total: 0 }
          }
          grouped[date].pass += build.pass_count || 0
          grouped[date].fail += build.fail_count || 0
          grouped[date].skip += build.skip_count || 0
          grouped[date].total += 1
        }

        setData(Object.values(grouped))
      } catch (err) {
        setError(err)
        setData([])
      } finally {
        setLoading(false)
      }
    }

    fetchTrend()
  }, [days])

  return { data, loading, error }
}
