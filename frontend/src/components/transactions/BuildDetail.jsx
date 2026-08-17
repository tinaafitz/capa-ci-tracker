import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge'
import { supabase } from '@/config/supabase'
import { formatRelative, formatAbsolute } from '@/lib/utils'

function formatDuration(ms) {
  if (ms == null) return '--'
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  if (hours > 0) return `${hours}h ${remainingMins}m`
  return `${minutes}m`
}

export function BuildDetail({ build, open, onOpenChange }) {
  const [linkedTicket, setLinkedTicket] = useState(null)
  const [logExcerpt, setLogExcerpt] = useState(null)

  // Load linked ticket
  useEffect(() => {
    if (!build?.id) return
    let cancelled = false

    supabase
      .from('support_tickets')
      .select('id, ticket_number, title, status, severity')
      .eq('build_id', build.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setLinkedTicket(data || null)
      })

    return () => {
      cancelled = true
    }
  }, [build?.id])

  // Load log excerpt
  useEffect(() => {
    if (!build?.id) return
    let cancelled = false

    supabase
      .from('build_logs')
      .select('log_text, error_extract')
      .eq('build_id', build.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setLogExcerpt(data?.error_extract || data?.log_text || null)
      })

    return () => {
      cancelled = true
    }
  }, [build?.id])

  if (!build) return null

  const pass = build.pass_count || 0
  const fail = build.fail_count || 0
  const skip = build.skip_count || 0
  const totalTests = pass + fail + skip
  const passRate = totalTests > 0 ? Math.round((pass / totalTests) * 100) : 0
  const testFailures = build.test_failures || []

  const logLines = logExcerpt
    ? logExcerpt.split('\n').slice(0, 30).join('\n')
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] max-w-[480px] p-0">
        <div className="flex flex-col h-full">
          {/* 1. Build header */}
          <SheetHeader className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-muted-foreground">
                Build #{build.external_id}
              </span>
              <StatusBadge status={build.status} />
            </div>
            <SheetTitle className="text-base text-left font-mono break-all">
              {build.job_name}
            </SheetTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
              <span className="capitalize">{build.source}</span>
              <span>·</span>
              <span title={formatAbsolute(build.started_at)}>
                {formatRelative(build.started_at)}
              </span>
              <span>·</span>
              <span className="font-mono">{formatDuration(build.duration_ms)}</span>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-5 py-4 space-y-6">
              {/* 2. Test summary */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Test Summary
                </Label>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-emerald-600 font-medium">{pass} pass</span>
                  <span
                    className={
                      fail > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'
                    }
                  >
                    {fail} fail
                  </span>
                  <span className="text-muted-foreground">{skip} skip</span>
                </div>
                {totalTests > 0 && (
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${(pass / totalTests) * 100}%` }}
                    />
                    <div
                      className="bg-red-500"
                      style={{ width: `${(fail / totalTests) * 100}%` }}
                    />
                    <div
                      className="bg-gray-400"
                      style={{ width: `${(skip / totalTests) * 100}%` }}
                    />
                  </div>
                )}
                <span className="text-xs text-muted-foreground">
                  {passRate}% pass rate ({totalTests} total)
                </span>
              </div>

              <Separator />

              {/* 3. Linked ticket */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Linked Ticket
                </Label>
                {linkedTicket ? (
                  <Link
                    to={`/tickets/${linkedTicket.id}`}
                    onClick={() => onOpenChange(false)}
                    className="block"
                  >
                    <Card className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors">
                      <span className="font-mono text-xs font-medium">
                        CAPA-{linkedTicket.ticket_number}
                      </span>
                      <span className="text-sm truncate flex-1">
                        {linkedTicket.title}
                      </span>
                      <TicketStatusBadge status={linkedTicket.status} />
                    </Card>
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">No ticket created.</p>
                )}
              </div>

              <Separator />

              {/* 4. Log excerpt */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Log Excerpt
                </Label>
                {logLines ? (
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all bg-muted p-3 rounded max-h-64 overflow-auto leading-relaxed">
                    {logLines}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No log available.</p>
                )}
              </div>

              {/* 5. Test failures */}
              {testFailures.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Test Failures ({testFailures.length})
                    </Label>
                    <div className="space-y-2">
                      {testFailures.map((failure, index) => (
                        <Card key={index} className="px-3 py-2 space-y-1">
                          <span className="text-xs font-mono font-medium block break-all">
                            {failure.name}
                          </span>
                          {failure.className && (
                            <span className="text-xs font-mono text-muted-foreground block break-all">
                              {failure.className}
                            </span>
                          )}
                          {failure.errorMessage && (
                            <p className="text-xs text-muted-foreground font-mono break-all">
                              {failure.errorMessage}
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
