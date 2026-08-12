import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Generic Supabase Realtime subscription hook.
 * Fetches initial data and subscribes to postgres_changes for live updates.
 *
 * @param {string} table - Table or view name to query
 * @param {Object} options
 * @param {Object} options.filters - Key-value pairs for .eq() filters
 * @param {string} options.orderBy - Column to order by (default: 'created_at')
 * @param {boolean} options.ascending - Sort direction (default: false = DESC)
 * @param {number} options.limit - Max rows to fetch (default: 100)
 * @param {number} options.offset - Offset for pagination (default: 0)
 * @param {string} options.select - Columns to select (default: '*')
 * @param {boolean} options.realtime - Whether to subscribe to realtime (default: true)
 * @param {string} options.realtimeTable - Actual table name for realtime (if querying a view)
 * @returns {{ data: Array, loading: boolean, error: Error|null, count: number, refetch: Function }}
 */
export function useRealtimeTable(table, options = {}) {
  const {
    filters = {},
    orderBy = 'created_at',
    ascending = false,
    limit = 100,
    offset = 0,
    select = '*',
    realtime = true,
    realtimeTable = null,
  } = options

  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [count, setCount] = useState(0)
  const channelRef = useRef(null)

  const filtersKey = JSON.stringify(filters)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from(table)
        .select(select, { count: 'exact' })
        .order(orderBy, { ascending })
        .range(offset, offset + limit - 1)

      const parsedFilters = JSON.parse(filtersKey)
      for (const [key, value] of Object.entries(parsedFilters)) {
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
  }, [table, select, orderBy, ascending, limit, offset, filtersKey])

  // Initial fetch
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Realtime subscription
  useEffect(() => {
    if (!realtime) return

    const subscriptionTable = realtimeTable || table
    const channelName = `${table}-${subscriptionTable}-changes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: subscriptionTable },
        () => {
          // Refetch instead of blindly prepending -- the new row may not
          // match current filters, and realtime payloads don't include
          // joined/computed columns from select queries
          fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: subscriptionTable },
        () => {
          // Refetch to get full row shape including joins
          fetchData()
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: subscriptionTable },
        () => {
          fetchData()
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [table, realtime, realtimeTable, fetchData])

  return { data, loading, error, count, refetch: fetchData }
}
