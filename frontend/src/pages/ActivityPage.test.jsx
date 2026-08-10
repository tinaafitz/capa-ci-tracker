import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActivityPage } from './ActivityPage'

// Mock child components
vi.mock('@/components/activity/ActivityTimeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">ActivityTimeline</div>,
}))
vi.mock('@/components/shared/DateRangeFilter', () => ({
  DateRangeFilter: ({ value }) => (
    <div data-testid="date-range-filter">DateRange: {value}</div>
  ),
}))

// Mock useActivities
const mockUseActivities = vi.fn().mockReturnValue({
  data: [],
  loading: false,
  error: null,
  count: 0,
  groupedByDay: [],
  refetch: vi.fn(),
})

vi.mock('@/hooks/useActivities', () => ({
  useActivities: (...args) => mockUseActivities(...args),
}))

// The Select components from base-ui need special handling.
// Mock them as simple divs to avoid portal/DOM issues.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }) => <div>{children}</div>,
  SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
}))

describe('ActivityPage', () => {
  beforeEach(() => {
    mockUseActivities.mockClear()
    mockUseActivities.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      count: 0,
      groupedByDay: [],
      refetch: vi.fn(),
    })
    // Clear localStorage between tests
    localStorage.removeItem('activity-filters')
  })

  function renderPage() {
    return render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderPage()
    expect(screen.getByText('Activity')).toBeInTheDocument()
  })

  it('shows loading spinner when loading with no data', () => {
    mockUseActivities.mockReturnValue({
      data: [],
      loading: true,
      error: null,
      count: 0,
      groupedByDay: [],
      refetch: vi.fn(),
    })

    renderPage()
    expect(screen.getByText('Loading activity feed...')).toBeInTheDocument()
  })

  it('renders the activity timeline when data is loaded', () => {
    mockUseActivities.mockReturnValue({
      data: [{ id: '1' }],
      loading: false,
      error: null,
      count: 1,
      groupedByDay: [{ label: 'TODAY', items: [{ id: '1' }] }],
      refetch: vi.fn(),
    })

    renderPage()
    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
  })

  it('shows event count when count > 0', () => {
    mockUseActivities.mockReturnValue({
      data: [{ id: '1' }],
      loading: false,
      error: null,
      count: 42,
      groupedByDay: [],
      refetch: vi.fn(),
    })

    renderPage()
    expect(screen.getByText('42 events')).toBeInTheDocument()
  })

  it('shows singular "event" when count is 1', () => {
    mockUseActivities.mockReturnValue({
      data: [{ id: '1' }],
      loading: false,
      error: null,
      count: 1,
      groupedByDay: [],
      refetch: vi.fn(),
    })

    renderPage()
    expect(screen.getByText('1 event')).toBeInTheDocument()
  })

  it('does not show event count when count is 0', () => {
    renderPage()
    expect(screen.queryByText(/\d+ events?/)).toBeNull()
  })

  it('renders the date range filter', () => {
    renderPage()
    expect(screen.getByTestId('date-range-filter')).toBeInTheDocument()
  })
})
