import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'
import {
  useLegacyTable as useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from '@tanstack/react-table/legacy'
import { flexRender } from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FilterSelect } from '@/components/shared/FilterSelect'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { DateRangeFilter } from '@/components/shared/DateRangeFilter'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatRelative, formatAbsolute } from '@/lib/utils'

// Shared chip base — uniform height, radius, padding across all chip types
const CHIP = 'inline-flex items-center gap-1.5 h-[22px] rounded-md border px-2 text-[11.5px] font-mono leading-none whitespace-nowrap shrink-0'

// ─── Feature group ────────────────────────────────────────────────────────────

const FEATURE_GROUP_FEATURES = {
  'day1-basic':      ['domain_prefix', 'availability_zones', 'additional_tags', 'channel_group', 'default_autoscaling'],
  'day1-combo':      ['cluster_autoscaler_expander', 'image_registry', 'parallel_upgrade', 'disk_size'],
  'day1-security':   ['etcd_kms', 'fips', 'security_groups'],
  'day1-networking': ['no_cni', 'private_network', 'external_oidc', 'audit_logging'],
}

const FEATURE_LABELS = {
  domain_prefix:               'domain',
  availability_zones:          'azs',
  additional_tags:             'tags',
  channel_group:               'channel',
  default_autoscaling:         'autoscaling',
  cluster_autoscaler_expander: 'autoscaler',
  image_registry:              'img-registry',
  parallel_upgrade:            'parallel-upg',
  disk_size:                   'disk-size',
  etcd_kms:                    'etcd-kms',
  fips:                        'fips',
  security_groups:             'sec-groups',
  no_cni:                      'no-cni',
  private_network:             'private',
  external_oidc:               'ext-oidc',
  audit_logging:               'audit-log',
}

function FeatureGroupChips({ group }) {
  const features = FEATURE_GROUP_FEATURES[group]
  if (!features) return null
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className={`${CHIP} border-violet-600 bg-violet-600 text-white font-semibold`}>
        {group}
      </span>
      {features.map((f) => (
        <span
          key={f}
          title={f}
          className={`${CHIP} border-violet-200 bg-violet-50 text-violet-700`}
        >
          {FEATURE_LABELS[f] ?? f}
        </span>
      ))}
    </div>
  )
}

// ─── Param chips ─────────────────────────────────────────────────────────────

function ParamChip({ raw }) {
  const i = raw.indexOf(':')
  const k = i === -1 ? raw : raw.slice(0, i)
  const v = i === -1 ? '' : raw.slice(i + 1)
  return (
    <span className={`${CHIP} border-slate-200 bg-slate-50 text-slate-600`} title={raw}>
      <span className="text-slate-400">{k}</span>
      <span className="max-w-[7rem] truncate font-semibold tabular-nums text-slate-700">{v}</span>
    </span>
  )
}

// ─── Step chips ──────────────────────────────────────────────────────────────

const STEP_TONE = {
  PASSED:  'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED:  'border-red-300 bg-red-50 text-red-700 font-semibold',
  PARTIAL: 'border-amber-200 bg-amber-50 text-amber-700',
}
const STEP_DOT = {
  PASSED:  'bg-emerald-500',
  FAILED:  'bg-red-500',
  PARTIAL: 'bg-amber-400',
}
const STEP_LABELS = {
  'Configure MCE Environment':          'Configure MCE',
  'CAPA Cluster Provisioning':          'Provision',
  'Verify Feature Flags':               'Verify Features',
  'Add ROSAMachinePool':                'MachinePool',
  'Delete ROSAMachinePool':             'Delete Pool',
  'CAPA Cluster Deletion':              'Delete',
  'Install CAPI Standalone':            'CAPI Standalone',
  'Disable CAPI/CAPA, Enable Hypershift': 'Enable Hypershift',
  'Upgrade ROSA HCP Control Plane':     'Upgrade CP',
  'Upgrade ROSA HCP Machine Pool':      'Upgrade Pool',
}
function stepLabel(name) {
  if (Object.hasOwn(STEP_LABELS, name)) return STEP_LABELS[name]
  return name.replace(/^(Install |CAPA |ROSA HCP |Upgrade ROSA HCP |Add |Delete )/, '')
}

