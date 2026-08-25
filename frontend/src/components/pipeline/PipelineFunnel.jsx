import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const STAGE_CONFIG = {
  ticket_created: {
    label: 'Ticket Created',
    shortLabel: 'Created',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="10" height="12" rx="1.5" />
        <path d="M6 5h4M6 8h4M6 11h2" />
      </svg>
    ),
    barColor: 'bg-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    textColor: 'text-blue-700 dark:text-blue-300',
    ringColor: 'ring-blue-200 dark:ring-blue-800',
    borderColor: 'border-blue-200 dark:border-blue-800',
    accentColor: 'text-blue-500',
  },
  root_cause_diagnosed: {
    label: 'Diagnosed',
    shortLabel: 'Diagnosed',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
    ),
    barColor: 'bg-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    textColor: 'text-amber-700 dark:text-amber-300',
    ringColor: 'ring-amber-200 dark:ring-amber-800',
    borderColor: 'border-amber-200 dark:border-amber-800',
    accentColor: 'text-amber-500',
  },
  pr_submitted: {
    label: 'PR Submitted',
    shortLabel: 'PR Open',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="4" r="2" />
        <circle cx="11" cy="12" r="2" />
        <path d="M5 6v6M11 10V6c0-1.1-.9-2-2-2H7" />
      </svg>
    ),
    barColor: 'bg-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950/40',
    textColor: 'text-purple-700 dark:text-purple-300',
    ringColor: 'ring-purple-200 dark:ring-purple-800',
    borderColor: 'border-purple-200 dark:border-purple-800',
    accentColor: 'text-purple-500',
  },
  pr_merged: {
    label: 'PR Merged',
    shortLabel: 'Merged',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="4" r="2" />
        <circle cx="11" cy="12" r="2" />
        <circle cx="5" cy="12" r="2" />
        <path d="M5 6v4M11 10c0-3-6-3-6-6" />
      </svg>
    ),
    barColor: 'bg-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    ringColor: 'ring-emerald-200 dark:ring-emerald-800',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    accentColor: 'text-emerald-500',
  },
  fix_verified: {
    label: 'Verified',
    shortLabel: 'Verified',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
      </svg>
    ),
    barColor: 'bg-green-600',
    bgColor: 'bg-green-50 dark:bg-green-950/40',
    textColor: 'text-green-700 dark:text-green-300',
    ringColor: 'ring-green-200 dark:ring-green-800',
    borderColor: 'border-green-200 dark:border-green-800',
    accentColor: 'text-green-600',
  },
}

// Export for other components to reference
export { STAGE_CONFIG }

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '--'
  if (seconds < 60) return '<1m'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

// Map funnel stage_name -> pipeline_stage ordinal used by the ticket filter.
const STAGE_ORDINAL = {
  ticket_created: 2,
  root_cause_diagnosed: 3,
  pr_submitted: 4,
  pr_merged: 5,
  fix_verified: 6,
}

