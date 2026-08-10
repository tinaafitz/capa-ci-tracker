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

export function BuildTrendChart({ data, loading }) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground border border-dashed border-border rounded-md">
        No build data available for the selected period.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">
        Build Trend (Last 30 Days)
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
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
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            labelFormatter={(date) =>
              new Date(date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            }
          />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: '12px' }}
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
