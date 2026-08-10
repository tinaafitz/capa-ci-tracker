import { Badge } from '@/components/ui/badge'

const statusConfig = {
  success: {
    label: 'Passed',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
  },
  failure: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
  },
  running: {
    label: 'Running',
    className: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 animate-pulse',
  },
  pending: {
    label: 'Pending',
    className: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100',
  },
  aborted: {
    label: 'Aborted',
    className: 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-100',
  },
  unstable: {
    label: 'Unstable',
    className: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100',
  },
}

export function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.pending

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  )
}
