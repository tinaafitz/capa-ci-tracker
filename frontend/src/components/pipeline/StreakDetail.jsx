import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge'
import { useStreakDetail } from '@/hooks/useStreaks'

// --- Streak status badge ---

const streakStatusConfig = {
  active: {
    label: 'Active',
    className: 'bg-red-100 text-red-800 border-red-300 hover:bg-red-100',
  },
  partial_fix: {
    label: 'Partial Fix',
    className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
  },
  resolved: {
    label: 'Resolved',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
  },
}

export function StreakStatusBadge({ status }) {
  const config = streakStatusConfig[status] || streakStatusConfig.active
  return (
    <Badge variant="outline" className={`text-xs font-medium ${config.className}`}>
      {config.label}
    </Badge>
  )
}

// --- Error lines renderer ---

function severityColor(severity) {
  switch (severity) {
    case 'fatal':
      return 'text-red-400'
    case 'error':
      return 'text-amber-400'
    case 'info':
      return 'text-blue-400'
    default:
      return 'text-zinc-400'
  }
}

function classifyLine(line) {
  const lower = line.toLowerCase()
  if (lower.includes('fatal') || lower.includes('panic:')) return 'fatal'
  if (lower.includes('error') || lower.includes('failed!') || lower.includes('fail')) return 'error'
  if (lower.includes('info') || lower.includes('warning') || lower.includes('monitor')) return 'info'
  return 'default'
}

export function ErrorLinesBlock({ errorExtract, errorLines, className = '' }) {
  // error_lines is a structured array with severity; error_extract is raw text
  if (errorLines?.length > 0) {
    return (
      <div className={`rounded-md bg-zinc-950 border border-zinc-800 overflow-hidden ${className}`}>
        <ScrollArea className="max-h-64">
          <pre className="p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
            {errorLines.map((line, i) => {
              const sev = line.severity || classifyLine(line.text || line)
              const text = line.text || line
              return (
                <span key={i} className={severityColor(sev)}>
                  {text}
                  {'\n'}
                </span>
              )
            })}
          </pre>
        </ScrollArea>
      </div>
    )
  }

  if (errorExtract) {
    const lines = errorExtract.split('\n')
    return (
      <div className={`rounded-md bg-zinc-950 border border-zinc-800 overflow-hidden ${className}`}>
        <ScrollArea className="max-h-64">
          <pre className="p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
            {lines.map((line, i) => {
              const sev = classifyLine(line)
              return (
                <span key={i} className={severityColor(sev)}>
                  {line}
                  {'\n'}
                </span>
              )
            })}
          </pre>
        </ScrollArea>
      </div>
    )
  }

  return (
    <div className={`rounded-md bg-zinc-950 border border-zinc-800 p-4 ${className}`}>
      <p className="text-xs text-zinc-500 font-mono text-center">No error logs available</p>
    </div>
  )
}

// --- Upstream commits section ---

