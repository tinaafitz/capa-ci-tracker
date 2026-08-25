import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Separator } from '@/components/ui/separator'
import { BuildTrendChart } from '@/components/transactions/BuildTrendChart'
import { BuildHistoryTable } from '@/components/transactions/BuildHistoryTable'
import { BuildStatTiles } from '@/components/transactions/BuildStatTiles'
import { BuildDetail } from '@/components/transactions/BuildDetail'
import { useBuilds, useBuildStats, useBuildTrendData } from '@/hooks/useBuilds'
import { useAppState, useAppActions } from '@/store/AppContext'
import { RefreshIngestButton } from '@/components/shared/RefreshIngestButton'

export function TransactionsPage() {
  const { selectedBuild, buildDetailOpen } = useAppState()
  const { selectBuild, closeBuildDetail } = useAppActions()

  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => ({
    job: 'all',
    status: searchParams.get('status') || 'all',
    dateRange: '7d',
  }))
  const [hideInfra, setHideInfra] = useState(false)
  const [page, setPage] = useState(1)

  const { data: builds, loading, count, totalPages, refetch: refetchBuilds } = useBuilds({
    ...filters,
    hideInfra,
    page,
    pageSize: 20,
  })

  const { stats, loading: statsLoading } = useBuildStats({ ...filters, hideInfra })

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
      <div className="px-6 py-2.5 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Builds</h2>
          <RefreshIngestButton onRefreshed={refetchBuilds} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-3 space-y-3">
        {/* KPI stat tiles + trend chart: side-by-side on wide screens to save vertical space */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
          <BuildStatTiles stats={stats} loading={statsLoading} />
          <BuildTrendChart data={trendData} loading={trendLoading} />
        </div>

        <Separator />

        {/* Build History Table */}
        <BuildHistoryTable
          builds={builds}
          loading={loading}
          totalCount={count}
          page={page}
          totalPages={totalPages}
          filters={filters}
          hideInfra={hideInfra}
          onHideInfraChange={setHideInfra}
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
