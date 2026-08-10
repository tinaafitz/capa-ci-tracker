import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActivities } from './useActivities'

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

describe('useActivities', () => {
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries the activities table', () => {
    renderHook(() => useActivities())
    const [table] = mockUseRealtimeTable.mock.calls[0]
    expect(table).toBe('activities')
  })

  it('uses realtimeTable activities', () => {
    renderHook(() => useActivities())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.realtimeTable).toBe('activities')
  })

  it('includes join select for support_tickets and builds', () => {
    renderHook(() => useActivities())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.select).toContain('support_tickets:ticket_id')
    expect(options.select).toContain('builds:build_id')
  })

  describe('type filter', () => {
    it('type=all adds no type filter', () => {
      renderHook(() => useActivities({ type: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.activity_type).toBeUndefined()
    })

    it('specific type produces exact match', () => {
      renderHook(() => useActivities({ type: 'ticket_created' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.activity_type).toBe('ticket_created')
    })
  })

  describe('ticketId filter', () => {
    it('ticketId=all adds no ticket filter', () => {
      renderHook(() => useActivities({ ticketId: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.ticket_id).toBeUndefined()
    })

    it('specific ticketId produces exact match', () => {
      renderHook(() => useActivities({ ticketId: 'uuid-123' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.ticket_id).toBe('uuid-123')
    })
  })

  describe('buildId filter', () => {
    it('buildId=all adds no build filter', () => {
      renderHook(() => useActivities({ buildId: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.build_id).toBeUndefined()
    })

    it('specific buildId produces exact match', () => {
      renderHook(() => useActivities({ buildId: 'build-456' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.build_id).toBe('build-456')
    })
  })

  describe('date range filter', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('defaults to 24h and produces created_at_gte', () => {
      renderHook(() => useActivities())
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.created_at_gte)
      const expected = new Date('2025-06-14T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=7d produces created_at_gte 7 days ago', () => {
      renderHook(() => useActivities({ dateRange: '7d' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.created_at_gte)
      const expected = new Date('2025-06-08T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=30d produces created_at_gte 30 days ago', () => {
      renderHook(() => useActivities({ dateRange: '30d' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.created_at_gte)
      const expected = new Date('2025-05-16T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=all adds no date filter', () => {
      renderHook(() => useActivities({ dateRange: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.created_at_gte).toBeUndefined()
    })
  })

  it('defaults limit to 50', () => {
    renderHook(() => useActivities())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.limit).toBe(50)
  })

  it('respects custom limit', () => {
    renderHook(() => useActivities({ limit: 100 }))
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.limit).toBe(100)
  })

  describe('groupedByDay', () => {
    it('groups activities by date with TODAY and YESTERDAY labels', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))

      mockUseRealtimeTable.mockReturnValue({
        data: [
          { id: '1', created_at: '2025-06-15T10:00:00Z', activity_type: 'ticket_created' },
          { id: '2', created_at: '2025-06-15T08:00:00Z', activity_type: 'build_completed' },
          { id: '3', created_at: '2025-06-14T16:00:00Z', activity_type: 'ticket_updated' },
          { id: '4', created_at: '2025-06-12T10:00:00Z', activity_type: 'note_added' },
        ],
        loading: false,
        error: null,
        count: 4,
        refetch: vi.fn(),
      })

      const { result } = renderHook(() => useActivities())

      const groups = result.current.groupedByDay
      expect(groups.length).toBe(3)

      expect(groups[0].label).toBe('TODAY')
      expect(groups[0].items).toHaveLength(2)

      expect(groups[1].label).toBe('YESTERDAY')
      expect(groups[1].items).toHaveLength(1)

      // Third group should be a formatted date
      expect(groups[2].label).not.toBe('TODAY')
      expect(groups[2].label).not.toBe('YESTERDAY')
      expect(groups[2].items).toHaveLength(1)

      vi.useRealTimers()
    })

    it('returns empty array when no activities', () => {
      const { result } = renderHook(() => useActivities())
      expect(result.current.groupedByDay).toEqual([])
    })
  })

  it('spreads useRealtimeTable result plus groupedByDay', () => {
    const mockRefetch = vi.fn()
    mockUseRealtimeTable.mockReturnValue({
      data: [],
      loading: true,
      error: null,
      count: 0,
      refetch: mockRefetch,
    })

    const { result } = renderHook(() => useActivities())

    expect(result.current.data).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(result.current.refetch).toBe(mockRefetch)
    expect(result.current.groupedByDay).toBeDefined()
  })
})