// ─── Infra badge ─────────────────────────────────────────────────────────────

const INFRA_CLASS_LABELS = {
  cleanup_verification_failure: 'cleanup',
}

function infraClassLabel(failureClass) {
  if (!failureClass) return 'infra'
  if (Object.hasOwn(INFRA_CLASS_LABELS, failureClass)) return INFRA_CLASS_LABELS[failureClass]
  if (failureClass.startsWith('infra_')) return failureClass.slice(6)
  return failureClass
}

function InfraBadge({ failureClass, failureReason }) {
  const label = infraClassLabel(failureClass)
  const displayTitle = [failureClass, failureReason].filter(Boolean).join(' — ') || undefined
  return (
    <span
      className="inline-flex items-center gap-1.5 max-w-full truncate rounded-full bg-amber-50 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-600/30"
      title={displayTitle}
    >
      infra:{label}
    </span>
  )
}

// ─── Row left border ─────────────────────────────────────────────────────────

function statusBorderClass(status) {
  switch (status) {
    case 'failure':
    case 'failed':
      return 'border-l-[3px] border-l-red-500'
    case 'passed':
    case 'success':
      return 'border-l-[3px] border-l-emerald-500'
    case 'pending':
    case 'running':
      return 'border-l-[3px] border-l-blue-400'
    case 'aborted':
      return 'border-l-[3px] border-l-amber-400'
    case 'unstable':
      return 'border-l-[3px] border-l-amber-500'
    default:
      return 'border-l-[3px] border-l-border'
  }
}

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Passed' },
  { value: 'failure', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'unstable', label: 'Unstable' },
]

