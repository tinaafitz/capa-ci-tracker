import { useState, useCallback, useEffect } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { TicketList } from '@/components/tickets/TicketList'
import { TicketKanban } from '@/components/tickets/TicketKanban'
import { TicketDetail } from '@/components/tickets/TicketDetail'
import { TicketCreateModal } from '@/components/tickets/TicketCreateModal'
import { useTickets } from '@/hooks/useTickets'
import { useAppState, useAppActions } from '@/store/AppContext'
import { supabase } from '@/config/supabase'

/**
 * Icon for the table/list view toggle button.
 */
function TableViewIcon({ className }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 10h16M4 14h16M4 18h16"
      />
    </svg>
  )
}

/**
 * Icon for the kanban/board view toggle button.
 */
function KanbanViewIcon({ className }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 4H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V5a1 1 0 00-1-1zM9 14H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1zM19 4h-4a1 1 0 00-1 1v14a1 1 0 001 1h4a1 1 0 001-1V5a1 1 0 00-1-1z"
      />
    </svg>
  )
}

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { id: ticketIdParam } = useParams()
  const { selectedTicket, ticketDetailOpen } = useAppState()
  const { selectTicket, closeTicketDetail } = useAppActions()

  const initialAssignee = searchParams.get('assignee')
  const [viewMode, setViewMode] = useState(
    initialAssignee === 'unassigned' ? 'table' : 'kanban'
  ) // 'kanban' | 'table'
  const [kanbanFilters, setKanbanFilters] = useState({
    status: 'all',
    severity: 'all',
    assignee: 'all',
    search: '',
  })
  const [tableFilters, setTableFilters] = useState({
    status: initialAssignee === 'unassigned' ? 'all' : 'open',
    severity: 'all',
    assignee: initialAssignee === 'unassigned' ? 'unassigned' : 'all',
    search: '',
  })
  const [hideInfra, setHideInfra] = useState(false)
  const filters = viewMode === 'kanban' ? kanbanFilters : tableFilters
  const setFilters = viewMode === 'kanban' ? setKanbanFilters : setTableFilters
  const [page, setPage] = useState(1)
  const [createModalOpen, setCreateModalOpen] = useState(false)

  // Handle ?create=true from command palette
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setCreateModalOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Handle /tickets/:id deep link (e.g. from a build's linked-ticket card).
  useEffect(() => {
    if (!ticketIdParam) return
    if (selectedTicket?.id === ticketIdParam) return
    let cancelled = false
    supabase
      .from('v_ticket_summary')
      .select('*')
      .eq('id', ticketIdParam)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) selectTicket(data)
      })
    return () => {
      cancelled = true
    }
  }, [ticketIdParam, selectedTicket?.id, selectTicket])

  // Handle ?assignee=unassigned deep link (e.g. from the Activity triage banner).
  // The initial state already reflects it; consume the param so it doesn't stick.
  useEffect(() => {
    if (searchParams.get('assignee') === 'unassigned') {
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // For Kanban view, fetch all tickets (high limit, no pagination).
  // For table view, use paginated fetch.
  const isKanban = viewMode === 'kanban'

  const { data: tickets, loading, count, totalPages } = useTickets({
    ...filters,
    hideInfra,
    page: isKanban ? 1 : page,
    pageSize: isKanban ? 500 : 20,
  })

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters)
    setPage(1)
  }, [])

  const handleTicketClick = useCallback(
    (ticket) => {
      selectTicket(ticket)
    },
    [selectTicket]
  )

  const handleTicketCreated = useCallback(
    (ticket) => {
      selectTicket(ticket)
    },
    [selectTicket]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">Tickets</h2>

            {/* View toggle */}
            <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
              <button
                onClick={() => setViewMode('kanban')}
                className={`inline-flex items-center justify-center rounded-sm px-2 py-1 transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Board view"
                aria-label="Board view"
              >
                <KanbanViewIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center justify-center rounded-sm px-2 py-1 transition-colors ${
                  viewMode === 'table'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Table view"
                aria-label="Table view"
              >
                <TableViewIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Hide infra toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="relative inline-flex h-5 w-9 shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={hideInfra}
                onChange={(e) => setHideInfra(e.target.checked)}
              />
              <span className="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-amber-500" />
              <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Hide infra
            </span>
          </label>

          <Button size="sm" onClick={() => setCreateModalOpen(true)}>
            <svg
              className="mr-1.5 h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Ticket
          </Button>
        </div>
      </div>

      {/* Content area */}
      {isKanban ? (
        <div className="flex-1 overflow-hidden px-6 py-4">
          <TicketKanban
            tickets={tickets}
            loading={loading}
            onTicketClick={handleTicketClick}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          <TicketList
            tickets={tickets}
            loading={loading}
            totalCount={count}
            page={page}
            totalPages={totalPages}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onPageChange={setPage}
            onTicketClick={handleTicketClick}
          />
        </div>
      )}

      {/* Ticket detail sheet */}
      <TicketDetail
        ticket={selectedTicket}
        open={ticketDetailOpen}
        onOpenChange={(open) => {
          if (!open) closeTicketDetail()
        }}
      />

      {/* Create ticket modal */}
      <TicketCreateModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={handleTicketCreated}
      />
    </div>
  )
}
