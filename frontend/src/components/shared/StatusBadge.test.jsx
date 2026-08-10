import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders "Passed" for success status', () => {
    render(<StatusBadge status="success" />)
    expect(screen.getByText('Passed')).toBeInTheDocument()
  })

  it('renders "Failed" for failure status', () => {
    render(<StatusBadge status="failure" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders "Running" for running status', () => {
    render(<StatusBadge status="running" />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders "Pending" for pending status', () => {
    render(<StatusBadge status="pending" />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders "Aborted" for aborted status', () => {
    render(<StatusBadge status="aborted" />)
    expect(screen.getByText('Aborted')).toBeInTheDocument()
  })

  it('renders "Unstable" for unstable status', () => {
    render(<StatusBadge status="unstable" />)
    expect(screen.getByText('Unstable')).toBeInTheDocument()
  })

  it('falls back to "Pending" for unknown status', () => {
    render(<StatusBadge status="some_unknown_status" />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('falls back to "Pending" for undefined status', () => {
    render(<StatusBadge status={undefined} />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders all known statuses without errors', () => {
    const statuses = ['success', 'failure', 'running', 'pending', 'aborted', 'unstable']
    const labels = ['Passed', 'Failed', 'Running', 'Pending', 'Aborted', 'Unstable']

    statuses.forEach((status, i) => {
      const { unmount } = render(<StatusBadge status={status} />)
      expect(screen.getByText(labels[i])).toBeInTheDocument()
      unmount()
    })
  })
})
