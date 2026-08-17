import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const STAGE_LABELS = {
  1: 'Build Failed',
  2: 'Ticket Created',
  3: 'Diagnosed',
  4: 'PR Submitted',
  5: 'PR Merged',
  6: 'Verified',
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds) || seconds < 0) return 'N/A'
  if (seconds < 60) return '<1m'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function StatTile({ label, value, sub, valueClassName = '' }) {
  return (
    <Card size="sm" className="flex-1">
      <CardContent className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span className={`text-2xl font-bold tabular-nums leading-none ${valueClassName}`}>
          {value}
        </span>
        {sub && (
          <span className="text-[11px] text-muted-foreground leading-tight">{sub}</span>
        )}
      </CardContent>
    </Card>
  )
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * SLA summary strip: 4 KPI tiles derived from the current pipeline ticket set
 * (rows from v_ticket_lifecycle passed in via `tickets`).
 */
export function PipelineSlaTiles({ tickets, loading }) {
  // Live clock so age-based tiles stay fresh (60s cadence).
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])

  const metrics = useMemo(() => {
    const rows = tickets || []
    const verified = rows.filter((t) => t.pipeline_stage === 6)
    const open = rows.filter((t) => t.pipeline_stage !== 6)

    // Median time-to-fix across verified tickets.
    const lifecycleValues = verified
      .map((t) => t.total_lifecycle_seconds)
      .filter((v) => v != null && !isNaN(v) && v >= 0)
    const medianTtf = median(lifecycleValues)

    // Oldest open ticket age (days), from created_at of non-verified tickets.
    let oldestMs = 0
    for (const t of open) {
      const raw = t.ticket_created_at || t.created_at
      if (!raw) continue
      const ts = new Date(raw).getTime()
      if (isNaN(ts)) continue
      oldestMs = Math.max(oldestMs, now - ts)
    }
    const oldestDays = oldestMs > 0 ? Math.floor(oldestMs / 86400000) : null

    // Slowest stage: lifecycle stage with the most open tickets in it.
    const stageCounts = {}
    for (const t of open) {
      const s = t.pipeline_stage
      if (s == null) continue
      stageCounts[s] = (stageCounts[s] || 0) + 1
    }
    let slowestStage = null
    let slowestCount = 0
    for (const [stage, count] of Object.entries(stageCounts)) {
      if (count > slowestCount) {
        slowestCount = count
        slowestStage = Number(stage)
      }
    }

    // Breaching SLA: open tickets older than 7 days.
    let breaching = 0
    for (const t of open) {
      const raw = t.ticket_created_at || t.created_at
      if (!raw) continue
      const ts = new Date(raw).getTime()
      if (isNaN(ts)) continue
      if (now - ts > SEVEN_DAYS_MS) breaching += 1
    }

    return { medianTtf, oldestDays, slowestStage, slowestCount, breaching }
  }, [tickets, now])

  if (loading) {
    return (
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card size="sm" key={i} className="flex-1">
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-4">
      <StatTile
        label="Median Time-to-Fix"
        value={formatDuration(metrics.medianTtf)}
        sub="verified tickets"
      />
      <StatTile
        label="Oldest Open Ticket"
        value={metrics.oldestDays != null ? `${metrics.oldestDays}d` : 'N/A'}
        sub={metrics.oldestDays != null ? `${metrics.oldestDays}d ago` : 'no open tickets'}
      />
      <StatTile
        label="Slowest Stage"
        value={metrics.slowestStage != null ? STAGE_LABELS[metrics.slowestStage] : 'N/A'}
        sub={metrics.slowestStage != null ? `${metrics.slowestCount} in stage` : 'no open tickets'}
        valueClassName="text-base leading-tight"
      />
      <StatTile
        label="Breaching SLA (>7d)"
        value={metrics.breaching}
        sub="open tickets"
        valueClassName={metrics.breaching > 0 ? 'text-red-600 dark:text-red-400' : ''}
      />
    </div>
  )
}
