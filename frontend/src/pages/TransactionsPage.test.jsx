import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TransactionsPage } from './TransactionsPage'

// Mock child components
vi.mock('@/components/transactions/BuildTrendChart', () => ({
  BuildTrendChart: () => <div data-testid="build-trend-chart">BuildTrendChart</div>,
}))
vi.mock('@/components/transactions/BuildHistoryTable', () => ({
  BuildHistoryTable: () => <div data-testid="build-history-table">BuildHistoryTable</div>,
}))
vi.mock('@/components/transactions/BuildDetail', () => ({
  BuildDetail: () => <div data-testid="build-detail">BuildDetail</div>,
}))

// Mock hooks and context
vi.mock('@/hooks/useBuilds', () => ({
  useBuilds: () => ({
    data: [],
    loading: false,
    error: null,
    count: 0,
    totalPages: 0,
    page: 1,
    pageSize: 20,
    refetch: vi.fn(),
  }),
  useBuildStats: () => ({
    stats: {
      total: 0,
      passRate: null,
      failed: 0,
      infraFailed: 0,
      avgDurationMs: null,
    },
    loading: false,
    error: null,
  }),
  useBuildTrendData: () => ({
    data: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/store/AppContext', () => ({
  useAppState: () => ({
    selectedBuild: null,
    buildDetailOpen: false,
  }),
  useAppActions: () => ({
    selectBuild: vi.fn(),
    closeBuildDetail: vi.fn(),
  }),
}))

describe('TransactionsPage', () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <TransactionsPage />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderPage()
    expect(screen.getByText('Builds')).toBeInTheDocument()
  })

  it('collapses the trend chart by default and reveals it via the toggle', () => {
    renderPage()
    // Trend chart is collapsed by default (density refactor) so the builds
    // table is visible without scrolling.
    expect(screen.queryByTestId('build-trend-chart')).not.toBeInTheDocument()

    // Expanding the "Build Trend" toggle reveals the chart.
    fireEvent.click(screen.getByRole('button', { name: /Build Trend/i }))
    expect(screen.getByTestId('build-trend-chart')).toBeInTheDocument()
  })

  it('renders the build history table', () => {
    renderPage()
    expect(screen.getByTestId('build-history-table')).toBeInTheDocument()
  })

  it('renders the build detail component', () => {
    renderPage()
    expect(screen.getByTestId('build-detail')).toBeInTheDocument()
  })
})
