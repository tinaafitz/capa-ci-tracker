import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders default title and description', () => {
    render(<EmptyState />)
    expect(screen.getByText('No results found')).toBeInTheDocument()
    expect(screen.getByText('No items match your current filters.')).toBeInTheDocument()
  })

  it('renders custom title and description', () => {
    render(
      <EmptyState
        title="No tickets yet"
        description="Create your first ticket to get started."
      />
    )
    expect(screen.getByText('No tickets yet')).toBeInTheDocument()
    expect(screen.getByText('Create your first ticket to get started.')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <EmptyState icon={<span data-testid="custom-icon">icon</span>} />
    )
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('does not render icon when not provided', () => {
    const { container } = render(<EmptyState />)
    // The icon wrapper has the class "text-muted-foreground" and is a div with mb-4
    // When no icon is provided, that wrapper div should not appear
    expect(container.querySelector('div.text-muted-foreground.mb-4')).toBeNull()
  })

  it('renders action button when actionLabel and onAction are provided', () => {
    const handleAction = vi.fn()
    render(<EmptyState actionLabel="Create Ticket" onAction={handleAction} />)
    expect(screen.getByText('Create Ticket')).toBeInTheDocument()
  })

  it('does not render action button when actionLabel is missing', () => {
    render(<EmptyState onAction={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not render action button when onAction is missing', () => {
    render(<EmptyState actionLabel="Create" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('calls onAction when action button is clicked', async () => {
    const user = userEvent.setup()
    const handleAction = vi.fn()
    render(<EmptyState actionLabel="Create Ticket" onAction={handleAction} />)

    await user.click(screen.getByText('Create Ticket'))
    expect(handleAction).toHaveBeenCalledTimes(1)
  })
})
