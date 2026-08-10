import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  TicketStatusBadge,
  TICKET_STATUSES,
  getNextStatus,
  getAdvanceLabel,
} from './TicketStatusBadge'

describe('TicketStatusBadge', () => {
  it('renders the correct label for "new" status', () => {
    render(<TicketStatusBadge status="new" />)
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('renders the correct label for "investigating" status', () => {
    render(<TicketStatusBadge status="investigating" />)
    expect(screen.getByText('Investigating')).toBeInTheDocument()
  })

  it('renders the correct label for "root_caused" status', () => {
    render(<TicketStatusBadge status="root_caused" />)
    expect(screen.getByText('Root Caused')).toBeInTheDocument()
  })

  it('renders the correct label for "fix_in_progress" status', () => {
    render(<TicketStatusBadge status="fix_in_progress" />)
    expect(screen.getByText('Fix In Progress')).toBeInTheDocument()
  })

  it('renders the correct label for "resolved" status', () => {
    render(<TicketStatusBadge status="resolved" />)
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('renders the correct label for "verified" status', () => {
    render(<TicketStatusBadge status="verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('falls back to "New" for unknown status', () => {
    render(<TicketStatusBadge status="nonexistent" />)
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('renders all six statuses correctly', () => {
    const labels = ['New', 'Investigating', 'Root Caused', 'Fix In Progress', 'Resolved', 'Verified']
    TICKET_STATUSES.forEach((status, i) => {
      const { unmount } = render(<TicketStatusBadge status={status} />)
      expect(screen.getByText(labels[i])).toBeInTheDocument()
      unmount()
    })
  })
})

describe('TICKET_STATUSES', () => {
  it('contains all six statuses in pipeline order', () => {
    expect(TICKET_STATUSES).toEqual([
      'new',
      'investigating',
      'root_caused',
      'fix_in_progress',
      'resolved',
      'verified',
    ])
  })
})

describe('getNextStatus', () => {
  it('returns investigating for new', () => {
    expect(getNextStatus('new')).toBe('investigating')
  })

  it('returns root_caused for investigating', () => {
    expect(getNextStatus('investigating')).toBe('root_caused')
  })

  it('returns fix_in_progress for root_caused', () => {
    expect(getNextStatus('root_caused')).toBe('fix_in_progress')
  })

  it('returns resolved for fix_in_progress', () => {
    expect(getNextStatus('fix_in_progress')).toBe('resolved')
  })

  it('returns verified for resolved', () => {
    expect(getNextStatus('resolved')).toBe('verified')
  })

  it('returns null for verified (terminal state)', () => {
    expect(getNextStatus('verified')).toBeNull()
  })

  it('returns null for unknown status', () => {
    expect(getNextStatus('nonexistent')).toBeNull()
  })
})

describe('getAdvanceLabel', () => {
  it('returns "Advance to Investigating" for new', () => {
    expect(getAdvanceLabel('new')).toBe('Advance to Investigating')
  })

  it('returns "Advance to Root Caused" for investigating', () => {
    expect(getAdvanceLabel('investigating')).toBe('Advance to Root Caused')
  })

  it('returns "Advance to Fix In Progress" for root_caused', () => {
    expect(getAdvanceLabel('root_caused')).toBe('Advance to Fix In Progress')
  })

  it('returns "Advance to Resolved" for fix_in_progress', () => {
    expect(getAdvanceLabel('fix_in_progress')).toBe('Advance to Resolved')
  })

  it('returns "Advance to Verified" for resolved', () => {
    expect(getAdvanceLabel('resolved')).toBe('Advance to Verified')
  })

  it('returns null for verified (no next status)', () => {
    expect(getAdvanceLabel('verified')).toBeNull()
  })

  it('returns null for unknown status', () => {
    expect(getAdvanceLabel('nonexistent')).toBeNull()
  })
})
