import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const STAGES = [
  { key: 'build_failed', label: 'Build Failed', shortLabel: 'Failed', letter: 'F' },
  { key: 'ticket_created', label: 'Ticket Created', shortLabel: 'Created', letter: 'C' },
  { key: 'diagnosed', label: 'Root Cause Diagnosed', shortLabel: 'Diagnosed', letter: 'D' },
  { key: 'pr_submitted', label: 'PR Submitted', shortLabel: 'PR', letter: 'P' },
  { key: 'pr_merged', label: 'PR Merged', shortLabel: 'Merged', letter: 'M' },
  { key: 'verified', label: 'Fix Verified', shortLabel: 'Verified', letter: 'V' },
]

// Stage colors for the compact stepper
const STAGE_COLORS = {
  complete: {
    dot: 'bg-primary',
    connector: 'bg-primary/60',
  },
  current: {
    dot: 'bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-background',
  },
  future: {
    dot: 'bg-muted-foreground/15',
    connector: 'bg-muted-foreground/15',
  },
}

function getStageTimestamp(stage, props) {
  switch (stage.key) {
    case 'build_failed': return props.buildFailedAt
    case 'ticket_created': return props.ticketCreatedAt
    case 'diagnosed': return props.diagnosedAt
    case 'pr_submitted': return props.prSubmittedAt
    case 'pr_merged': return props.prMergedAt
    case 'verified': return props.verifiedAt
    default: return null
  }
}

function getStageLink(stage, props) {
  switch (stage.key) {
    case 'build_failed': return props.buildJobUrl
    case 'pr_submitted':
    case 'pr_merged': return props.fixPrUrl
    case 'verified': return props.verifyBuildJobUrl
    default: return null
  }
}

function getStageLinkLabel(stage, props) {
  switch (stage.key) {
    case 'build_failed':
      return props.buildSource === 'prow' ? 'Prow' : 'Jenkins'
    case 'pr_submitted':
    case 'pr_merged':
      return props.fixPrNumber ? `PR #${props.fixPrNumber}` : 'PR'
    case 'verified':
      return props.verifyBuildExternalId ? `#${props.verifyBuildExternalId}` : 'Build'
    default: return null
  }
}

function formatShortTime(timestamp) {
  if (!timestamp) return null
  const d = new Date(timestamp)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function CompactStepper({ currentStage }) {
  return (
    <div className="flex items-center gap-0 h-5 w-full min-w-[7rem]">
      {STAGES.map((stage, i) => {
        const isComplete = i < currentStage
        const isCurrent = i === currentStage - 1

        return (
          <div key={stage.key} className="flex items-center flex-1 min-w-0">
            <Tooltip delayDuration={0}>
              <TooltipTrigger
                render={
                  <div className="flex items-center justify-center shrink-0">
                    <div
                      className={`w-[14px] h-[14px] rounded-full flex items-center justify-center transition-all ${
                        isComplete
                          ? isCurrent
                            ? STAGE_COLORS.current.dot
                            : STAGE_COLORS.complete.dot
                          : STAGE_COLORS.future.dot
                      }`}
                    >
                      {/* Checkmark for completed, letter for current, empty for future */}
                      {isComplete && !isCurrent && (
                        <svg className="w-2 h-2 text-primary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6L5 8.5L9.5 3.5" />
                        </svg>
                      )}
                      {isCurrent && (
                        <span className="text-[7px] font-bold text-primary-foreground leading-none">
                          {stage.letter}
                        </span>
                      )}
                    </div>
                  </div>
                }
              />
              <TooltipContent side="top" className="text-xs">
                <div className="font-medium">{stage.label}</div>
                <div className="text-muted-foreground">
                  {isComplete ? (isCurrent ? 'Current stage' : 'Completed') : 'Pending'}
                </div>
              </TooltipContent>
            </Tooltip>
            {/* Connector line between dots */}
            {i < STAGES.length - 1 && (
              <div className={`flex-1 h-[2px] min-w-[3px] mx-px ${
                i < currentStage - 1
                  ? STAGE_COLORS.complete.connector
                  : STAGE_COLORS.future.connector
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function TicketPipelineStepper({
  buildFailedAt,
  ticketCreatedAt,
  diagnosedAt,
  prSubmittedAt,
  prMergedAt,
  verifiedAt,
  buildJobUrl,
  buildExternalId,
  buildSource,
  fixPrUrl,
  fixPrNumber,
  verifyBuildJobUrl,
  verifyBuildExternalId,
  compact = false,
}) {
  const props = {
    buildFailedAt, ticketCreatedAt, diagnosedAt, prSubmittedAt,
    prMergedAt, verifiedAt, buildJobUrl, buildExternalId,
    buildSource, fixPrUrl, fixPrNumber, verifyBuildJobUrl, verifyBuildExternalId,
  }

  // Determine current stage (1-indexed)
  let currentStage = 1
  if (verifiedAt) currentStage = 6
  else if (prMergedAt) currentStage = 5
  else if (fixPrUrl || prSubmittedAt) currentStage = 4
  else if (diagnosedAt) currentStage = 3
  else if (ticketCreatedAt) currentStage = 2

  if (compact) {
    return <CompactStepper currentStage={currentStage} />
  }

  return (
    <div className="flex items-start gap-0">
      {STAGES.map((stage, i) => {
        const timestamp = getStageTimestamp(stage, props)
        const link = getStageLink(stage, props)
        const linkLabel = getStageLinkLabel(stage, props)
        const isComplete = i < currentStage
        const isCurrent = i === currentStage - 1
        const isFuture = i >= currentStage

        return (
          <div key={stage.key} className="flex items-start flex-1 min-w-0">
            {/* Stage node + connector */}
            <div className="flex flex-col items-center">
              {/* Dot */}
              <div
                className={`w-3 h-3 rounded-full border-2 shrink-0 transition-colors ${
                  isComplete
                    ? 'bg-primary border-primary'
                    : isCurrent
                    ? 'bg-background border-primary ring-2 ring-primary/30'
                    : 'bg-background border-muted-foreground/30'
                }`}
              />
              {/* Label + timestamp below */}
              <div className="mt-2 text-center min-w-[5rem]">
                <div
                  className={`text-xs font-medium leading-tight ${
                    isFuture ? 'text-muted-foreground/50' : 'text-foreground'
                  }`}
                >
                  {stage.shortLabel}
                </div>
                {timestamp && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {formatShortTime(timestamp)}
                  </div>
                )}
                {link && isComplete && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline mt-0.5 block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {linkLabel}
                  </a>
                )}
              </div>
            </div>
            {/* Connector line */}
            {i < STAGES.length - 1 && (
              <div className="flex-1 flex items-center mt-[5px] min-w-3">
                <div
                  className={`h-0.5 w-full ${
                    i < currentStage - 1
                      ? 'bg-primary'
                      : 'bg-muted-foreground/20 border-t border-dashed border-muted-foreground/20 h-0'
                  }`}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
