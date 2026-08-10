import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge'
import { useAppActions } from '@/store/AppContext'
import { supabase } from '@/config/supabase'

export function BuildDetail({ build, open, onOpenChange }) {
  const navigate = useNavigate()
  const { selectTicket } = useAppActions()
  const [linkedTickets, setLinkedTickets] = useState([])
  const [expandedFailure, setExpandedFailure] = useState(null)

  // Load linked tickets
  useEffect(() => {
    if (!build?.id) return

    supabase
      .from('support_tickets')
      .select('id, ticket_number, title, status, severity')
      .eq('build_id', build.id)
      .then(({ data }) => setLinkedTickets(data || []))
  }, [build?.id])

  const handleTicketClick = useCallback(
    (ticket) => {
      onOpenChange(false)
      navigate('/tickets')
      setTimeout(() => selectTicket(ticket), 50)
    },
    [navigate, onOpenChange, selectTicket]
  )

  if (!build) return null

  const totalTests =
    (build.pass_count || 0) + (build.fail_count || 0) + (build.skip_count || 0)
  const passRate =
    totalTests > 0 ? Math.round((build.pass_count / totalTests) * 100) : 0
  const testFailures = build.test_failures || []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[50vw] min-w-[600px] max-w-[900px] p-0 sm:max-w-[900px]"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-6 py-4 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-muted-foreground">
                    Build #{build.external_id}
                  </span>
                  <StatusBadge status={build.status} />
                </div>
                <SheetTitle className="text-lg text-left">
                  {build.job_name}
                </SheetTitle>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4 space-y-6">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source</Label>
                  <span className="block text-sm capitalize">{build.source}</span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">OCP Version</Label>
                  <span className="block text-sm font-mono">
                    {build.ocp_version || '--'}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Started</Label>
                  <span className="block text-sm text-muted-foreground">
                    {build.started_at
                      ? new Date(build.started_at).toLocaleString()
                      : '--'}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Finished</Label>
                  <span className="block text-sm text-muted-foreground">
                    {build.finished_at
                      ? new Date(build.finished_at).toLocaleString()
                      : '--'}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Duration</Label>
                  <span className="block text-sm font-mono">
                    {formatDuration(build.duration_ms)}
                  </span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Job URL</Label>
                  {build.job_url ? (
                    <a
                      href={build.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm hover:underline block truncate text-primary"
                    >
                      View in {build.source}
                    </a>
                  ) : (
                    <span className="block text-sm text-muted-foreground">--</span>
                  )}
                </div>
              </div>

              <Separator />

              {/* Test Results Summary */}
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Test Results
                </Label>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="text-sm font-medium">
                      {build.pass_count || 0} passed
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-500" />
                    <span className="text-sm font-medium">
                      {build.fail_count || 0} failed
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-gray-400" />
                    <span className="text-sm font-medium">
                      {build.skip_count || 0} skipped
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                {totalTests > 0 && (
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{
                        width: `${((build.pass_count || 0) / totalTests) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-red-500 transition-all"
                      style={{
                        width: `${((build.fail_count || 0) / totalTests) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-gray-400 transition-all"
                      style={{
                        width: `${((build.skip_count || 0) / totalTests) * 100}%`,
                      }}
                    />
                  </div>
                )}

                <span className="text-xs text-muted-foreground">
                  {passRate}% pass rate ({totalTests} total tests)
                </span>
              </div>

              {/* Test Failures */}
              {testFailures.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Test Failures ({testFailures.length})
                    </Label>
                    <div className="rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs h-8">Test</TableHead>
                            <TableHead className="text-xs h-8">Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {testFailures.map((failure, index) => (
                            <TableRow
                              key={index}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() =>
                                setExpandedFailure(
                                  expandedFailure === index ? null : index
                                )
                              }
                            >
                              <TableCell className="py-2 align-top w-1/3">
                                <div className="space-y-0.5">
                                  <span className="text-xs font-mono font-medium block">
                                    {failure.name}
                                  </span>
                                  {failure.className && (
                                    <span className="text-xs font-mono text-muted-foreground block truncate">
                                      {failure.className}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-2 align-top">
                                <p className="text-xs text-muted-foreground line-clamp-2 font-mono">
                                  {failure.errorMessage}
                                </p>
                                {expandedFailure === index &&
                                  failure.errorStackTrace && (
                                    <pre className="mt-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all bg-muted p-2 rounded max-h-48 overflow-auto leading-relaxed">
                                      {failure.errorStackTrace}
                                    </pre>
                                  )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}

              {/* Linked Tickets */}
              <Separator />
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Linked Tickets ({linkedTickets.length})
                </Label>
                {linkedTickets.length > 0 ? (
                  <div className="space-y-2">
                    {linkedTickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition-colors"
                        onClick={() => handleTicketClick(ticket)}
                      >
                        <span className="font-mono text-xs">
                          CAPA-{ticket.ticket_number}
                        </span>
                        <span className="text-sm truncate flex-1">
                          {ticket.title}
                        </span>
                        <TicketStatusBadge status={ticket.status} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tickets linked to this build.
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatDuration(ms) {
  if (!ms) return '--'
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60

  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${minutes}m`
}
