import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBuilds, useBuildTrendData } from './useBuilds'

// Mock useRealtimeTable for useBuilds tests
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

// Mock the supabase client for useBuildTrendData
const mockQueryBuilder = {
  select: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: vi.fn((resolve) => resolve({ data: [], error: null })),
}

vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockQueryBuilder),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}))

describe('useBuilds', () => {
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

  it('queries the builds table', () => {
    renderHook(() => useBuilds())
    const [table] = mockUseRealtimeTable.mock.calls[0]
    expect(table).toBe('builds')
  })

  it('orders by started_at descending', () => {
    renderHook(() => useBuilds())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.orderBy).toBe('started_at')
    expect(options.ascending).toBe(false)
  })

  describe('job filter', () => {
    it('job=all adds no job filter', () => {
      renderHook(() => useBuilds({ job: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.job_name).toBeUndefined()
    })

    it('specific job produces exact match', () => {
      renderHook(() => useBuilds({ job: 'e2e-rosa-hcp' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.job_name).toBe('e2e-rosa-hcp')
    })
  })

  describe('status filter', () => {
    it('status=all adds no status filter', () => {
      renderHook(() => useBuilds({ status: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.status).toBeUndefined()
    })

    it('specific status produces exact match', () => {
      renderHook(() => useBuilds({ status: 'failure' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.status).toBe('failure')
    })
  })

  describe('source filter', () => {
    it('source=all adds no source filter', () => {
      renderHook(() => useBuilds({ source: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.source).toBeUndefined()
    })

    it('specific source produces exact match', () => {
      renderHook(() => useBuilds({ source: 'jenkins' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.source).toBe('jenkins')
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

    it('dateRange=24h produces started_at_gte 24 hours before now', () => {
      renderHook(() => useBuilds({ dateRange: '24h' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.started_at_gte)
      const expected = new Date('2025-06-14T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=7d produces started_at_gte 7 days before now', () => {
      renderHook(() => useBuilds({ dateRange: '7d' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.started_at_gte)
      const expected = new Date('2025-06-08T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=30d produces started_at_gte 30 days before now', () => {
      renderHook(() => useBuilds({ dateRange: '30d' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      const gte = new Date(options.filters.started_at_gte)
      const expected = new Date('2025-05-16T12:00:00Z')
      expect(gte.getTime()).toBe(expected.getTime())
    })

    it('dateRange=all adds no date filter', () => {
      renderHook(() => useBuilds({ dateRange: 'all' }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.filters.started_at_gte).toBeUndefined()
    })
  })

  describe('pagination', () => {
    it('page 1 with pageSize 20 produces offset 0', () => {
      renderHook(() => useBuilds({ page: 1, pageSize: 20 }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.offset).toBe(0)
      expect(options.limit).toBe(20)
    })

    it('page 4 with pageSize 20 produces offset 60', () => {
      renderHook(() => useBuilds({ page: 4, pageSize: 20 }))
      const [, options] = mockUseRealtimeTable.mock.calls[0]
      expect(options.offset).toBe(60)
    })
  })

  describe('totalPages calculation', () => {
    it('calculates totalPages from count and pageSize', () => {
      mockUseRealtimeTable.mockReturnValue({
        data: [],
        loading: false,
        error: null,
        count: 55,
        refetch: vi.fn(),
      })
      const { result } = renderHook(() => useBuilds({ pageSize: 20 }))
      expect(result.current.totalPages).toBe(3) // ceil(55/20)
    })
  })

  it('enables realtime', () => {
    renderHook(() => useBuilds())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    expect(options.realtime).toBe(true)
  })

  it('defaults dateRange to 7d', () => {
    renderHook(() => useBuilds())
    const [, options] = mockUseRealtimeTable.mock.calls[0]
    // 7d default should produce a started_at_gte filter
    expect(options.filters.started_at_gte).toBeDefined()
  })
})

describe('useBuildTrendData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in loading state', () => {
    // Make the query never resolve immediately
    mockQueryBuilder.then.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useBuildTrendData(30))
    expect(result.current.loading).toBe(true)
  })

  it('returns data grouped by date, counting builds by status', async () => {
    // The trend aggregates whole builds by their status (success -> pass,
    // failure -> fail, anything else -> skip), NOT individual test counts.
    const mockBuilds = [
      { started_at: '2025-06-14T10:00:00Z', status: 'failure' },
      { started_at: '2025-06-14T14:00:00Z', status: 'success' },
      { started_at: '2025-06-15T08:00:00Z', status: 'failure' },
    ]

    mockQueryBuilder.then.mockImplementation((resolve) =>
      resolve({ data: mockBuilds, error: null })
    )

    const { result } = renderHook(() => useBuildTrendData(30))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toHaveLength(2) // 2 distinct dates
    const day1 = result.current.data.find((d) => d.date === '2025-06-14')
    expect(day1.pass).toBe(1) // 1 success build
    expect(day1.fail).toBe(1) // 1 failure build
    expect(day1.total).toBe(2) // 2 builds on that date

    const day2 = result.current.data.find((d) => d.date === '2025-06-15')
    expect(day2.pass).toBe(0)
    expect(day2.fail).toBe(1)
    expect(day2.skip).toBe(0)
    expect(day2.total).toBe(1)
  })

  it('handles fetch error gracefully', async () => {
    const fetchError = { message: 'Network error' }
    mockQueryBuilder.then.mockImplementation((resolve) =>
      resolve({ data: null, error: fetchError })
    )

    const { result } = renderHook(() => useBuildTrendData(30))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toEqual(fetchError)
    expect(result.current.data).toEqual([])
  })

  it('handles null data from API', async () => {
    mockQueryBuilder.then.mockImplementation((resolve) =>
      resolve({ data: null, error: null })
    )

    const { result } = renderHook(() => useBuildTrendData(7))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('classifies non-success/failure builds as skip', async () => {
    // A build whose status is neither success nor failure (e.g. aborted,
    // pending) is counted in the skip bucket.
    const mockBuilds = [
      { started_at: '2025-06-14T10:00:00Z', status: 'aborted' },
    ]
    mockQueryBuilder.then.mockImplementation((resolve) =>
      resolve({ data: mockBuilds, error: null })
    )

    const { result } = renderHook(() => useBuildTrendData(7))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const day = result.current.data[0]
    expect(day.pass).toBe(0)
    expect(day.fail).toBe(0)
    expect(day.skip).toBe(1)
    expect(day.total).toBe(1)
  })
})
