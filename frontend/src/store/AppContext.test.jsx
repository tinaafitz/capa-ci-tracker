import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { render, screen } from '@testing-library/react'
import {
  AppProvider,
  useAppState,
  useAppDispatch,
  useAppActions,
  useAuthContext,
} from './AppContext'

// Mock useAuth so AppProvider does not call real Supabase.
// IMPORTANT: The return value must be a stable reference to prevent
// the useEffect([auth.user]) in AppProvider from looping infinitely.
const stableUser = { id: 'test-user', email: 'test@redhat.com' }
const stableSession = { access_token: 'tok' }
const stableSignIn = vi.fn()
const stableSignOut = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: stableUser,
    session: stableSession,
    loading: false,
    signIn: stableSignIn,
    signOut: stableSignOut,
  }),
}))

// Mock supabase client (needed by useAuth even though we mock useAuth itself)
vi.mock('@/config/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: vi.fn((r) => r({ data: [], error: null, count: 0 })),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}))

function wrapper({ children }) {
  return <AppProvider>{children}</AppProvider>
}

describe('AppContext reducer', () => {
  // Test the reducer through dispatch, via useAppDispatch + useAppState
  function useDispatchAndState() {
    return {
      state: useAppState(),
      dispatch: useAppDispatch(),
    }
  }

  it('starts with initial state', () => {
    const { result } = renderHook(() => useAppState(), { wrapper })
    expect(result.current.tickets).toEqual([])
    expect(result.current.builds).toEqual([])
    expect(result.current.activities).toEqual([])
    expect(result.current.selectedTicket).toBeNull()
    expect(result.current.ticketDetailOpen).toBe(false)
    expect(result.current.commandPaletteOpen).toBe(false)
    expect(result.current.filters.tickets.status).toBe('open')
  })

  describe('SET_TICKETS', () => {
    it('replaces the tickets array', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })
      const tickets = [{ id: '1' }, { id: '2' }]

      act(() => {
        result.current.dispatch({ type: 'SET_TICKETS', payload: tickets })
      })

      expect(result.current.state.tickets).toEqual(tickets)
    })
  })

  describe('SET_BUILDS', () => {
    it('replaces the builds array', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })
      const builds = [{ id: 'b1' }]

      act(() => {
        result.current.dispatch({ type: 'SET_BUILDS', payload: builds })
      })

      expect(result.current.state.builds).toEqual(builds)
    })
  })

  describe('SET_ACTIVITIES', () => {
    it('replaces the activities array', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_ACTIVITIES', payload: [{ id: 'a1' }] })
      })

      expect(result.current.state.activities).toEqual([{ id: 'a1' }])
    })
  })

  describe('PREPEND_ACTIVITIES', () => {
    it('prepends new activities to existing ones', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_ACTIVITIES', payload: [{ id: 'old' }] })
      })
      act(() => {
        result.current.dispatch({ type: 'PREPEND_ACTIVITIES', payload: [{ id: 'new' }] })
      })

      expect(result.current.state.activities).toEqual([{ id: 'new' }, { id: 'old' }])
    })
  })

  describe('SET_FILTERS', () => {
    it('merges filters for the specified scope', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_FILTERS',
          scope: 'tickets',
          payload: { severity: 'nightly_blocker' },
        })
      })

      expect(result.current.state.filters.tickets.severity).toBe('nightly_blocker')
      // other ticket filters should remain
      expect(result.current.state.filters.tickets.status).toBe('open')
    })

    it('does not affect other filter scopes', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_FILTERS',
          scope: 'builds',
          payload: { status: 'failure' },
        })
      })

      expect(result.current.state.filters.builds.status).toBe('failure')
      expect(result.current.state.filters.tickets.status).toBe('open') // unchanged
    })
  })

  describe('SELECT_TICKET', () => {
    it('sets selectedTicket and opens ticket detail', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })
      const ticket = { id: 't1', title: 'Test' }

      act(() => {
        result.current.dispatch({ type: 'SELECT_TICKET', payload: ticket })
      })

      expect(result.current.state.selectedTicket).toEqual(ticket)
      expect(result.current.state.ticketDetailOpen).toBe(true)
    })

    it('sets ticketDetailOpen to false when payload is null', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SELECT_TICKET', payload: { id: 't1' } })
      })
      act(() => {
        result.current.dispatch({ type: 'SELECT_TICKET', payload: null })
      })

      expect(result.current.state.selectedTicket).toBeNull()
      expect(result.current.state.ticketDetailOpen).toBe(false)
    })
  })

  describe('SELECT_BUILD', () => {
    it('sets selectedBuild and opens build detail', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SELECT_BUILD', payload: { id: 'b1' } })
      })

      expect(result.current.state.selectedBuild).toEqual({ id: 'b1' })
      expect(result.current.state.buildDetailOpen).toBe(true)
    })
  })

  describe('CLOSE_TICKET_DETAIL', () => {
    it('clears selectedTicket and closes detail', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SELECT_TICKET', payload: { id: 't1' } })
      })
      act(() => {
        result.current.dispatch({ type: 'CLOSE_TICKET_DETAIL' })
      })

      expect(result.current.state.selectedTicket).toBeNull()
      expect(result.current.state.ticketDetailOpen).toBe(false)
    })
  })

  describe('CLOSE_BUILD_DETAIL', () => {
    it('clears selectedBuild and closes detail', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SELECT_BUILD', payload: { id: 'b1' } })
      })
      act(() => {
        result.current.dispatch({ type: 'CLOSE_BUILD_DETAIL' })
      })

      expect(result.current.state.selectedBuild).toBeNull()
      expect(result.current.state.buildDetailOpen).toBe(false)
    })
  })

  describe('ADD_ACTIVITY', () => {
    it('prepends a single activity', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_ACTIVITIES', payload: [{ id: 'old' }] })
      })
      act(() => {
        result.current.dispatch({ type: 'ADD_ACTIVITY', payload: { id: 'new' } })
      })

      expect(result.current.state.activities[0]).toEqual({ id: 'new' })
      expect(result.current.state.activities[1]).toEqual({ id: 'old' })
    })
  })

  describe('UPDATE_TICKET', () => {
    it('updates matching ticket in list', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_TICKETS',
          payload: [
            { id: 't1', title: 'Old', status: 'new' },
            { id: 't2', title: 'Other', status: 'new' },
          ],
        })
      })
      act(() => {
        result.current.dispatch({
          type: 'UPDATE_TICKET',
          payload: { id: 't1', status: 'investigating' },
        })
      })

      expect(result.current.state.tickets[0].status).toBe('investigating')
      expect(result.current.state.tickets[0].title).toBe('Old') // preserved
      expect(result.current.state.tickets[1].status).toBe('new') // unchanged
    })

    it('updates selectedTicket if it matches', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SELECT_TICKET',
          payload: { id: 't1', title: 'My Ticket', status: 'new' },
        })
      })
      act(() => {
        result.current.dispatch({
          type: 'UPDATE_TICKET',
          payload: { id: 't1', status: 'resolved' },
        })
      })

      expect(result.current.state.selectedTicket.status).toBe('resolved')
      expect(result.current.state.selectedTicket.title).toBe('My Ticket')
    })

    it('does not update selectedTicket if it does not match', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SELECT_TICKET',
          payload: { id: 't1', status: 'new' },
        })
      })
      act(() => {
        result.current.dispatch({
          type: 'UPDATE_TICKET',
          payload: { id: 't2', status: 'resolved' },
        })
      })

      expect(result.current.state.selectedTicket.id).toBe('t1')
      expect(result.current.state.selectedTicket.status).toBe('new')
    })
  })

  describe('ADD_TICKET', () => {
    it('prepends a ticket to the list', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_TICKETS', payload: [{ id: 't1' }] })
      })
      act(() => {
        result.current.dispatch({ type: 'ADD_TICKET', payload: { id: 't-new' } })
      })

      expect(result.current.state.tickets[0].id).toBe('t-new')
    })
  })

  describe('REMOVE_TICKET', () => {
    it('removes ticket by id', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_TICKETS',
          payload: [{ id: 't1' }, { id: 't2' }],
        })
      })
      act(() => {
        result.current.dispatch({ type: 'REMOVE_TICKET', payload: 't1' })
      })

      expect(result.current.state.tickets).toEqual([{ id: 't2' }])
    })
  })

  describe('UPDATE_BUILD', () => {
    it('updates matching build in list', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_BUILDS',
          payload: [{ id: 'b1', status: 'running' }],
        })
      })
      act(() => {
        result.current.dispatch({
          type: 'UPDATE_BUILD',
          payload: { id: 'b1', status: 'success' },
        })
      })

      expect(result.current.state.builds[0].status).toBe('success')
    })

    it('updates selectedBuild if it matches', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SELECT_BUILD',
          payload: { id: 'b1', status: 'running' },
        })
      })
      act(() => {
        result.current.dispatch({
          type: 'UPDATE_BUILD',
          payload: { id: 'b1', status: 'failure' },
        })
      })

      expect(result.current.state.selectedBuild.status).toBe('failure')
    })
  })

  describe('ADD_BUILD', () => {
    it('prepends a build to the list', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'ADD_BUILD', payload: { id: 'b-new' } })
      })

      expect(result.current.state.builds[0].id).toBe('b-new')
    })
  })

  describe('loading states', () => {
    it('SET_TICKETS_LOADING sets ticketsLoading', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_TICKETS_LOADING', payload: true })
      })
      expect(result.current.state.ticketsLoading).toBe(true)

      act(() => {
        result.current.dispatch({ type: 'SET_TICKETS_LOADING', payload: false })
      })
      expect(result.current.state.ticketsLoading).toBe(false)
    })

    it('SET_BUILDS_LOADING sets buildsLoading', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_BUILDS_LOADING', payload: true })
      })
      expect(result.current.state.buildsLoading).toBe(true)
    })

    it('SET_ACTIVITIES_LOADING sets activitiesLoading', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_ACTIVITIES_LOADING', payload: true })
      })
      expect(result.current.state.activitiesLoading).toBe(true)
    })
  })

  describe('TOGGLE_COMMAND_PALETTE', () => {
    it('toggles commandPaletteOpen from false to true', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      expect(result.current.state.commandPaletteOpen).toBe(false)

      act(() => {
        result.current.dispatch({ type: 'TOGGLE_COMMAND_PALETTE' })
      })
      expect(result.current.state.commandPaletteOpen).toBe(true)
    })

    it('toggles commandPaletteOpen from true to false', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'TOGGLE_COMMAND_PALETTE' })
      })
      act(() => {
        result.current.dispatch({ type: 'TOGGLE_COMMAND_PALETTE' })
      })
      expect(result.current.state.commandPaletteOpen).toBe(false)
    })
  })

  describe('SET_COMMAND_PALETTE_OPEN', () => {
    it('sets commandPaletteOpen to the given value', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: true })
      })
      expect(result.current.state.commandPaletteOpen).toBe(true)

      act(() => {
        result.current.dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: false })
      })
      expect(result.current.state.commandPaletteOpen).toBe(false)
    })
  })

  describe('SET_USER', () => {
    it('sets the user', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_USER',
          payload: { id: 'u1', email: 'a@redhat.com' },
        })
      })

      expect(result.current.state.user).toEqual({ id: 'u1', email: 'a@redhat.com' })
    })
  })

  describe('SET_COUNTS', () => {
    it('merges counts into existing counts', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      act(() => {
        result.current.dispatch({
          type: 'SET_COUNTS',
          payload: { openTickets: 5 },
        })
      })

      expect(result.current.state.counts.openTickets).toBe(5)
      expect(result.current.state.counts.failedBuilds).toBe(0) // unchanged
    })
  })

  describe('unknown action', () => {
    it('returns state unchanged for unknown action type', () => {
      const { result } = renderHook(() => useDispatchAndState(), { wrapper })

      const stateBefore = result.current.state

      act(() => {
        result.current.dispatch({ type: 'TOTALLY_UNKNOWN_ACTION' })
      })

      // State object reference should be the same (reducer returns state as-is)
      expect(result.current.state).toBe(stateBefore)
    })
  })
})

