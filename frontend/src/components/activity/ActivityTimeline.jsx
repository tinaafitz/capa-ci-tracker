import { useState, useRef, useMemo, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ActivityCard } from './ActivityCard'

const COLLAPSE_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const COLLAPSE_THRESHOLD = 3 // collapse when 3+ consecutive duplicates

/**
 * Group consecutive activities with the same activity_type + ticket_id
 * that fall within a 5-minute window. Returns an array of items where
 * each can be a single activity or a collapsed group.
 */
function collapseRepeats(items) {
  if (!items || items.length === 0) return []

  const result = []
  let i = 0

  while (i < items.length) {
    const current = items[i]
    const group = [current]

    // Look ahead for consecutive matching activities
    let j = i + 1
    while (j < items.length) {
      const next = items[j]
      if (
        next.activity_type === current.activity_type &&
        next.ticket_id === current.ticket_id &&
        current.ticket_id != null &&
        Math.abs(
          new Date(current.created_at).getTime() -
            new Date(next.created_at).getTime()
        ) < COLLAPSE_WINDOW_MS
      ) {
        group.push(next)
        j++
      } else {
        break
      }
    }

    if (group.length >= COLLAPSE_THRESHOLD) {
      result.push({ _collapsed: true, items: group, representative: current })
    } else {
      group.forEach((item) => result.push(item))
    }

    i = j
  }

  return result
}

function CollapsedGroup({ group }) {
  const [expanded, setExpanded] = useState(false)
  const { representative, items } = group
  const count = items.length

  const ticketLabel =
    representative.support_tickets
      ? `CAPA-${representative.support_tickets.ticket_number}`
      : representative.ticket_id
      ? `ticket`
      : ''

  const typeLabels = {
    build_completed: 'build events',
    ticket_created: 'tickets created',
    ticket_updated: 'ticket updates',
    note_added: 'notes added',
    diagnosis_completed: 'diagnoses',
    fix_submitted: 'fixes submitted',
    fix_merged: 'fixes merged',
    notification_sent: 'notifications',
  }

  const typeLabel = typeLabels[representative.activity_type] || 'events'

  return (
    <div>
      <button
        className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{count}</span>{' '}
          {typeLabel}
          {ticketLabel && (
            <>
              {' '}for{' '}
              <span className="font-mono text-primary">{ticketLabel}</span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-border/50 border-l-2 border-muted ml-4">
          {items.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ActivityTimeline({ groupedByDay, newEventCount = 0, onJumpToTop }) {
  const scrollRef = useRef(null)
  const [isScrolledDown, setIsScrolledDown] = useState(false)

  // Collapse repetitive events within each day group
  const processedGroups = useMemo(() => {
    if (!groupedByDay) return []
    return groupedByDay.map((group) => ({
      ...group,
      items: collapseRepeats(group.items),
    }))
  }, [groupedByDay])

  const handleScroll = useCallback((e) => {
    const target = e?.target
    if (target) {
      setIsScrolledDown(target.scrollTop > 100)
    }
  }, [])

  const handleJumpToTop = useCallback(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
    setIsScrolledDown(false)
    if (onJumpToTop) onJumpToTop()
  }, [onJumpToTop])

  if (!groupedByDay || groupedByDay.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <svg
          className="h-12 w-12 text-muted-foreground/30 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <h3 className="text-sm font-medium text-foreground mb-1">No recent activity</h3>
        <p className="text-xs text-muted-foreground">
          Activity from builds, tickets, and agent actions will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {/* Floating "new events" pill */}
      {isScrolledDown && newEventCount > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <Button
            size="sm"
            className="rounded-full shadow-lg h-7 text-xs gap-1"
            onClick={handleJumpToTop}
          >
            {newEventCount} new event{newEventCount !== 1 ? 's' : ''}
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </Button>
        </div>
      )}

      <ScrollArea
        ref={scrollRef}
        className="h-full"
        onScrollCapture={handleScroll}
      >
        <div className="divide-y divide-border">
          {processedGroups.map((group) => (
            <div key={group.label}>
              {/* Day header */}
              <div className="sticky top-0 z-[5] bg-background/95 backdrop-blur-sm px-4 py-2 border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </span>
              </div>

              {/* Events for this day */}
              <div className="divide-y divide-border/50">
                {group.items.map((item, index) =>
                  item._collapsed ? (
                    <CollapsedGroup
                      key={`collapsed-${item.representative.id}`}
                      group={item}
                    />
                  ) : (
                    <ActivityCard
                      key={item.id}
                      activity={item}
                      isNew={index === 0 && group.label === 'TODAY'}
                    />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
