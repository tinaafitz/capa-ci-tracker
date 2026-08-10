import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TicketsPage } from './TicketsPage'

// Mock all child components to isolate the page-level test
vi.mock('@/components/tickets/TicketList', () => ({
  TicketList: () => <div data-testid="ticket-list">TicketList</div>,
}))
vi.mock('@/components/tickets/TicketKanban', () => ({
  TicketKanban: () => <div data-testid="ticket-kanban">TicketKanban</div>,
}))
vi.mock('@/components/tickets/TicketDetail', () => ({
  TicketDetail: () => <div data-testid="ticket-detail">TicketDetail</div>,
}))
vi.mock('@/components/tickets/TicketCreateModal', () => ({
  TicketCreateModal: () => <div data-testid="ticket-create-modal">TicketCreateModal</div>,
}))

// Mock the hooks and context
vi.mock('@/hooks/useTickets', () => ({
  useTickets: () => ({
    data: [],
    loading: false,
    error: null,
    count: 0,
    totalPages: 0,
    page: 1,
    pageSize: 20,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/store/AppContext', () => ({
  useAppState: () => ({
    selectedTicket: null,
    ticketDetailOpen: false,
  }),
  useAppActions: () => ({
    selectTicket: vi.fn(),
    closeTicketDetail: vi.fn(),
  }),
}))

describe('TicketsPage', () => {
  function renderPage() {
    return render(
      <MemoryRouter>
        <TicketsPage />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderPage()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
  })

  it('shows the "New Ticket" button', () => {
    renderPage()
    expect(screen.getByText('New Ticket')).toBeInTheDocument()
  })

  it('renders the kanban view by default', () => {
    renderPage()
    expect(screen.getByTestId('ticket-kanban')).toBeInTheDocument()
  })

  it('renders the ticket detail component', () => {
    renderPage()
    expect(screen.getByTestId('ticket-detail')).toBeInTheDocument()
  })

  it('renders the ticket create modal component', () => {
    renderPage()
    expect(screen.getByTestId('ticket-create-modal')).toBeInTheDocument()
  })

  it('renders view toggle buttons for board and table', () => {
    renderPage()
    expect(screen.getByTitle('Board view')).toBeInTheDocument()
    expect(screen.getByTitle('Table view')).toBeInTheDocument()
  })
})