describe('useAppActions', () => {
  it('returns action creators that dispatch to the reducer', () => {
    const { result } = renderHook(
      () => ({
        actions: useAppActions(),
        state: useAppState(),
      }),
      { wrapper: ({ children }) => <AppProvider>{children}</AppProvider> }
    )

    act(() => {
      result.current.actions.setTickets([{ id: 'x' }])
    })
    expect(result.current.state.tickets).toEqual([{ id: 'x' }])

    act(() => {
      result.current.actions.toggleCommandPalette()
    })
    expect(result.current.state.commandPaletteOpen).toBe(true)

    act(() => {
      result.current.actions.selectTicket({ id: 'st1' })
    })
    expect(result.current.state.selectedTicket).toEqual({ id: 'st1' })
    expect(result.current.state.ticketDetailOpen).toBe(true)

    act(() => {
      result.current.actions.closeTicketDetail()
    })
    expect(result.current.state.ticketDetailOpen).toBe(false)
    expect(result.current.state.selectedTicket).toBeNull()
  })
})

describe('useAuthContext', () => {
  it('provides auth context from useAuth hook', () => {
    const { result } = renderHook(() => useAuthContext(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    })

    expect(result.current.user).toBe(stableUser)
    expect(result.current.loading).toBe(false)
    expect(typeof result.current.signIn).toBe('function')
    expect(typeof result.current.signOut).toBe('function')
  })
})

describe('context hooks outside provider', () => {
  it('useAppState throws without AppProvider', () => {
    expect(() => {
      renderHook(() => useAppState())
    }).toThrow('useAppState must be used within an AppProvider')
  })

  it('useAppDispatch throws without AppProvider', () => {
    expect(() => {
      renderHook(() => useAppDispatch())
    }).toThrow('useAppDispatch must be used within an AppProvider')
  })

  it('useAuthContext throws without AppProvider', () => {
    expect(() => {
      renderHook(() => useAuthContext())
    }).toThrow('useAuthContext must be used within an AppProvider')
  })
})
