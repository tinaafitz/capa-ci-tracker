import { Button } from '@/components/ui/button'

const ranges = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]

export function DateRangeFilter({ value, onChange }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-background">
      {ranges.map((range) => (
        <Button
          key={range.value}
          variant={value === range.value ? 'default' : 'ghost'}
          size="sm"
          className={`rounded-none first:rounded-l-md last:rounded-r-md h-8 px-3 text-xs ${
            value === range.value ? '' : 'text-muted-foreground'
          }`}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </Button>
      ))}
    </div>
  )
}
