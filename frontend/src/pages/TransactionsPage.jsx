import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Separator } from '@/components/ui/separator'
import { BuildTrendChart } from '@/components/transactions/BuildTrendChart'
import { BuildHistoryTable } from '@/components/transactions/BuildHistoryTable'
import { BuildStatTiles } from '@/components/transactions/BuildStatTiles'
import { BuildDetail } from '@/components/transactions/BuildDetail'
import { useBuilds, useBuildStats, useBuildTrendData } from '@/hooks/useBuilds'
import { useAppState, useAppActions } from '@/store/AppContext'

export function TransactionsPage() {
  const { selectedBuild, buildDetailOpen } = useAppState()
  const { selectBuild, closeBuildDetail } = useAppActions()

  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({
    job: 'all',
    status: searchParams.get('status') || 'all',
    dateRange: '7d',
  }))
  const [page, setPage] = useState(1)

  const { data: builds, loading, count, totalPages } = useBuilds({
    ...filters,
    page,
    pageSize: 20,
  })

  const { stats, loading: statsLoading } = useBuildStats(filters)

  const { data: trendData, loading: trendLoading } = useBuildTrendData(30)

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters)
    setPage(1)
  }, [])

  const handleBuildClick = useCallback(
    (build) => {
      selectBuild(build)
    },
    [selectBuild]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <h2 className="text-lg font-semibold text-foreground">Builds</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {/* KPI stat tiles */}
        <BuildStatTiles stats={stats} loading={statsLoading} />

        {/* Trend Chart */}
        <BuildTrendChart data={trendData} loading={trendLoading} />

        <Separator />

        {/* Build History Table */}
        <BuildHistoryTable
          builds={builds}
          loading={loading}
          totalCount={count}
          page={page}
          totalPages={totalPages}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onPageChange={setPage}
          onBuildClick={handleBuildClick}
        />
      </div>

      {/* Build detail sheet */}
      <BuildDetail
        build={selectedBuild}
        open={buildDetailOpen}
        onOpenChange={(open) => {
          if (!open) closeBuildDetail()
        }}
      />
    </div>
  )
}
