const statusConfig = {
  success: {
    label: 'Passed',
    dot: 'bg-emerald-500',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/25',
  },
  failure: {
    label: 'Failed',
    dot: 'bg-red-500',
    className: 'bg-red-50 text-red-700 ring-red-600/30',
  },
  running: {
    label: 'Running',
    dot: 'bg-blue-500 animate-pulse',
    className: 'bg-blue-50 text-blue-700 ring-blue-600/25',
  },
  pending: {
    label: 'Pending',
    dot: 'bg-slate-400',
    className: 'bg-slate-50 text-slate-600 ring-slate-400/25',
  },
  aborted: {
    label: 'Aborted',
    dot: 'bg-amber-500',
    className: 'bg-amber-50 text-amber-700 ring-amber-600/25',
  },
  unstable: {
    label: 'Unstable',
    dot: 'bg-amber-400',
    className: 'bg-amber-50 text-amber-700 ring-amber-500/25',
  },
}

export function StatusBadge({ status }) {
  const c = statusConfig[status] || statusConfig.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${c.className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}
