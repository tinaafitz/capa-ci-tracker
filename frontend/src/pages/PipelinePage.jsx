import { useState, useCallback } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PipelineFunnel } from '@/components/pipeline/PipelineFunnel'
import { PipelineTicketList } from '@/components/pipeline/PipelineTicketList'
import { TicketDetail } from '@/components/tickets/TicketDetail'
import { useLifecyclePipeline, usePipelineFunnel } from '@/hooks/useLifecycleData'
import { useAppState, useAppActions } from '@/store/AppContext'

const severityOptions = [
  { value: 'all', label: 'All Severities' },
  { value: 'nightly_blocker', label: 'Nightly Blocker' },
  { value: 'test_regression', label: 'Test Regression' },
  { value: 'flaky', label: 'Flaky' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'upstream_breakage', label: 'Upstream Breakage' },
]

const dateRangeOptions = [
  { value: 'all', label: 'All Time' },
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

const stageOptions = [
  { value: 'all', label: 'All Stages' },
  { value: '2', label: 'Ticket Created' },
  { value: '3', label: 'Diagnosed' },
  { value: '4', label: 'PR Submitted' },
  { value: '5', label: 'PR Merged' },
  { value: '6', label: 'Verified' },
]

export function PipelinePage() {
  const { selectedTicket, ticketDetailOpen } = useAppState()
  const { selectTicket, closeTicketDetail } = useAppActions()

  const [severity, setSeverity] = useState('all')
  const [dateRange, setDateRange] = useState('30')
  const [stageFilter, setStageFilter] = useState('all')

  const { data: tickets, loading: ticketsLoading } = useLifecyclePipeline({
    severity,
    dateRange,
    stageFilter,
  })

  const { data: funnelData, loading: funnelLoading } = usePipelineFunnel()

  const handleTicketClick = useCallback(
    (ticket) => {
      selectTicket(ticket)
    },
    [selectTicket]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">Pipeline</h2>
            <span className="text-xs text-muted-foreground">
              Failure-to-fix lifecycle
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {severityOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dateRangeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-5">
        <PipelineFunnel data={funnelData} loading={funnelLoading} />
        <PipelineTicketList
          tickets={tickets}
          loading={ticketsLoading}
          onTicketClick={handleTicketClick}
        />
      </div>

      {/* Ticket detail sheet (reused from Tickets page) */}
      <TicketDetail
        ticket={selectedTicket}
        open={ticketDetailOpen}
        onOpenChange={(open) => {
          if (!open) closeTicketDetail()
        }}
      />
    </div>
  )
}
