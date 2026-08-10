import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTickets, useTicketDetail } from './useTickets'

// Mock useRealtimeTable so we can inspect the arguments it receives
// without needing a real Supabase connection.
const mockUseRealtimeTable = vi.fn().mockReturnValue({
  data: [],
  loading: false,
  error: null,
  count: 0,
  refetch: vi.fn(),
})

vi.mock('./useRealtimeTable', () => ({
  useRealtimeTable: (...args) => mockUseRealtimeTable(...args),
}))

describe('useTickets', () => {
  beforeEach(() => {
    mockUseRealtimeTable.mockClear()
    mockUseRealtimeTable.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      count: 0,
      refetch: vi.fn(),
    })
  })

  it('queries v_ticket_summary, not support_tickets', () => {
    renderHook(() => useTickets())
    const [table] = mockUseRealtimeTable.mock.calls[0]
    expect(table).toBe('v_ticket_summary')
  })

  it('uses support_tickets as the realtimeTable', () => {
    renderHook(() => useTickets())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.realtimeTable).toBe('support_tickets')
  })

  describe('status filter', () => {
    it('defaults to open which produces status_in with 4 statuses', () => {
      renderHook(() => useTickets())
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters).toEqual({
        status_in: ['new', 'investigating', 'root_caused', 'fix_in_progress'],
      })
    })

    it('status=all produces no status filter', () => {
      renderHook(() => useTickets({ status: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.status_in).toBeUndefined()
      expect(options.filters.status).toBeUndefined()
    })

    it('specific status produces exact match filter', () => {
      renderHook(() => useTickets({ status: 'investigating' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.status).toBe('investigating')
      expect(options.filters.status_in).toBeUndefined()
    })

    it('status=resolved produces exact match on resolved', () => {
      renderHook(() => useTickets({ status: 'resolved' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.status).toBe('resolved')
    })
  })

  describe('severity filter', () => {
    it('severity=all adds no severity filter', () => {
      renderHook(() => useTickets({ severity: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.severity).toBeUndefined()
    })

    it('specific severity produces exact match', () => {
      renderHook(() => useTickets({ severity: 'nightly_blocker' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.severity).toBe('nightly_blocker')
    })
  })

  describe('assignee filter', () => {
    it('assignee=all adds no assignee filter', () => {
      renderHook(() => useTickets({ assignee: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.assignee).toBeUndefined()
    })

    it('specific assignee produces exact match', () => {
      renderHook(() => useTickets({ assignee: 'alice@redhat.com' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.assignee).toBe('alice@redhat.com')
    })
  })

  describe('search filter', () => {
    it('empty search string adds no search filter', () => {
      renderHook(() => useTickets({ search: '' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.title_ilike).toBeUndefined()
    })

    it('non-empty search produces title_ilike filter', () => {
      renderHook(() => useTickets({ search: 'cluster' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.title_ilike).toBe('cluster')
    })
  })

  describe('pagination', () => {
    it('page 1 with pageSize 20 produces offset 0', () => {
      renderHook(() => useTickets({ page: 1, pageSize: 20 }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.offset).toBe(0)
      expect(options.limit).toBe(20)
    })

    it('page 3 with pageSize 20 produces offset 40', () => {
      renderHook(() => useTickets({ page: 3, pageSize: 20 }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.offset).toBe(40)
    })

    it('page 2 with pageSize 10 produces offset 10', () => {
      renderHook(() => useTickets({ page: 2, pageSize: 10 }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.offset).toBe(10)
      expect(options.limit).toBe(10)
    })
  })

  describe('totalPages calculation', () => {
    it('calculates totalPages from count and pageSize', () => {
      mockUseRealtimeTable.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        count: 45,
        refetch: vi.fn(),
      })
      const { result } = renderHook(() => useTickets({ pageSize: 20 }))
      expect(result.current.totalPages).toBe(3) // ceil(45/20)
    })

    it('returns 0 totalPages when count is 0', () => {
      mockUseRealtimeTable.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        count: 0,
        refetch: vi.fn(),
      })
      const { result } = renderHook(() => useTickets())
      expect(result.current.totalPages).toBe(0)
    })
  })

  it('orders by created_at descending', () => {
    renderHook(() => useTickets())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.orderBy).toBe('created_at')
    expect(options.ascending).toBe(false)
  })

  it('enables realtime', () => {
    renderHook(() => useTickets())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.realtime).toBe(true)
  })

  it('combines multiple filters', () => {
    renderHook(() =>
      useTickets({
        status: 'investigating',
        severity: 'nightly_blocker',
        assignee: 'bob@redhat.com',
        search: 'vpc',
      })
    )
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.filters).toEqual({
      status: 'investigating',
      severity: 'nightly_blocker',
      assignee: 'bob@redhat.com',
      title_ilike: 'vpc',
    })
  })

  it('spreads result properties onto return value', () => {
    const mockRefetch = vi.fn()
    mockUseRealtimeTable.mockReturnValue({
      data: [{ id: '1' }],
      loading: true,
      error: null,
      count: 1,
      refetch: mockRefetch,
    })
    const { result } = renderHook(() => useTickets())
    expect(result.current.data).toEqual([{ id: '1' }])
    expect(result.current.loading).toBe(true)
    expect(result.current.refetch).toBe(mockRefetch)
    expect(result.current.page).toBe(1)
    expect(result.current.pageSize).toBe(20)
  })
})

describe('useTicketDetail', () => {
  beforeEach(() => {
    mockUseRealtimeTable.mockClear()
    mockUseRealtimeTable.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      count: 0,
      refetch: vi.fn(),
    })
  })

  it('queries support_tickets (not the view) with id filter', () => {
    renderHook(() => useTicketDetail('abc-123'))
    const [table, options] = mockUseRealtimeTable.mock.calls[0]
    expect(table).toBe('support_tickets')
    expect(options.filters).toEqual({ id: 'abc-123' })
  })

  it('passes empty filters when ticketId is null', () => {
    renderHook(() => useTicketDetail(null))
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.filters).toEqual({})
  })

  it('includes builds join in select', () => {
    renderHook(() => useTicketDetail('abc-123'))
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.select).toContain('builds:build_id')
  })

  it('limits to 1 row', () => {
    renderHook(() => useTicketDetail('abc-123'))
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.limit).toBe(1)
  })

  it('returns first data item as ticket', () => {
    const mockTicket = { id: 'abc-123', title: 'Test Ticket' }
    mockUseRealtimeTable.mockReturnValue({
      data: [mockTicket],
      loading: false,
      error: null,
      count: 1,
      refetch: vi.fn(),
    })
    const { result } = renderHook(() => useTicketDetail('abc-123'))
    expect(result.current.ticket).toEqual(mockTicket)
  })

  it('returns null ticket when data is empty', () => {
    const { result } = renderHook(() => useTicketDetail('nonexistent'))
    expect(result.current.ticket).toBeNull()
  })
})