function UpstreamCommitsSection({ upstreamCommits }) {
  const [expanded, setExpanded] = useState(false)
  const commits = upstreamCommits || []

  if (commits.length === 0) return null

  const totalCommits = commits.reduce(
    (sum, repo) => sum + (repo.commits?.length || 0),
    0
  )

  return (
    <div className="space-y-2">
      <button
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        Upstream Commits ({totalCommits} across {commits.length} repo{commits.length !== 1 ? 's' : ''})
      </button>

      {expanded && (
        <div className="space-y-3 pl-5">
          {commits.map((repo, ri) => (
            <div key={ri} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium font-mono text-foreground">
                  {repo.repo}
                </span>
                {repo.compare_url && (
                  <a
                    href={repo.compare_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline"
                  >
                    compare
                  </a>
                )}
              </div>
              <div className="space-y-1">
                {(repo.commits || []).map((commit, ci) => (
                  <div key={ci} className="flex items-start gap-2 text-xs">
                    <a
                      href={`https://github.com/${repo.repo}/commit/${commit.sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-primary hover:underline shrink-0"
                    >
                      {commit.sha?.slice(0, 7)}
                    </a>
                    <span className="text-muted-foreground truncate">
                      {commit.message?.split('\n')[0]}
                    </span>
                    <span className="text-muted-foreground/60 shrink-0 ml-auto">
                      {commit.author}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Phase timeline stepper ---

function PhaseStep({ phase, buildLogs, isLast }) {
  const [showLogs, setShowLogs] = useState(false)

  // Find the build log for the latest build in this phase
  const latestBuildLog = buildLogs?.find(
    (log) => log.build_id === phase.last_build_id
  )

  return (
    <div className="flex gap-3">
      {/* Vertical line + dot */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={`w-3 h-3 rounded-full border-2 shrink-0 ${
            phase.fix_verified
              ? 'bg-emerald-500 border-emerald-500'
              : phase.ticket_id
              ? 'bg-primary border-primary'
              : 'bg-background border-muted-foreground/40'
          }`}
        >
          {phase.fix_verified && (
            <svg
              className="w-full h-full text-white p-px"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 6L5 8.5L9.5 3.5" />
            </svg>
          )}
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-6 bg-muted-foreground/20" />
        )}
      </div>

      {/* Phase content */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-foreground">
                Phase {phase.phase_number}
              </span>
              {phase.fix_verified && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                >
                  Cleared
                </Badge>
              )}
            </div>
            <p className="text-sm text-foreground/90 leading-snug">
              {phase.summary || phase.matched_pattern || 'Unknown error pattern'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {phase.build_count && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {phase.build_count} build{phase.build_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Error signature */}
        {phase.error_signature && (
          <div className="mt-1">
            <span className="text-[10px] font-mono text-muted-foreground/70 truncate block">
              sig: {phase.error_signature.slice(0, 24)}...
            </span>
          </div>
        )}

        {/* Ticket + PR links + action links */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {phase.ticket_id && phase.ticket_number ? (
            <span className="flex items-center gap-1">
              <span className="text-xs font-mono text-primary">
                CAPA-{phase.ticket_number}
              </span>
              {phase.ticket_status && (
                <TicketStatusBadge status={phase.ticket_status} />
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              No linked ticket
            </span>
          )}
          {phase.fix_pr_url && (
            <a
              href={phase.fix_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              {extractPrLabel(phase.fix_pr_url)}
            </a>
          )}
          {phase.latest_job_url && (
            <a
              href={phase.latest_job_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View latest build
            </a>
          )}
        </div>

        {/* Error lines toggle */}
        {latestBuildLog?.error_extract && (
          <div className="mt-2">
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowLogs(!showLogs)}
            >
              {showLogs ? 'Hide' : 'Show'} error output
            </button>
            {showLogs && (
              <ErrorLinesBlock
                errorExtract={latestBuildLog.error_extract}
                errorLines={latestBuildLog.error_lines}
                className="mt-1.5"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function extractPrLabel(url) {
  if (!url) return 'PR'
  const match = url.match(/pull\/(\d+)/)
  return match ? `PR #${match[1]}` : 'PR'
}

// --- Main StreakDetail component ---

export function StreakDetail({ streakId }) {
  const { streak, buildLogs, loading, error } = useStreakDetail(streakId)

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        <div className="h-3 w-32 bg-muted animate-pulse rounded" />
        <div className="h-20 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load streak detail: {error.message}
      </div>
    )
  }

  if (!streak) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Streak data not available.
      </div>
    )
  }

  const phases = streak.phases || []
  const upstreamCommits = streak.upstream_commits || []

  return (
    <div className="space-y-4 py-3 px-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground">
              {streak.job_name}
            </span>
            <StreakStatusBadge status={streak.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {streak.streak_length} day{streak.streak_length !== 1 ? 's' : ''}
            </span>
            <span>{streak.phase_count} phase{streak.phase_count !== 1 ? 's' : ''}</span>
            <span>Started {formatDate(streak.started_at)}</span>
            {streak.ended_at && (
              <span>Ended {formatDate(streak.ended_at)}</span>
            )}
          </div>
        </div>
        {/* Action links */}
        <div className="flex items-center gap-2 shrink-0">
          {streak.latest_job_url && (
            <a
              href={streak.latest_job_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View latest build
            </a>
          )}
        </div>
      </div>

      <Separator />

      {/* Phase Timeline */}
      {phases.length > 0 ? (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Phase Timeline
          </span>
          <div className="mt-2">
            {phases.map((phase, i) => (
              <PhaseStep
                key={phase.phase_number || i}
                phase={phase}
                buildLogs={buildLogs}
                isLast={i === phases.length - 1}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No phases detected yet.</p>
      )}

      {/* Upstream Commits */}
      {upstreamCommits.length > 0 && (
        <>
          <Separator />
          <UpstreamCommitsSection upstreamCommits={upstreamCommits} />
        </>
      )}

      {/* Analysis Summary */}
      {streak.analysis_summary && (
        <>
          <Separator />
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Analysis
            </span>
            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {streak.analysis_summary}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function formatDate(timestamp) {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
