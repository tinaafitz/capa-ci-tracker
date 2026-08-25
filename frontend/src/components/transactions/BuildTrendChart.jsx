import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'

const SERIES = [
  { key: 'fail', label: 'Fail', color: '#ef4444' },
  { key: 'pass', label: 'Pass', color: '#22c55e' },
  { key: 'skip', label: 'Skip', color: '#9ca3af' },
]

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null

  const row = payload[0]?.payload || {}
  const dateLabel = new Date(label).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{dateLabel}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-muted-foreground">{s.label}</span>
          </span>
          <span className="font-mono tabular-nums text-foreground">
            {row[s.key] ?? 0}
          </span>
        </div>
      ))}
    </div>
  )
}

export function BuildTrendChart({ data, loading }) {
  if (loading) {
    return (
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="min-w-0 flex-1 flex items-center justify-center h-32 text-sm text-muted-foreground border border-dashed border-border rounded-md">
        No build data available for the selected period.
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Build Trend (Last 30 Days)
      </h3>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => {
              const d = new Date(date)
              return `${d.getMonth() + 1}/${d.getDate()}`
            }}
            className="text-xs"
            tick={{ fontSize: 11 }}
          />
          <YAxis className="text-xs" tick={{ fontSize: 11 }} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: 'rgba(148, 163, 184, 0.15)' }}
          />
          <Legend
            iconSize={9}
            height={20}
            wrapperStyle={{ fontSize: '11px' }}
          />
          <Bar
            dataKey="pass"
            name="Pass"
            stackId="a"
            fill="#22c55e"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="fail"
            name="Fail"
            stackId="a"
            fill="#ef4444"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="skip"
            name="Skip"
            stackId="a"
            fill="#9ca3af"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
