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
 * @param {boolean} filterOptions.hideInfra - When true, filter out infra/harness failures (is_infra=0)
 * @param {number} filterOptions.page - Page number (1-indexed)
 * @param {number} filterOptions.pageSize - Items per page (default: 20)
 */
function buildBuildFilters({ job = 'all', status = 'all', dateRange = '7d', source = 'all', hideInfra = false }) {
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

  if (hideInfra) {
    f.is_infra = 0
  }

  return f
}

export function useBuilds(filterOptions = {}) {
  const {
    job = 'all',
    status = 'all',
    dateRange = '7d',
    source = 'all',
    hideInfra = false,
    page = 1,
    pageSize = 20,
  } = filterOptions

  const filters = useMemo(
    () => buildBuildFilters({ job, status, dateRange, source, hideInfra }),
    [job, status, dateRange, source, hideInfra]
  )

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
 * Fetch unpaginated builds matching the same filters as the table and
 * compute KPI stats (total, pass rate, failed count, avg duration, infraFailed count).
 *
 * @param {Object} filterOptions - { job, status, dateRange, source, hideInfra }
 */
export function useBuildStats(filterOptions = {}) {
  const {
    job = 'all',
    status = 'all',
    dateRange = '7d',
    source = 'all',
    // hideInfra is intentionally ignored here: stats always count all builds
    // (including infra) so the "N infra" sub-count is always visible regardless
    // of the hide toggle.
  } = filterOptions

  const [stats, setStats] = useState({
    total: 0,
    passRate: null,
    failed: 0,
    infraFailed: 0,
    avgDurationMs: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Always fetch without hideInfra so we can compute infraFailed count regardless
  const filters = useMemo(
    () => buildBuildFilters({ job, status, dateRange, source, hideInfra: false }),
    [job, status, dateRange, source]
  )

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      setLoading(true)
      try {
        let query = supabase
          .from('builds')
          .select('status, duration_ms, is_infra')
          .limit(2000)

        for (const [key, value] of Object.entries(filters)) {
          if (key.endsWith('_gte')) {
            query = query.gte(key.slice(0, -4), value)
          } else if (key.endsWith('_lte')) {
            query = query.lte(key.slice(0, -4), value)
          } else {
            query = query.eq(key, value)
          }
        }

        const { data, error: fetchError } = await query

        if (cancelled) return

        if (fetchError) {
          setError(fetchError)
          setStats({ total: 0, passRate: null, failed: 0, infraFailed: 0, avgDurationMs: null })
          return
        }

        const rows = data || []
        const total = rows.length
        let passed = 0
        let failed = 0
        let infraFailed = 0
        let durationSum = 0
        let durationCount = 0

        for (const row of rows) {
          if (row.status === 'success') passed += 1
          else if (row.status === 'failure') {
            failed += 1
            if (row.is_infra === 1 || row.is_infra === '1') infraFailed += 1
          }

          if (row.duration_ms != null) {
            durationSum += row.duration_ms
            durationCount += 1
          }
        }

        setStats({
          total,
          passRate: total > 0 ? Math.round((passed / total) * 100) : null,
          failed,
          infraFailed,
          avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
        })
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err)
          setStats({ total: 0, passRate: null, failed: 0, infraFailed: 0, avgDurationMs: null })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchStats()
    return () => {
      cancelled = true
    }
  }, [filters])

  return { stats, loading, error }
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
          .select('started_at, status')
          .gte('started_at', since)
          .order('started_at', { ascending: true })
          .limit(1000)

        if (fetchError) {
          setError(fetchError)
          setData([])
          return
        }

        // Group by date — count builds by status, not individual test counts
        const grouped = {}
        for (const build of builds || []) {
          const date = new Date(build.started_at).toISOString().split('T')[0]
          if (!grouped[date]) {
            grouped[date] = { date, pass: 0, fail: 0, skip: 0, total: 0 }
          }
          if (build.status === 'success') grouped[date].pass += 1
          else if (build.status === 'failure') grouped[date].fail += 1
          else grouped[date].skip += 1
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
