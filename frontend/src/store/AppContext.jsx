import { createContext, useContext, useReducer, useCallback, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'

const AppContext = createContext(null)
const AppDispatchContext = createContext(null)
const AuthContext = createContext(null)

const initialState = {
  tickets: [],
  builds: [],
  activities: [],
  filters: {
    tickets: { status: 'open', severity: 'all', assignee: 'all', search: '' },
    builds: { job: 'all', status: 'all', dateRange: '7d' },
    activities: { type: 'all', dateRange: '24h', ticket: 'all' },
  },
  selectedTicket: null,
  selectedBuild: null,
  ticketsLoading: false,
  buildsLoading: false,
  activitiesLoading: false,
  ticketDetailOpen: false,
  buildDetailOpen: false,
  commandPaletteOpen: false,
  user: null,
  counts: {
    openTickets: 0,
    failedBuilds24h: 0,
  },
}

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_TICKETS':
      return { ...state, tickets: action.payload }
    case 'SET_BUILDS':
      return { ...state, builds: action.payload }
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.payload }
    case 'PREPEND_ACTIVITIES':
      return { ...state, activities: [...action.payload, ...state.activities] }
    case 'SET_FILTERS':
      return {
        ...state,
        filters: {
          ...state.filters,
          [action.scope]: { ...state.filters[action.scope], ...action.payload },
        },
      }
    case 'SELECT_TICKET':
      return {
        ...state,
        selectedTicket: action.payload,
        ticketDetailOpen: action.payload !== null,
      }
    case 'SELECT_BUILD':
      return {
        ...state,
        selectedBuild: action.payload,
        buildDetailOpen: action.payload !== null,
      }
    case 'CLOSE_TICKET_DETAIL':
      return { ...state, ticketDetailOpen: false, selectedTicket: null }
    case 'CLOSE_BUILD_DETAIL':
      return { ...state, buildDetailOpen: false, selectedBuild: null }
    case 'ADD_ACTIVITY':
      return { ...state, activities: [action.payload, ...state.activities] }
    case 'UPDATE_TICKET': {
      const updated = state.tickets.map((t) =>
        t.id === action.payload.id ? { ...t, ...action.payload } : t
      )
      const selectedTicket =
        state.selectedTicket?.id === action.payload.id
          ? { ...state.selectedTicket, ...action.payload }
          : state.selectedTicket
      return { ...state, tickets: updated, selectedTicket }
    }
    case 'ADD_TICKET':
      return { ...state, tickets: [action.payload, ...state.tickets] }
    case 'REMOVE_TICKET':
      return {
        ...state,
        tickets: state.tickets.filter((t) => t.id !== action.payload),
      }
    case 'UPDATE_BUILD': {
      const updated = state.builds.map((b) =>
        b.id === action.payload.id ? { ...b, ...action.payload } : b
      )
      const selectedBuild =
        state.selectedBuild?.id === action.payload.id
          ? { ...state.selectedBuild, ...action.payload }
          : state.selectedBuild
      return { ...state, builds: updated, selectedBuild }
    }
    case 'ADD_BUILD':
      return { ...state, builds: [action.payload, ...state.builds] }
    case 'SET_TICKETS_LOADING':
      return { ...state, ticketsLoading: action.payload }
    case 'SET_BUILDS_LOADING':
      return { ...state, buildsLoading: action.payload }
    case 'SET_ACTIVITIES_LOADING':
      return { ...state, activitiesLoading: action.payload }
    case 'SET_COMMAND_PALETTE_OPEN':
      return { ...state, commandPaletteOpen: action.payload }
    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen }
    case 'SET_USER':
      return { ...state, user: action.payload }
    case 'SET_COUNTS':
      return { ...state, counts: { ...state.counts, ...action.payload } }
    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const auth = useAuth()

  // Sync auth user into app state so existing consumers of state.user keep working
  useEffect(() => {
    dispatch({ type: 'SET_USER', payload: auth.user })
  }, [auth.user])

  return (
    <AuthContext.Provider value={auth}>
      <AppContext.Provider value={state}>
        <AppDispatchContext.Provider value={dispatch}>
          {children}
        </AppDispatchContext.Provider>
      </AppContext.Provider>
    </AuthContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppContext)
  if (context === null) {
    throw new Error('useAppState must be used within an AppProvider')
  }
  return context
}

export function useAppDispatch() {
  const context = useContext(AppDispatchContext)
  if (context === null) {
    throw new Error('useAppDispatch must be used within an AppProvider')
  }
  return context
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuthContext must be used within an AppProvider')
  }
  return context
}

export function useAppActions() {
  const dispatch = useAppDispatch()

  return {
    setTickets: useCallback((tickets) => dispatch({ type: 'SET_TICKETS', payload: tickets }), [dispatch]),
    setBuilds: useCallback((builds) => dispatch({ type: 'SET_BUILDS', payload: builds }), [dispatch]),
    setActivities: useCallback((activities) => dispatch({ type: 'SET_ACTIVITIES', payload: activities }), [dispatch]),
    prependActivities: useCallback((activities) => dispatch({ type: 'PREPEND_ACTIVITIES', payload: activities }), [dispatch]),
    setFilters: useCallback((scope, filters) => dispatch({ type: 'SET_FILTERS', scope, payload: filters }), [dispatch]),
    selectTicket: useCallback((ticket) => dispatch({ type: 'SELECT_TICKET', payload: ticket }), [dispatch]),
    selectBuild: useCallback((build) => dispatch({ type: 'SELECT_BUILD', payload: build }), [dispatch]),
    closeTicketDetail: useCallback(() => dispatch({ type: 'CLOSE_TICKET_DETAIL' }), [dispatch]),
    closeBuildDetail: useCallback(() => dispatch({ type: 'CLOSE_BUILD_DETAIL' }), [dispatch]),
    addActivity: useCallback((activity) => dispatch({ type: 'ADD_ACTIVITY', payload: activity }), [dispatch]),
    updateTicket: useCallback((ticket) => dispatch({ type: 'UPDATE_TICKET', payload: ticket }), [dispatch]),
    addTicket: useCallback((ticket) => dispatch({ type: 'ADD_TICKET', payload: ticket }), [dispatch]),
    removeTicket: useCallback((id) => dispatch({ type: 'REMOVE_TICKET', payload: id }), [dispatch]),
    updateBuild: useCallback((build) => dispatch({ type: 'UPDATE_BUILD', payload: build }), [dispatch]),
    addBuild: useCallback((build) => dispatch({ type: 'ADD_BUILD', payload: build }), [dispatch]),
    setTicketsLoading: useCallback((loading) => dispatch({ type: 'SET_TICKETS_LOADING', payload: loading }), [dispatch]),
    setBuildsLoading: useCallback((loading) => dispatch({ type: 'SET_BUILDS_LOADING', payload: loading }), [dispatch]),
    setActivitiesLoading: useCallback((loading) => dispatch({ type: 'SET_ACTIVITIES_LOADING', payload: loading }), [dispatch]),
    setCommandPaletteOpen: useCallback((open) => dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: open }), [dispatch]),
    toggleCommandPalette: useCallback(() => dispatch({ type: 'TOGGLE_COMMAND_PALETTE' }), [dispatch]),
    setUser: useCallback((user) => dispatch({ type: 'SET_USER', payload: user }), [dispatch]),
    setCounts: useCallback((counts) => dispatch({ type: 'SET_COUNTS', payload: counts }), [dispatch]),
  }
}
