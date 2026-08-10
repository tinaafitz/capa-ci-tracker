import { useState, useEffect } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Fetches SOP mappings for a given diagnosis pattern type.
 * No realtime subscription -- SOP mappings change rarely (admin action only).
 *
 * @param {string|null} matchedPattern - The diagnosis pattern type to look up
 * @returns {{ sops: Array, loading: boolean, error: Error|null }}
 */
export function useSopMappings(matchedPattern) {
  const [sops, setSops] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!matchedPattern) {
      setSops([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('sop_mappings')
      .select('*')
      .eq('pattern_type', matchedPattern)
      .order('created_at', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError)
          setSops([])
        } else {
          setSops(data || [])
        }
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [matchedPattern])

  return { sops, loading, error }
}
