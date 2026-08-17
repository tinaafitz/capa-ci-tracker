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

function StatTile({ label, value, valueClassName = 'text-foreground' }) {
  return (
    <Card className="flex-1 px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName}`}>
        {value}
      </div>
    </Card>
  )
}

export function BuildStatTiles({ stats, loading }) {
  if (loading) {
    return (
      <div className="flex items-stretch gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex-1 px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </Card>
        ))}
      </div>
    )
  }

  const { total = 0, passRate = null, failed = 0, avgDurationMs = null } = stats || {}

  return (
    <div className="flex items-stretch gap-3">
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
      />
      <StatTile label="Avg Duration" value={formatDuration(avgDurationMs)} />
    </div>
  )
}
