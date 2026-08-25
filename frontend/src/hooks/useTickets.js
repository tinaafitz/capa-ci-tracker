import { useMemo } from 'react'
import { useRealtimeTable } from './useRealtimeTable'

/**
 * Hook for fetching and subscribing to support tickets.
 * Queries the v_ticket_summary view for enriched ticket data,
 * with realtime subscription on the support_tickets table.
 *
 * @param {Object} filterOptions
 * @param {string} filterOptions.status - 'open' | 'all' | specific status
 * @param {string} filterOptions.severity - 'all' | specific severity
 * @param {string} filterOptions.assignee - 'all' | specific assignee
 * @param {string} filterOptions.search - Search string for title/ticket_number
 * @param {boolean} filterOptions.hideInfra - When true, filter out infra/harness tickets (is_infra=0)
 * @param {number} filterOptions.page - Page number (1-indexed)
 * @param {number} filterOptions.pageSize - Items per page (default: 20)
 */
export function useTickets(filterOptions = {}) {
  const {
    status = 'open',
    severity = 'all',
    assignee = 'all',
    search = '',
    hideInfra = false,
    page = 1,
    pageSize = 20,
  } = filterOptions

  const filters = useMemo(() => {
    const f = {}

    // "open" means all non-resolved/non-verified tickets
    if (status === 'open') {
      f.status_in = ['new', 'investigating', 'root_caused', 'fix_in_progress']
    } else if (status !== 'all') {
      f.status = status
    }

    if (severity !== 'all') {
      f.severity = severity
    }

    if (assignee === 'unassigned') {
      f.assignee_is = null
    } else if (assignee !== 'all') {
      f.assignee = assignee
    }

    if (search) {
      f.title_ilike = search
    }

    if (hideInfra) {
      f.is_infra = 0
    }

    return f
  }, [status, severity, assignee, search, hideInfra])

  const offset = (page - 1) * pageSize

  const result = useRealtimeTable('v_ticket_summary', {
    filters,
    orderBy: 'created_at',
    ascending: false,
    limit: pageSize,
    offset,
    select: '*',
    realtime: true,
    realtimeTable: 'support_tickets',
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
 * Fetch a single ticket by ID with full details.
 */
export function useTicketDetail(ticketId) {
  const filters = useMemo(() => {
    if (!ticketId) return {}
    return { id: ticketId }
  }, [ticketId])

  const result = useRealtimeTable('support_tickets', {
    filters,
    select: '*, builds:build_id(id, external_id, job_name, job_url, status, test_failures, pass_count, fail_count, skip_count, ocp_version, started_at, finished_at), verify_build:verified_in_build_id(id, external_id, job_name, job_url)',
    limit: 1,
    realtime: true,
    realtimeTable: 'support_tickets',
  })

  return {
    ticket: result.data?.[0] || null,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
  }
}
