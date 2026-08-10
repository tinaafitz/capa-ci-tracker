import { useState, useCallback } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { supabase } from '@/config/supabase'
import { toast } from 'sonner'

const severities = [
  { value: 'nightly_blocker', label: 'Nightly Blocker' },
  { value: 'test_regression', label: 'Test Regression' },
  { value: 'flaky', label: 'Flaky' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'upstream_breakage', label: 'Upstream Breakage' },
]

export function TicketCreateModal({ open, onOpenChange, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('test_regression')
  const [assignee, setAssignee] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const resetForm = useCallback(() => {
    setTitle('')
    setDescription('')
    setSeverity('test_regression')
    setAssignee('')
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    setSubmitting(true)

    try {
      // Create the ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          title: title.trim(),
          description: description.trim(),
          severity,
          assignee: assignee.trim() || null,
          status: 'new',
        })
        .select()
        .single()

      if (ticketError) {
        toast.error('Failed to create ticket', {
          description: ticketError.message,
        })
        return
      }

      // Create the activity
      await supabase.from('activities').insert({
        activity_type: 'ticket_created',
        title: `Ticket CAPA-${ticket.ticket_number} created`,
        description: `"${ticket.title}" - ${severity}`,
        ticket_id: ticket.id,
        actor: 'user',
      })

      // Create default tasks
      const defaultTasks = [
        'Investigate failure logs',
        'Identify root cause',
        'Submit fix PR',
        'Verify in next nightly',
      ]

      await supabase.from('tasks').insert(
        defaultTasks.map((taskTitle, index) => ({
          ticket_id: ticket.id,
          title: taskTitle,
          status: 'open',
          sort_order: index + 1,
        }))
      )

      toast.success(`Created ticket CAPA-${ticket.ticket_number}`)
      resetForm()
      onOpenChange(false)
      if (onCreated) onCreated(ticket)
    } catch (err) {
      toast.error('Unexpected error creating ticket')
    } finally {
      setSubmitting(false)
    }
  }, [title, description, severity, assignee, resetForm, onOpenChange, onCreated])

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Create New Ticket</AlertDialogTitle>
          <AlertDialogDescription>
            Create a new support ticket to track a CI failure or issue.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="ticket-title">Title *</Label>
            <Input
              id="ticket-title"
              placeholder="Brief description of the failure..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ticket-desc">Description</Label>
            <Textarea
              id="ticket-desc"
              placeholder="Additional details, error messages, reproduction steps..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {severities.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-assignee">Assignee</Label>
              <Input
                id="ticket-assignee"
                placeholder="@username"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              />
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} onClick={resetForm}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction disabled={submitting} onClick={handleSubmit}>
            {submitting ? 'Creating...' : 'Create Ticket'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
