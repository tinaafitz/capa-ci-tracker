import { useMemo } from 'react'
import { useRealtimeTable } from './useRealtimeTable'

export function useLifecyclePipeline(filterOptions = {}) {
  const { severity, dateRange, stageFilter } = filterOptions

  const filters = useMemo(() => {
    const f = {}
    if (severity && severity !== 'all') f.severity = severity
    if (stageFilter && stageFilter !== 'all') f.pipeline_stage = parseInt(stageFilter, 10)
    if (dateRange && dateRange !== 'all') {
      const days = parseInt(dateRange, 10)
      if (!isNaN(days)) {
        f.ticket_created_at_gte = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      }
    }
    return f
  }, [severity, dateRange, stageFilter])

  return useRealtimeTable('v_ticket_lifecycle', {
    filters,
    orderBy: 'ticket_created_at',
    ascending: false,
    limit: 200,
    realtime: true,
    realtimeTable: 'support_tickets',
  })
}

export function usePipelineFunnel() {
  return useRealtimeTable('v_pipeline_funnel', {
    orderBy: 'stage_ordinal',
    ascending: true,
    limit: 10,
    realtime: true,
    realtimeTable: 'support_tickets',
  })
}
