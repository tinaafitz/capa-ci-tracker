import { useState, useCallback } from 'react'
import { FilterSelect } from '@/components/shared/FilterSelect'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { PipelineFunnel } from '@/components/pipeline/PipelineFunnel'
import { PipelineSlaTiles } from '@/components/pipeline/PipelineSlaTiles'
import { PipelineTicketList } from '@/components/pipeline/PipelineTicketList'
import { StreakList } from '@/components/pipeline/StreakList'
import { TicketDetail } from '@/components/tickets/TicketDetail'
import { useLifecyclePipeline, usePipelineFunnel } from '@/hooks/useLifecycleData'
import { useActiveStreakCount } from '@/hooks/useStreaks'
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
  const [activeTab, setActiveTab] = useState('funnel')

  const { data: tickets, loading: ticketsLoading } = useLifecyclePipeline({
    severity,
    dateRange,
    stageFilter,
  })

  const { data: funnelData, loading: funnelLoading } = usePipelineFunnel()

  const activeStreakCount = useActiveStreakCount()

  const handleTicketClick = useCallback(
    (ticket) => {
      selectTicket(ticket)
    },
    [selectTicket]
  )

  // Numeric selected stage derived from the string stage filter, for funnel highlight.
  const selectedStage = stageFilter !== 'all' ? parseInt(stageFilter, 10) : null

  // Clicking a funnel stage filters the ticket table; clicking the same stage clears it.
  const handleStageSelect = useCallback(
    (ordinal) => {
      setStageFilter((prev) =>
        prev === String(ordinal) ? 'all' : String(ordinal)
      )
    },
    []
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
          {/* Show filters only on the funnel tab */}
          {activeTab === 'funnel' && (
            <div className="flex items-center gap-2">
              <FilterSelect
                value={severity}
                onValueChange={setSeverity}
                options={severityOptions}
                className="h-8 w-[150px] text-xs"
              />

              <FilterSelect
                value={stageFilter}
                onValueChange={setStageFilter}
                options={stageOptions}
                className="h-8 w-[140px] text-xs"
              />

              <FilterSelect
                value={dateRange}
                onValueChange={setDateRange}
                options={dateRangeOptions}
                className="h-8 w-[130px] text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab navigation + content */}
      <div className="flex-1 overflow-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="px-6 pt-3">
            <TabsList>
              <TabsTrigger value="funnel">Resolution Funnel</TabsTrigger>
              <TabsTrigger value="streaks" className="gap-1.5">
                Failure Streaks
                {activeStreakCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="ml-1 h-4 min-w-4 px-1 text-[10px] font-bold"
                  >
                    {activeStreakCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="funnel" className="px-6 py-5 space-y-5">
            <div className="max-w-5xl">
              <PipelineSlaTiles tickets={tickets} loading={ticketsLoading} />
            </div>
            <div className="max-w-5xl">
              <PipelineFunnel
                data={funnelData}
                loading={funnelLoading}
                selectedStage={selectedStage}
                onStageSelect={handleStageSelect}
              />
            </div>
            <PipelineTicketList
              tickets={tickets}
              loading={ticketsLoading}
              onTicketClick={handleTicketClick}
            />
          </TabsContent>

          <TabsContent value="streaks" className="px-6 py-5">
            <StreakList />
          </TabsContent>
        </Tabs>
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
