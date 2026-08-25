import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function formatDuration(ms) {
  if (ms == null) return '--'
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${minutes}m`
}

function passRateColor(rate) {
  if (rate == null) return 'text-muted-foreground'
  if (rate >= 80) return 'text-emerald-600'
  if (rate >= 50) return 'text-amber-600'
  return 'text-red-600'
}

function StatTile({ label, value, valueClassName = 'text-foreground', sub }) {
  return (
    <Card className="flex-1 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
          {label}
        </span>
        {sub && (
          <span className="text-[11px] text-amber-600 font-medium whitespace-nowrap">
            {sub}
          </span>
        )}
      </div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums leading-tight ${valueClassName}`}>
        {value}
      </div>
    </Card>
  )
}

export function BuildStatTiles({ stats, loading }) {
  // Full-width single row of tiles: comfortable height, but far shorter than the old 2xl stacked cards.
  const gridClass = 'grid grid-cols-2 sm:grid-cols-4 gap-3'

  if (loading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="px-4 py-2.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1.5 h-6 w-12" />
          </Card>
        ))}
      </div>
    )
  }

  const { total = 0, passRate = null, failed = 0, infraFailed = 0, avgDurationMs = null } = stats || {}
  const infraSub = failed > 0 && infraFailed > 0 ? `${infraFailed} infra` : null

  return (
    <div className={gridClass}>
      <StatTile label="Total Builds" value={total} />
      <StatTile
        label="Pass Rate"
        value={passRate == null ? '--' : `${passRate}%`}
        valueClassName={passRateColor(passRate)}
      />
      <StatTile
        label="Failed"
        value={failed}
        valueClassName={failed > 0 ? 'text-red-600' : 'text-foreground'}
        sub={infraSub}
      />
      <StatTile label="Avg Duration" value={formatDuration(avgDurationMs)} />
    </div>
  )
}
