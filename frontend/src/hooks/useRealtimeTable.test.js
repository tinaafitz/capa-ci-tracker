import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRealtimeTable } from './useRealtimeTable'

// Build a query builder mock that we can inspect and control
let mockQueryResult = { data: [], error: null, count: 0 }
const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  neq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  // `then` makes the builder thenable so `await query` works
  then: vi.fn((resolve) => resolve(mockQueryResult)),
}

const mockChannelOn = vi.fn().mockReturnThis()
const mockSubscribe = vi.fn().mockReturnThis()
const mockChannel = {
  on: mockChannelOn,
  subscribe: mockSubscribe,
  unsubscribe: vi.fn(),
}

const mockRemoveChannel = vi.fn()
const mockFrom = vi.fn(() => mockQueryBuilder)
const mockChannelFn = vi.fn(() => mockChannel)

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    channel: (...args) => mockChannelFn(...args),
    removeChannel: (...args) => mockRemoveChannel(...args),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}))

describe('useRealtimeTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResult = { data: [], error: null, count: 0 }
    // Reset the thenable
    mockQueryBuilder.then.mockImplementation((resolve) => resolve(mockQueryResult))
  })

  it('fetches data from the specified table on mount', async () => {
    mockQueryResult = {
      data: [{ id: '1', name: 'test' }],
      error: null,
      count: 1,
    }

    const { result } = renderHook(() => useRealtimeTable('builds'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockFrom).toHaveBeenCalledWith('builds')
    expect(result.current.data).toEqual([{ id: '1', name: 'test' }])
    expect(result.current.count).toBe(1)
  })

  it('passes select, order, and range to the query builder', async () => {
    renderHook(() =>
      useRealtimeTable('builds', {
        select: 'id, job_name, status',
        orderBy: 'started_at',
        ascending: true,
        limit: 10,
        offset: 20,
      })
    )

    await waitFor(() => {
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('id, job_name, status', { count: 'exact' })
    })

    expect(mockQueryBuilder.order).toHaveBeenCalledWith('started_at', { ascending: true })
    expect(mockQueryBuilder.range).toHaveBeenCalledWith(20, 29) // offset + limit - 1
  })

  describe('filter operators', () => {
    it('applies eq filter for plain keys', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { status: 'failure' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.eq).toHaveBeenCalledWith('status', 'failure')
      })
    })

    it('applies gte filter for _gte suffix', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { started_at_gte: '2025-06-01T00:00:00Z' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.gte).toHaveBeenCalledWith('started_at', '2025-06-01T00:00:00Z')
      })
    })

    it('applies lte filter for _lte suffix', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { created_at_lte: '2025-06-30T00:00:00Z' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.lte).toHaveBeenCalledWith('created_at', '2025-06-30T00:00:00Z')
      })
    })

    it('applies ilike filter for _ilike suffix with wildcards', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { title_ilike: 'cluster' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.ilike).toHaveBeenCalledWith('title', '%cluster%')
      })
    })

    it('applies in filter for _in suffix', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { status_in: ['new', 'investigating'] },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.in).toHaveBeenCalledWith('status', ['new', 'investigating'])
      })
    })

    it('applies neq filter for _neq suffix', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { status_neq: 'verified' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.neq).toHaveBeenCalledWith('status', 'verified')
      })
    })

    it('skips null, undefined, empty string, and "all" filter values', async () => {
      renderHook(() =>
        useRealtimeTable('builds', {
          filters: { a: null, b: undefined, c: '', d: 'all' },
        })
      )

      await waitFor(() => {
        expect(mockQueryBuilder.eq).not.toHaveBeenCalled()
      })
    })
  })

  describe('error handling', () => {
    it('sets error state when query fails', async () => {
      const fetchError = { message: 'Permission denied' }
      mockQueryResult = { data: null, error: fetchError, count: null }

      const { result } = renderHook(() => useRealtimeTable('builds'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toEqual(fetchError)
      expect(result.current.data).toEqual([])
      expect(result.current.count).toBe(0)
    })

    it('handles exception during fetch', async () => {
      mockQueryBuilder.then.mockImplementation(() => {
        throw new Error('Network failure')
      })

      const { result } = renderHook(() => useRealtimeTable('builds'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error.message).toBe('Network failure')
      expect(result.current.data).toEqual([])
    })
  })

  describe('realtime subscription', () => {
    it('subscribes to postgres_changes for INSERT, UPDATE, DELETE', async () => {
      renderHook(() =>
        useRealtimeTable('builds', { realtime: true })
      )

      await waitFor(() => {
        expect(mockChannelFn).toHaveBeenCalled()
      })

      // Should subscribe to all three event types
      const onCalls = mockChannelOn.mock.calls
      expect(onCalls.length).toBe(3)

      const events = onCalls.map((call) => call[1].event)
      expect(events).toContain('INSERT')
      expect(events).toContain('UPDATE')
      expect(events).toContain('DELETE')
    })

    it('uses realtimeTable when specified (for view queries)', async () => {
      renderHook(() =>
        useRealtimeTable('v_ticket_summary', {
          realtime: true,
          realtimeTable: 'support_tickets',
        })
      )

      await waitFor(() => {
        expect(mockChannelOn).toHaveBeenCalled()
      })

      // The subscription should be on support_tickets, not v_ticket_summary
      const firstOnCall = mockChannelOn.mock.calls[0]
      expect(firstOnCall[1].table).toBe('support_tickets')
    })

    it('does not subscribe when realtime is false', async () => {
      renderHook(() =>
        useRealtimeTable('builds', { realtime: false })
      )

      // Wait for fetch to complete
      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalled()
      })

      expect(mockChannelFn).not.toHaveBeenCalled()
    })

    it('removes channel on unmount', async () => {
      const { unmount } = renderHook(() =>
        useRealtimeTable('builds', { realtime: true })
      )

      await waitFor(() => {
        expect(mockChannelFn).toHaveBeenCalled()
      })

      unmount()

      expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel)
    })
  })

  it('exposes a refetch function', async () => {
    const { result } = renderHook(() => useRealtimeTable('builds'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(typeof result.current.refetch).toBe('function')

    // Update mock data and refetch
    mockQueryResult = { data: [{ id: 'new' }], error: null, count: 1 }

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toEqual([{ id: 'new' }])
  })

  it('uses default options when none provided', async () => {
    renderHook(() => useRealtimeTable('builds'))

    await waitFor(() => {
      expect(mockQueryBuilder.select).toHaveBeenCalledWith('*', { count: 'exact' })
    })

    expect(mockQueryBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(mockQueryBuilder.range).toHaveBeenCalledWith(0, 99) // default limit 100, offset 0
  })
})
