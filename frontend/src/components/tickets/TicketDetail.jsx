import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TicketStatusBadge,
  getNextStatus,
  getAdvanceLabel,
} from './TicketStatusBadge'
import { TicketPipelineStepper } from './TicketPipelineStepper'
import { SeverityBadge, SEVERITY_ORDER } from './SeverityBadge'
import { TaskChecklist } from './TaskChecklist'
import { SopReferenceCards } from './SopReferenceCards'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ErrorLinesBlock } from '@/components/pipeline/StreakDetail'
import { supabase } from '@/config/supabase'
import { useAppActions } from '@/store/AppContext'
import { useBuildLogs, useTicketStreak } from '@/hooks/useStreaks'
import { toast } from 'sonner'

export function TicketDetail({ ticket, open, onOpenChange }) {
  const navigate = useNavigate()
  const { updateTicket, selectBuild } = useAppActions()

  const [tasks, setTasks] = useState([])
  const [activities, setActivities] = useState([])
  const [noteText, setNoteText] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [fixPrUrl, setFixPrUrl] = useState('')
  const [editingRootCause, setEditingRootCause] = useState(false)
  const [submittingNote, setSubmittingNote] = useState(false)
  const [activeTab, setActiveTab] = useState('diagnosis')
  const [streakExpanded, setStreakExpanded] = useState(false)
  const [upstreamExpanded, setUpstreamExpanded] = useState(false)

  // Fetch build logs for error context
  const { buildLog } = useBuildLogs(ticket?.build_id)

  // Fetch streak data if ticket has a streak_id
  const { streak } = useTicketStreak(ticket?.streak_id)

  // Load tasks and activities when ticket changes
  useEffect(() => {
    if (!ticket?.id) return

    setRootCause(ticket.root_cause || '')
    setFixPrUrl(ticket.fix_pr_url || '')

    // Fetch tasks
    supabase
      .from('tasks')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => setTasks(data || []))

    // Fetch scoped activities
    supabase
      .from('activities')
      .select('*')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setActivities(data || []))
  }, [ticket?.id, ticket?.root_cause, ticket?.fix_pr_url])

  // Poll tasks and activities every 30 seconds (replaces Supabase Realtime)
  useEffect(() => {
    if (!ticket?.id) return

    const pollData = () => {
      supabase
        .from('tasks')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('sort_order', { ascending: true })
        .then(({ data }) => setTasks(data || []))

      supabase
        .from('activities')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data }) => setActivities(data || []))
    }

    const interval = setInterval(pollData, 30000)
    return () => clearInterval(interval)
  }, [ticket?.id])

  const handleAdvanceStatus = useCallback(async () => {
    if (!ticket) return
    const next = getNextStatus(ticket.status)
    if (!next) return

    // Only send status -- the record_status_change trigger in Postgres
    // handles setting resolved_at and verified_at automatically
    const updates = { status: next }

    const { error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticket.id)

    if (error) {
      toast.error('Failed to update status')
    } else {
      updateTicket({ id: ticket.id, ...updates })
      toast.success(`Status advanced to ${next.replace('_', ' ')}`)
    }
  }, [ticket, updateTicket])

  const handleSaveRootCause = useCallback(async () => {
    if (!ticket) return

    const updates = { root_cause: rootCause }
    if (rootCause.trim() && !ticket.diagnosed_at) {
      updates.diagnosed_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticket.id)

    if (error) {
      toast.error('Failed to save root cause')
    } else {
      updateTicket({ id: ticket.id, ...updates })
      setEditingRootCause(false)
      toast.success('Root cause saved')
    }
  }, [ticket, rootCause, updateTicket])

  const handleLinkPR = useCallback(async () => {
    if (!ticket || !fixPrUrl.trim()) return

    const updates = { fix_pr_url: fixPrUrl.trim() }

    // Auto-advance to fix_in_progress if currently root_caused
    if (ticket.status === 'root_caused') {
      updates.status = 'fix_in_progress'
    }

    const { error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', ticket.id)

    if (error) {
      toast.error('Failed to link PR')
    } else {
      updateTicket({ id: ticket.id, ...updates })
      await supabase.from('activities').insert({
        activity_type: 'fix_submitted',
        title: `Fix PR linked to CAPA-${ticket.ticket_number}`,
        description: fixPrUrl.trim(),
        ticket_id: ticket.id,
        actor: 'user',
      })
      if (updates.status) {
        toast.success('PR linked. Status auto-advanced to Fix In Progress.')
      } else {
        toast.success('PR linked')
      }
    }
  }, [ticket, fixPrUrl, updateTicket])

  const handleChangeSeverity = useCallback(
    async (newSeverity) => {
      if (!ticket) return

      const { error } = await supabase
        .from('support_tickets')
        .update({ severity: newSeverity })
        .eq('id', ticket.id)

      if (!error) {
        updateTicket({ id: ticket.id, severity: newSeverity })
        toast.success(`Severity changed to ${newSeverity.replace('_', ' ')}`)
      }
    },
    [ticket, updateTicket]
  )

  const handleChangeAssignee = useCallback(
    async (newAssignee) => {
      if (!ticket) return

      const { error } = await supabase
        .from('support_tickets')
        .update({ assignee: newAssignee || null })
        .eq('id', ticket.id)

      if (!error) {
        updateTicket({ id: ticket.id, assignee: newAssignee || null })
      }
    },
    [ticket, updateTicket]
  )

  const handleAddNote = useCallback(async () => {
    if (!ticket || !noteText.trim()) return
    setSubmittingNote(true)

    try {
      const { error } = await supabase.from('activities').insert({
        activity_type: 'note_added',
        title: `Note added to CAPA-${ticket.ticket_number}`,
        description: noteText.trim(),
        ticket_id: ticket.id,
        actor: 'user',
      })

      if (error) {
        toast.error('Failed to add note')
      } else {
        setNoteText('')
        toast.success('Note added')
      }
    } finally {
      setSubmittingNote(false)
    }
  }, [ticket, noteText])

  const handleBuildClick = useCallback(
    (build) => {
      onOpenChange(false)
      navigate('/transactions')
      setTimeout(() => selectBuild(build), 50)
    },
    [navigate, onOpenChange, selectBuild]
  )

  if (!ticket) return null

  const advanceLabel = getAdvanceLabel(ticket.status)
  const linkedBuild = ticket.builds

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[65vw] min-w-[800px] max-w-[1200px] p-0 sm:max-w-[1200px]"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-6 py-4 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-muted-foreground">
                    CAPA-{ticket.ticket_number}
                  </span>
                  <TicketStatusBadge status={ticket.status} />
                </div>
                <SheetTitle className="text-lg text-left">
                  {ticket.title}
                </SheetTitle>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4 space-y-6">
              {/* Lifecycle Pipeline */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Lifecycle Pipeline
                  </Label>
                  <TicketStatusBadge status={ticket.status} />
                </div>
                <TicketPipelineStepper
                  buildFailedAt={linkedBuild?.finished_at}
                  ticketCreatedAt={ticket.created_at}
                  diagnosedAt={ticket.diagnosed_at}
                  prSubmittedAt={ticket.fix_pr_url ? ticket.updated_at : null}
                  prMergedAt={ticket.pr_merged_at}
                  verifiedAt={ticket.verified_at}
                  buildJobUrl={linkedBuild?.job_url}
                  buildExternalId={linkedBuild?.external_id}
                  buildSource={linkedBuild?.source || 'jenkins'}
                  fixPrUrl={ticket.fix_pr_url}
                  fixPrNumber={ticket.fix_pr_number}
                  verifyBuildJobUrl={ticket.verify_build?.job_url}
                  verifyBuildExternalId={ticket.verify_build?.external_id}
                />
                {advanceLabel && (
                  <Button size="sm" onClick={handleAdvanceStatus}>
                    {advanceLabel}
                  </Button>
                )}
              </div>

              {/* Streak banner -- shown when ticket is part of a failure streak */}
              {streak && (
                <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 2L3 14h10L8 2z" />
                        <path d="M8 6v4M8 12h.01" />
                      </svg>
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        Part of a {streak.streak_length}-day failure streak on{' '}
                        <span className="font-mono text-xs">{streak.job_name}</span>
                      </span>
                    </div>
                    <button
                      className="text-xs text-amber-700 dark:text-amber-300 hover:underline"
                      onClick={() => setStreakExpanded(!streakExpanded)}
                    >
                      {streakExpanded ? 'Collapse' : 'View streak'}
                    </button>
                  </div>

                  {streakExpanded && streak.phases?.length > 0 && (
                    <div className="mt-2 space-y-2 pl-6">
                      {streak.phases.map((phase, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${
                            phase.fix_verified
                              ? 'bg-emerald-500'
                              : 'bg-amber-500'
                          }`} />
                          <span className="font-medium text-foreground">
                            Phase {phase.phase_number}:
                          </span>
                          <span className="text-muted-foreground truncate">
                            {phase.summary || phase.matched_pattern || 'Unknown'}
                          </span>
                          {phase.fix_verified && (
                            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                              Cleared
                            </Badge>
                          )}
                          {phase.fix_pr_url && (
                            <a
                              href={phase.fix_pr_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {extractPrLabel(phase.fix_pr_url)}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error lines from build log */}
              {buildLog?.error_extract && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      Error Output
                    </Label>
                    <CopyErrorButton ticket={ticket} buildLog={buildLog} streak={streak} />
                  </div>
                  <ErrorLinesBlock
                    errorExtract={buildLog.error_extract}
                    errorLines={buildLog.error_lines}
                  />
                </div>
              )}

              {/* Upstream commits from streak */}
              {streak?.upstream_commits?.length > 0 && (
                <div className="space-y-2">
                  <button
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                    onClick={() => setUpstreamExpanded(!upstreamExpanded)}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${upstreamExpanded ? 'rotate-90' : ''}`}
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <span className="uppercase tracking-wide">Upstream Commits</span>
                    <span className="normal-case tracking-normal text-muted-foreground/60">
                      ({streak.upstream_commits.reduce((s, r) => s + (r.commits?.length || 0), 0)} commits)
                    </span>
                  </button>

                  {upstreamExpanded && (
                    <div className="space-y-3 pl-5">
                      {streak.upstream_commits.map((repo, ri) => (
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
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Severity</Label>
                    <Select
                      value={ticket.severity}
                      onValueChange={handleChangeSeverity}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue>
                          <SeverityBadge severity={ticket.severity} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITY_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Assignee</Label>
                    <Input
                      className="h-8 text-sm"
                      placeholder="Unassigned"
                      defaultValue={ticket.assignee || ''}
                      onBlur={(e) => handleChangeAssignee(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">OCP Version</Label>
                    <span className="block text-sm font-mono">
                      {linkedBuild?.ocp_version || ticket.ocp_version || '--'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Created</Label>
                    <span className="block text-sm text-muted-foreground">
                      {formatRelativeTime(ticket.created_at)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Linked Build</Label>
                    {linkedBuild ? (
                      <button
                        className="flex items-center gap-2 text-sm hover:underline text-left"
                        onClick={() => handleBuildClick(linkedBuild)}
                      >
                        <span className="font-mono">#{linkedBuild.external_id}</span>
                        <StatusBadge status={linkedBuild.status} />
                      </button>
                    ) : (
                      <span className="block text-sm text-muted-foreground">--</span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Fix PR</Label>
                    {ticket.fix_pr_url ? (
                      <a
                        href={ticket.fix_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm hover:underline block truncate"
                      >
                        {ticket.fix_pr_url}
                      </a>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-sm flex-1"
                          placeholder="github.com/org/repo/pull/123"
                          value={fixPrUrl}
                          onChange={(e) => setFixPrUrl(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={handleLinkPR}
                          disabled={!fixPrUrl.trim()}
                        >
                          Link
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Verify Build</Label>
                    <span className="block text-sm text-muted-foreground">
                      {ticket.verified_in_build_id || '--'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Error Signature</Label>
                    <span className="block text-sm font-mono truncate text-muted-foreground">
                      {ticket.error_signature || '--'}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Root Cause */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                    Root Cause
                  </Label>
                  {!editingRootCause && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setEditingRootCause(true)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                {editingRootCause ? (
                  <div className="space-y-2">
                    <Textarea
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      placeholder="Describe the root cause..."
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveRootCause}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRootCause(ticket.root_cause || '')
                          setEditingRootCause(false)
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {ticket.root_cause || 'No root cause identified yet.'}
                  </p>
                )}
              </div>

              <Separator />

              {/* Tabbed Content */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="diagnosis" className="mt-4 space-y-4">
                  {/* SOP references for matched diagnosis pattern */}
                  <SopReferenceCards matchedPattern={ticket.matched_pattern} />

                  {/* Add note */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Add a note</Label>
                    <Textarea
                      placeholder="Add a diagnosis note..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                    />
                    <Button
                      size="sm"
                      onClick={handleAddNote}
                      disabled={!noteText.trim() || submittingNote}
                    >
                      {submittingNote ? 'Adding...' : 'Add Note'}
                    </Button>
                  </div>

                  <Separator />

                  {/* Notes thread */}
                  <div className="space-y-3">
                    {activities
                      .filter((a) => a.activity_type === 'note_added')
                      .map((note) => (
                        <div
                          key={note.id}
                          className="rounded-md border border-border p-3 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">
                              @{note.actor}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(note.created_at)}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {note.description}
                          </p>
                        </div>
                      ))}
                    {activities.filter((a) => a.activity_type === 'note_added')
                      .length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No notes yet. Add the first diagnosis note above.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="tasks" className="mt-4">
                  <TaskChecklist
                    tasks={tasks}
                    ticketId={ticket.id}
                    onTasksChange={setTasks}
                  />
                </TabsContent>

                <TabsContent value="timeline" className="mt-4">
                  <div className="space-y-3">
                    {activities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-start gap-3 text-sm"
                      >
                        <div className="mt-1 h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{activity.title}</span>
                          {activity.description && (
                            <p className="text-muted-foreground truncate">
                              {activity.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(activity.created_at)}
                        </span>
                      </div>
                    ))}
                    {activities.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No activity recorded yet.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="logs" className="mt-4">
                  <div className="rounded-md bg-muted p-4">
                    <ScrollArea className="h-80">
                      {linkedBuild?.test_failures?.length > 0 ? (
                        <div className="space-y-4">
                          {linkedBuild.test_failures.map((failure, i) => (
                            <div key={i} className="space-y-1">
                              <div className="font-mono text-xs font-medium text-foreground">
                                {failure.className}.{failure.name}
                              </div>
                              <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                                {failure.errorMessage}
                              </pre>
                              {failure.errorStackTrace && (
                                <details className="mt-1">
                                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                    Stack trace
                                  </summary>
                                  <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all mt-1 pl-2 border-l-2 border-border leading-relaxed">
                                    {failure.errorStackTrace}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No failure logs available.
                          {!linkedBuild && ' Link a build to view test failure output.'}
                        </p>
                      )}
                    </ScrollArea>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function extractPrLabel(url) {
  if (!url) return 'PR'
  const match = url.match(/pull\/(\d+)/)
  return match ? `PR #${match[1]}` : 'PR'
}

/**
 * Copy a markdown-formatted snippet with ticket context to the clipboard.
 * Includes ticket number, error signature, error lines, and upstream commits.
 */
function CopyErrorButton({ ticket, buildLog, streak }) {
  const handleCopy = useCallback(() => {
    const parts = []

    parts.push(`## CAPA-${ticket.ticket_number}: ${ticket.title}`)
    parts.push('')

    if (ticket.error_signature) {
      parts.push(`**Error signature:** \`${ticket.error_signature}\``)
    }
    if (ticket.severity) {
      parts.push(`**Severity:** ${ticket.severity.replace(/_/g, ' ')}`)
    }
    if (ticket.root_cause) {
      parts.push(`**Root cause:** ${ticket.root_cause}`)
    }
    parts.push('')

    if (buildLog?.error_extract) {
      parts.push('### Error output')
      parts.push('```')
      parts.push(buildLog.error_extract.trim())
      parts.push('```')
      parts.push('')
    }

    if (streak?.upstream_commits?.length > 0) {
      parts.push('### Upstream commits')
      for (const repo of streak.upstream_commits) {
        parts.push(`**${repo.repo}**`)
        for (const commit of repo.commits || []) {
          parts.push(`- [\`${commit.sha?.slice(0, 7)}\`](https://github.com/${repo.repo}/commit/${commit.sha}) ${commit.message?.split('\n')[0]}`)
        }
        if (repo.compare_url) {
          parts.push(`  [Compare](${repo.compare_url})`)
        }
      }
    }

    const markdown = parts.join('\n')
    navigator.clipboard.writeText(markdown).then(() => {
      toast.success('Copied to clipboard')
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }, [ticket, buildLog, streak])

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-xs gap-1"
      onClick={handleCopy}
    >
      <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="5" width="9" height="9" rx="1" />
        <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" />
      </svg>
      Copy
    </Button>
  )
}

/**
 * Format a timestamp to relative time (e.g. "2h ago", "3d ago").
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '--'
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`

  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