function FunnelStageCard({ stage, index, maxCount, firstCount, selected, onSelect }) {
  const config = STAGE_CONFIG[stage.stage_name] || STAGE_CONFIG.ticket_created
  const count = stage.ticket_count || 0
  const hasData = count > 0
  const conversionPct = firstCount > 0
    ? Math.round((count / firstCount) * 100)
    : 0

  // Bar fill height (percentage of max)
  const fillPct = maxCount > 0
    ? Math.max(8, Math.round((count / maxCount) * 100))
    : 0

  const ordinal = STAGE_ORDINAL[stage.stage_name]

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            onClick={() => ordinal != null && onSelect?.(ordinal)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && ordinal != null) {
                e.preventDefault()
                onSelect?.(ordinal)
              }
            }}
            className={`flex flex-col items-center flex-1 min-w-0 max-w-[10rem] group cursor-pointer rounded-lg px-1 py-1 transition-shadow ${
              selected ? 'ring-2 ring-primary' : ''
            }`}
          >
            {/* Count + label header */}
            <div className={`flex flex-col items-center mb-2 ${hasData ? '' : 'opacity-40'}`}>
              <span className={`text-2xl font-bold tabular-nums leading-none ${
                hasData ? config.textColor : 'text-muted-foreground'
              }`}>
                {count}
              </span>
              <span className={`text-[11px] font-medium mt-1 text-center leading-tight ${
                hasData ? 'text-foreground' : 'text-muted-foreground'
              }`}>
                {config.shortLabel}
              </span>
            </div>

            {/* Horizontal bar (fills left to right, proportional to count) */}
            <div className={`w-full rounded-md overflow-hidden relative ${
              hasData ? config.bgColor : 'bg-muted/10 border border-dashed border-muted-foreground/15'
            }`} style={{ height: '32px' }}>
              {/* Filled portion from left */}
              <div
                className={`absolute inset-y-0 left-0 rounded-md transition-all duration-700 ease-out ${
                  hasData ? config.barColor : ''
                }`}
                style={{
                  width: hasData ? `${fillPct}%` : '0%',
                  opacity: hasData ? 0.8 : 0,
                }}
              />
              {/* Icon overlay centered */}
              <div className={`absolute inset-0 flex items-center justify-center ${
                hasData ? 'text-white/90' : 'text-muted-foreground/20'
              }`}>
                {config.icon}
              </div>
            </div>

            {/* Metrics below bar */}
            <div className="flex flex-col items-center mt-1.5 gap-0">
              {/* Conversion percentage of total */}
              <span className={`text-[11px] font-medium tabular-nums leading-relaxed ${
                index === 0
                  ? 'text-muted-foreground'
                  : conversionPct >= 80
                    ? 'text-green-600 dark:text-green-400'
                    : conversionPct >= 50
                      ? 'text-amber-600 dark:text-amber-400'
                      : hasData
                        ? 'text-red-500 dark:text-red-400'
                        : 'text-muted-foreground/30'
              }`}>
                {index === 0 ? '100%' : `${conversionPct}%`}
              </span>
              {/* Median duration */}
              <span className={`text-[10px] tabular-nums leading-relaxed ${
                stage.median_stage_duration_seconds != null && hasData
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground/30'
              }`}>
                {stage.median_stage_duration_seconds != null && hasData
                  ? `~${formatDuration(stage.median_stage_duration_seconds)}`
                  : '--'}
              </span>
            </div>
          </div>
        }
      />
      <TooltipContent side="bottom" className="text-xs">
        <div className="space-y-1">
          <div className="font-medium">{config.label}</div>
          <div>{count} ticket{count !== 1 ? 's' : ''} reached this stage</div>
          {conversionPct > 0 && index > 0 && (
            <div>{conversionPct}% conversion from total</div>
          )}
          {stage.median_stage_duration_seconds != null && hasData && (
            <div>Median time at stage: {formatDuration(stage.median_stage_duration_seconds)}</div>
          )}
          {!hasData && (
            <div className="text-muted-foreground">No tickets have reached this stage</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function ConversionConnector({ prevCount, currentCount }) {
  // Count of tickets that dropped off between the previous stage and this one.
  const lost = Math.max(0, prevCount - currentCount)
  // Guard against divide-by-zero; if count somehow increased, show 0%.
  const dropPct = prevCount > 0
    ? Math.max(0, Math.round((lost / prevCount) * 100))
    : 0

  return (
    <div className="flex flex-col items-center justify-start shrink-0 pt-6" style={{ width: '48px' }}>
      {/* Chevron arrow */}
      <svg className="w-3.5 h-3.5 text-muted-foreground/20" viewBox="0 0 16 16" fill="none">
        <path d="M5.5 3L10.5 8L5.5 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* Drop-off label below the arrow */}
      <span
        className={`mt-1 text-[10px] leading-tight tabular-nums text-center ${
          lost > 0 ? 'text-red-500/70 dark:text-red-400/70' : 'text-muted-foreground/30'
        }`}
      >
        -{lost} ({dropPct}%)
      </span>
    </div>
  )
}

export function PipelineFunnel({ data, loading, selectedStage, onStageSelect }) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Resolution Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center flex-1 gap-2">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="w-full rounded-lg" style={{ height: `${80 - i * 12}px` }} />
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  const stages = data || []
  const maxCount = Math.max(1, ...stages.map((s) => s.ticket_count || 0))
  const firstCount = stages[0]?.ticket_count || 0

  // Summary stats
  const totalTickets = firstCount
  const verifiedCount = stages[stages.length - 1]?.ticket_count || 0
  const throughputPct = totalTickets > 0 ? Math.round((verifiedCount / totalTickets) * 100) : 0

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Resolution Funnel</CardTitle>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">{totalTickets}</span> total tickets
            </span>
            <span>
              <span className={`font-medium tabular-nums ${
                throughputPct >= 50 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
              }`}>{throughputPct}%</span> fully resolved
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Horizontal funnel with bars */}
        <div className="flex items-start">
          {stages.map((stage, i) => (
            <div key={stage.stage_name} className="flex items-start flex-1 min-w-0">
              <FunnelStageCard
                stage={stage}
                index={i}
                maxCount={maxCount}
                firstCount={firstCount}
                selected={selectedStage != null && STAGE_ORDINAL[stage.stage_name] === selectedStage}
                onSelect={onStageSelect}
              />
              {i < stages.length - 1 && (
                <ConversionConnector
                  prevCount={stage.ticket_count || 0}
                  currentCount={stages[i + 1]?.ticket_count || 0}
                />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
