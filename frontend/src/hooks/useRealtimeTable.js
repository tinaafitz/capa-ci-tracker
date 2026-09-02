import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Generic data-fetching hook with optional polling.
 * Replaces the Supabase Realtime subscription with setInterval polling
 * for PostgREST / OpenShift deployment.
 *
 * @param {string} table - Table or view name to query
 * @param {Object} options
 * @param {Object} options.filters - Key-value pairs for filter operators
 * @param {string} options.orderBy - Column to order by (default: 'created_at')
 * @param {boolean} options.ascending - Sort direction (default: false = DESC)
 * @param {string} options.secondaryOrderBy - Optional secondary/tie-break column (default: null).
 *   Use e.g. 'rowid' on base tables for a deterministic insertion-order tie-break.
 * @param {boolean} options.secondaryAscending - Secondary sort direction (default: false = DESC)
 * @param {number} options.limit - Max rows to fetch (default: 100)
 * @param {number} options.offset - Offset for pagination (default: 0)
 * @param {string} options.select - Columns to select (default: '*')
 * @param {boolean} options.realtime - Whether to enable polling (default: true)
 * @param {string} options.realtimeTable - Unused, kept for API compat
 * @returns {{ data: Array, loading: boolean, error: Error|null, count: number, refetch: Function }}
 */
export function useRealtimeTable(table, options = {}) {
  const {
    filters = {},
    orderBy = 'created_at',
    ascending = false,
    secondaryOrderBy = null,
    secondaryAscending = false,
    limit = 100,
    offset = 0,
    select = '*',
    realtime = true,
  } = options

  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [count, setCount] = useState(0)

  const filtersKey = JSON.stringify(filters)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from(table)
        .select(select, { count: 'exact' })
        .order(orderBy, { ascending })

      // Optional deterministic tie-break (e.g. rowid for insertion order).
      // Chained before .range so it becomes the second comma-separated order key.
      if (secondaryOrderBy) {
        query = query.order(secondaryOrderBy, { ascending: secondaryAscending })
      }

      query = query.range(offset, offset + limit - 1)

      const parsedFilters = JSON.parse(filtersKey)
      for (const [key, value] of Object.entries(parsedFilters)) {
        // `_is` handles IS NULL / IS NOT NULL. Value may legitimately be null,
        // so process it before the generic skip below.
        if (key.endsWith('_is')) {
          query = query.is(key.replace('_is', ''), value)
          continue
        }

        if (value === null || value === undefined || value === 'all' || value === '') continue

        if (key.endsWith('_gte')) {
          query = query.gte(key.replace('_gte', ''), value)
        } else if (key.endsWith('_lte')) {
          query = query.lte(key.replace('_lte', ''), value)
        } else if (key.endsWith('_ilike')) {
          query = query.ilike(key.replace('_ilike', ''), `%${value}%`)
        } else if (key.endsWith('_in')) {
          query = query.in(key.replace('_in', ''), value)
        } else if (key.endsWith('_neq')) {
          query = query.neq(key.replace('_neq', ''), value)
        } else {
          query = query.eq(key, value)
        }
      }

      const { data: rows, error: fetchError, count: totalCount } = await query

      if (fetchError) {
        setError(fetchError)
        setData([])
        setCount(0)
      } else {
        setData(rows || [])
        setCount(totalCount || 0)
      }
    } catch (err) {
      setError(err)
      setData([])
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [table, select, orderBy, ascending, secondaryOrderBy, secondaryAscending, limit, offset, filtersKey])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Poll every 30 seconds instead of Supabase Realtime
  useEffect(() => {
    if (!realtime) return
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [realtime, fetchData])

  return { data, loading, error, count, refetch: fetchData }
}
