import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useAppState, useAppActions } from '@/store/AppContext'
import { supabase } from '@/config/supabase'

export function CommandPalette() {
  const { commandPaletteOpen } = useAppState()
  const { setCommandPaletteOpen, toggleCommandPalette, selectTicket, selectBuild } = useAppActions()
  const navigate = useNavigate()

  const [searchResults, setSearchResults] = useState({
    tickets: [],
    builds: [],
  })
  const [searchQuery, setSearchQuery] = useState('')

  // Cmd+K global listener -- dispatch toggle action to avoid stale closure
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleCommandPalette])

  // Search when query changes
  const searchAll = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setSearchResults({ tickets: [], builds: [] })
      return
    }

    // Use separate queries instead of .or() with string interpolation
    // to avoid filter injection via user input containing commas/parens
    const ticketNumber = parseInt(query, 10)

    const [ticketRes, buildRes] = await Promise.all([
      ticketNumber > 0
        ? supabase
            .from('support_tickets')
            .select('id, ticket_number, title, status, severity')
            .or(`title.ilike.%${query.replace(/[%_,()]/g, '')}%,ticket_number.eq.${ticketNumber}`)
            .limit(5)
        : supabase
            .from('support_tickets')
            .select('id, ticket_number, title, status, severity')
            .ilike('title', `%${query.replace(/[%_]/g, '')}%`)
            .limit(5),
      supabase
        .from('builds')
        .select('id, external_id, job_name, status, started_at')
        .or(`external_id.ilike.%${query.replace(/[%_,()]/g, '')}%,job_name.ilike.%${query.replace(/[%_,()]/g, '')}%`)
        .limit(5),
    ])

    setSearchResults({
      tickets: ticketRes.data || [],
      builds: buildRes.data || [],
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchAll(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery, searchAll])

  function handleSelectTicket(ticket) {
    setCommandPaletteOpen(false)
    setSearchQuery('')
    navigate('/tickets')
    // Small delay to let navigation complete
    setTimeout(() => selectTicket(ticket), 50)
  }

  function handleSelectBuild(build) {
    setCommandPaletteOpen(false)
    setSearchQuery('')
    navigate('/transactions')
    setTimeout(() => selectBuild(build), 50)
  }

  function handleAction(action) {
    setCommandPaletteOpen(false)
    setSearchQuery('')
    switch (action) {
      case 'activity':
        navigate('/')
        break
      case 'tickets':
        navigate('/tickets')
        break
      case 'builds':
        navigate('/transactions')
        break
      case 'new-ticket':
        navigate('/tickets?create=true')
        break
      default:
        break
    }
  }

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={(open) => {
        setCommandPaletteOpen(open)
        if (!open) setSearchQuery('')
      }}
    >
      <CommandInput
        placeholder="Search tickets, builds, or type a command..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {searchResults.tickets.length > 0 && (
          <CommandGroup heading="Tickets">
            {searchResults.tickets.map((ticket) => (
              <CommandItem
                key={ticket.id}
                value={`ticket-${ticket.ticket_number}-${ticket.title}`}
                onSelect={() => handleSelectTicket(ticket)}
              >
                <span className="font-mono text-xs mr-2">
                  CAPA-{ticket.ticket_number}
                </span>
                <span className="truncate">{ticket.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searchResults.builds.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Builds">
              {searchResults.builds.map((build) => (
                <CommandItem
                  key={build.id}
                  value={`build-${build.external_id}-${build.job_name}`}
                  onSelect={() => handleSelectBuild(build)}
                >
                  <span className="font-mono text-xs mr-2">
                    #{build.external_id}
                  </span>
                  <span className="truncate">{build.job_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="Go to Activity Feed"
            onSelect={() => handleAction('activity')}
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Go to Activity Feed
          </CommandItem>
          <CommandItem
            value="Go to Tickets"
            onSelect={() => handleAction('tickets')}
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Go to Tickets
          </CommandItem>
          <CommandItem
            value="Go to Builds"
            onSelect={() => handleAction('builds')}
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Go to Builds
          </CommandItem>
          <CommandItem
            value="Create New Ticket"
            onSelect={() => handleAction('new-ticket')}
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create New Ticket
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
