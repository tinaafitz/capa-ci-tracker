import { useState, useRef, useEffect, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ActivityCard } from './ActivityCard'

export function ActivityTimeline({ groupedByDay, newEventCount = 0, onJumpToTop }) {
  const scrollRef = useRef(null)
  const [isScrolledDown, setIsScrolledDown] = useState(false)

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
          {groupedByDay.map((group) => (
            <div key={group.label}>
              {/* Day header */}
              <div className="sticky top-0 z-[5] bg-background/95 backdrop-blur-sm px-4 py-2 border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </span>
              </div>

              {/* Events for this day */}
              <div className="divide-y divide-border/50">
                {group.items.map((activity, index) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    isNew={index === 0 && group.label === 'TODAY'}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