export function BuildHistoryTable({
  builds,
  loading,
  totalCount,
  page,
  totalPages,
  filters,
  hideInfra = false,
  onHideInfraChange,
  onFiltersChange,
  onPageChange,
}) {

  const columns = useMemo(
    () => [
      {
        accessorKey: 'job_name',
        header: 'Job / Build',
        cell: ({ row }) => {
          const fullName = row.getValue('job_name') || ''
          const externalId = row.original.external_id
          const jobUrl = row.original.job_url
          const src = row.original.source
          const { identity, extra, featureGroup } = buildParamChips(row.original)
          const allParams = [...identity, ...extra]
          const prowSuites = (() => {
            try {
              const raw = typeof row.original.prow_suites === 'string'
                ? JSON.parse(row.original.prow_suites || '[]')
                : row.original.prow_suites || []
              return Array.isArray(raw) ? raw : []
            } catch { return [] }
          })()

          const inline = src === 'jenkins'

          const jobName = (
            <span className="truncate text-[13.5px] font-semibold font-mono tracking-tight text-foreground" title={fullName}>
              {fullName}
            </span>
          )
          const buildRef = jobUrl ? (
            <a
              href={jobUrl}
              target="_blank"
              rel="noreferrer"
              className={inline
                ? 'shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-primary hover:bg-primary/10 hover:underline'
                : 'font-mono text-[11px] tabular-nums text-muted-foreground/70 hover:text-primary hover:underline truncate'
              }
              onClick={(e) => e.stopPropagation()}
            >
              #{externalId}
            </a>
          ) : (
            <span className={inline
              ? 'shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-foreground/70'
              : 'font-mono text-[11px] tabular-nums text-muted-foreground/70 truncate'
            }>
              #{externalId}
            </span>
          )

          const passedCount = prowSuites.filter(s => s.status === 'PASSED').length

          return (
            <div className="flex min-h-[44px] flex-col gap-1.5">
              {/* Title row: source prefix + job name + build ref */}
              <span className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 ${src === 'jenkins' ? 'text-sky-500' : src === 'prow' ? 'text-indigo-500' : 'text-muted-foreground/60'}`}>
                  {src}
                </span>
                {jobName}
                {buildRef}
              </span>

              {/* Sub-lines in a guide-rail */}
              {(allParams.length > 0 || featureGroup || prowSuites.length > 0) && (
                <div className="ml-0.5 flex flex-col gap-2 border-l border-dashed border-border pl-2.5">
                  {/* Param chips */}
                  {allParams.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 shrink-0">Params</span>
                      {allParams.map((p, i) => <ParamChip key={i} raw={p} />)}
                    </div>
                  )}

                  {/* Feature group */}
                  {featureGroup && <FeatureGroupChips group={featureGroup} />}

                  {/* Steps — capped at 6 */}
                  {prowSuites.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 shrink-0">Stages</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">
                        {passedCount}/{prowSuites.length}
                      </span>
                      {prowSuites.map((s, i) => (
                        <span
                          key={i}
                          title={`${s.name}${s.duration_s != null ? ` — ${Math.round(s.duration_s / 60)}m` : ''}`}
                          className={`${CHIP} ${STEP_TONE[s.status] ?? STEP_TONE.PARTIAL}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STEP_DOT[s.status] ?? STEP_DOT.PARTIAL}`} />
                          <span className="max-w-[8rem] truncate">{stepLabel(s.name)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        },
        size: 430,
        meta: { cellClassName: 'align-top' },
      },
      {
        id: 'status',
        header: 'Status',
        enableSorting: false,
        meta: { cellClassName: 'align-top' },
        cell: ({ row }) => {
          const status = row.original.status
          const isInfra = row.original.is_infra === 1 || row.original.is_infra === '1'
          const failureClass = row.original.failure_class
          const failureReason = row.original.failure_reason
          const showInfra = isInfra || failureClass === 'cleanup_verification_failure'
          return (
            <div className="flex flex-col items-start gap-1.5">
              <StatusBadge status={status} />
              {showInfra && <InfraBadge failureClass={failureClass} failureReason={failureReason} />}
            </div>
          )
        },
        size: 120,
      },
      {
        id: 'timing',
        header: 'Started',
        accessorKey: 'started_at',
        meta: { cellClassName: 'align-top text-right' },
        cell: ({ row }) => {
          const started = row.original.started_at
          return (
            <span
              className="text-[13px] tabular-nums text-muted-foreground whitespace-nowrap"
              title={formatAbsolute(started)}
            >
              {formatRelative(started)}
            </span>
          )
        },
        size: 110,
      },
      {
        id: 'duration',
        header: 'Duration',
        accessorKey: 'duration_ms',
        meta: { cellClassName: 'align-top text-right' },
        cell: ({ row }) => {
          const ms = row.original.duration_ms
          return (
            <span className="font-mono text-[13px] font-medium tabular-nums text-foreground whitespace-nowrap">
              {formatDuration(ms)}
            </span>
          )
        },
        size: 90,
      },
    ],
    []
  )

  const [sorting, setSorting] = useState([{ id: 'started_at', desc: true }])

  const table = useReactTable({
    data: builds || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    getRowId: (row) => row.id,
  })

  const totalWidth = table.getTotalSize()

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <FilterSelect
          value={filters.source || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, source: v })}
          options={[
            { value: 'all', label: 'All Jobs' },
            { value: 'jenkins', label: 'Jenkins' },
            { value: 'prow', label: 'Prow' },
          ]}
          className="w-40 h-8"
        />
        <FilterSelect
          value={filters.status || 'all'}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v })}
          options={statusOptions}
          className="w-36 h-8"
        />
        <DateRangeFilter
          value={filters.dateRange || '7d'}
          onChange={(v) => onFiltersChange({ ...filters, dateRange: v })}
        />
        <label className="flex items-center gap-1.5 cursor-pointer select-none ml-auto">
          <span className="relative inline-flex h-5 w-9 shrink-0">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={hideInfra}
              onChange={(e) => onHideInfraChange && onHideInfraChange(e.target.checked)}
            />
            <span className="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-amber-500" />
            <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">Hide infra failures</span>
        </label>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden shadow-sm">
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  const alignRight = ['timing', 'duration'].includes(header.column.id)
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: `${(header.getSize() / totalWidth) * 100}%` }}
                      className={`h-10 sticky top-0 z-10 bg-muted border-b border-border text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 group${alignRight ? ' text-right' : ''}${canSort ? ' cursor-pointer select-none hover:bg-muted/70 transition-colors' : ''}`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className={`inline-flex items-center gap-1${alignRight ? ' justify-end w-full' : ''}`}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc' ? (
                              <ArrowUp className="size-3 text-foreground" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="size-3 text-foreground" />
                            ) : (
                              <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                            )
                          )}
                        </span>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell className="py-3">
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-3.5 w-[70%]" />
                      <Skeleton className="h-3 w-[85%]" />
                      <Skeleton className="h-3 w-[55%]" />
                    </div>
                  </TableCell>
                  {columns.slice(1).map((col, j) => (
                    <TableCell key={j} className="py-3">
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48">
                  <EmptyState
                    title="No builds found"
                    description="No builds match your current filters."
                    actionLabel="Clear filters"
                    onAction={() => onFiltersChange({ job: 'all', source: 'all', status: 'all', dateRange: '7d' })}
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isFailed = row.original.status === 'failure'
                return (
                  <TableRow
                    key={row.id}
                    className={`transition-colors border-b border-border/70 ${statusBorderClass(row.original.status)} ${
                      isFailed
                        ? 'bg-red-50/30 hover:bg-red-50/60'
                        : 'odd:bg-muted/[0.18] hover:bg-muted/40'
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const cellClassName = cell.column.columnDef.meta?.cellClassName || ''
                      return (
                        <TableCell key={cell.id} className={`py-4 align-top ${cellClassName}`}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {builds.length} of {totalCount} builds
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {generatePageNumbers(page, totalPages).map((p, i) =>
                p === '...' ? (
                  <PaginationItem key={`ellipsis-${i}`}>
                    <span className="px-2 text-muted-foreground">...</span>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => onPageChange(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}

function formatDuration(ms) {
  if (!ms || ms < 60000) return ms > 0 ? '<1m' : '—'
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${minutes}m`
}

function buildParamChips(build) {
  let featureGroup = null
  try {
    const params =
      typeof build.parameters === 'string'
        ? JSON.parse(build.parameters || '{}')
        : build.parameters || {}

    if (build.source === 'prow') {
      const identity = []
      const extra = []
      if (params.name_prefix) identity.push(`prefix:${params.name_prefix}`)
      if (params.channel) extra.push(`channel:${params.channel}`)
      if (params.ocp_version) extra.push(`ocp:${params.ocp_version}`)
      else if (params.release) extra.push(`release:${params.release}`)
      return { identity, extra, featureGroup }
    }

    const identity = []
    const extra = []

    if (params.OCP_HUB_API_URL) {
      const hostMatch = params.OCP_HUB_API_URL.match(/api\.([^.]+)\./)
      if (hostMatch) identity.push(`host:${hostMatch[1]}`)
    }
    if (params.NAME_PREFIX) identity.push(`prefix:${params.NAME_PREFIX}`)
    if (params.FEATURE_GROUP) featureGroup = params.FEATURE_GROUP

    let requestedVersion = null
    if (params.EXTRA_FEATURE_VARS) {
      const channelMatch = params.EXTRA_FEATURE_VARS.match(/channel_group=(\S+)/)
      if (channelMatch) extra.push(`channel:${channelMatch[1]}`)
      const versionMatch = params.EXTRA_FEATURE_VARS.match(/openshift_version=([^\s]+)/)
      if (versionMatch) {
        requestedVersion = versionMatch[1]
        extra.push(`ocp:${requestedVersion}`)
      }
    }
    if (build.ocp_version && build.ocp_version !== requestedVersion) {
      extra.push(`version:${build.ocp_version}`)
    }

    return { identity, extra, featureGroup }
  } catch {
    return { identity: [], extra: [], featureGroup }
  }
}

function extractRepo(jobName, source) {
  if (source === 'prow' && jobName) {
    if (jobName.includes('openshift-online-rosa-e2e')) return 'stolostron/rosa-hcp-e2e-test'
    const match = jobName.match(/^(?:periodic|pull|batch)-ci-(.+?)-(main|master|release-[\d.]+)/)
    if (match) {
      const parts = match[1].split('-')
      const knownOrgs = ['openshift-online', 'stolostron', 'openshift']
      for (const org of knownOrgs) {
        const orgParts = org.split('-')
        if (parts.slice(0, orgParts.length).join('-') === org) {
          return `${org}/${parts.slice(orgParts.length).join('-')}`
        }
      }
      return `${parts[0]}/${parts.slice(1).join('-')}`
    }
  }
  if (source === 'jenkins') return 'stolostron/rosa-hcp-e2e-test'
  return null
}

function generatePageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}
