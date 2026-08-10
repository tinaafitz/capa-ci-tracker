import { Badge } from '@/components/ui/badge'

const severityConfig = {
  nightly_blocker: {
    label: 'Nightly Blocker',
    className: 'bg-red-100 text-red-900 border-red-300 font-bold hover:bg-red-100',
  },
  test_regression: {
    label: 'Test Regression',
    className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
  },
  flaky: {
    label: 'Flaky',
    className: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100',
  },
  infrastructure: {
    label: 'Infrastructure',
    className: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100',
  },
  upstream_breakage: {
    label: 'Upstream Breakage',
    className: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
  },
}

export const SEVERITY_ORDER = [
  'nightly_blocker',
  'test_regression',
  'flaky',
  'infrastructure',
  'upstream_breakage',
]

export function SeverityBadge({ severity }) {
  const config = severityConfig[severity] || severityConfig.test_regression

  return (
    <Badge variant="outline" className={`text-xs ${config.className}`}>
      {config.label}
    </Badge>
  )
}
