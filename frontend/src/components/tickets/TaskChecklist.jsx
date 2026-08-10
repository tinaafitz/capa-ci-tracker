import { useState, useCallback } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { supabase } from '@/config/supabase'

export function TaskChecklist({ tasks = [], ticketId, onTasksChange }) {
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [updating, setUpdating] = useState({})

  const completedCount = tasks.filter((t) => t.status === 'done').length
  const totalCount = tasks.length

  const handleToggleTask = useCallback(
    async (task) => {
      const newStatus = task.status === 'done' ? 'open' : 'done'
      setUpdating((prev) => ({ ...prev, [task.id]: true }))

      try {
        const updates = {
          status: newStatus,
          completed_at: newStatus === 'done' ? new Date().toISOString() : null,
        }

        const { error } = await supabase
          .from('tasks')
          .update(updates)
          .eq('id', task.id)

        if (!error && onTasksChange) {
          onTasksChange(
            tasks.map((t) => (t.id === task.id ? { ...t, ...updates } : t))
          )
        }
      } finally {
        setUpdating((prev) => ({ ...prev, [task.id]: false }))
      }
    },
    [tasks, onTasksChange]
  )

  const handleAddTask = useCallback(
    async (e) => {
      if (e.key !== 'Enter' || !newTaskTitle.trim()) return

      const title = newTaskTitle.trim()
      setNewTaskTitle('')

      const maxOrder = tasks.reduce((max, t) => Math.max(max, t.sort_order || 0), 0)

      const { data, error } = await supabase
        .from('tasks')
        .insert({
          ticket_id: ticketId,
          title,
          status: 'open',
          sort_order: maxOrder + 1,
        })
        .select()
        .single()

      if (!error && data && onTasksChange) {
        onTasksChange([...tasks, data])
      }
    },
    [newTaskTitle, tasks, ticketId, onTasksChange]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          Tasks ({completedCount}/{totalCount} complete)
        </span>
      </div>

      <div className="space-y-2">
        {tasks
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
          .map((task) => (
            <div key={task.id} className="flex items-center gap-3 group">
              <Checkbox
                id={`task-${task.id}`}
                checked={task.status === 'done'}
                disabled={updating[task.id]}
                onCheckedChange={() => handleToggleTask(task)}
              />
              <Label
                htmlFor={`task-${task.id}`}
                className={`text-sm cursor-pointer flex-1 ${
                  task.status === 'done'
                    ? 'line-through text-muted-foreground'
                    : 'text-foreground'
                } ${updating[task.id] ? 'opacity-50' : ''}`}
              >
                {task.title}
              </Label>
              {task.assignee && (
                <span className="text-xs text-muted-foreground">
                  @{task.assignee}
                </span>
              )}
            </div>
          ))}
      </div>

      {/* Add task inline */}
      <div className="flex items-center gap-3">
        <Checkbox disabled className="opacity-30" />
        <Input
          placeholder="Add a task... (press Enter)"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={handleAddTask}
          className="h-8 text-sm border-dashed"
        />
      </div>
    </div>
  )
}
