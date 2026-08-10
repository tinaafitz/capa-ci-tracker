import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateRangeFilter } from './DateRangeFilter'

describe('DateRangeFilter', () => {
  it('renders all four range buttons', () => {
    render(<DateRangeFilter value="7d" onChange={vi.fn()} />)
    expect(screen.getByText('24h')).toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('30d')).toBeInTheDocument()
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('calls onChange with the clicked range value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateRangeFilter value="7d" onChange={onChange} />)

    await user.click(screen.getByText('24h'))
    expect(onChange).toHaveBeenCalledWith('24h')

    await user.click(screen.getByText('30d'))
    expect(onChange).toHaveBeenCalledWith('30d')

    await user.click(screen.getByText('All'))
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('calls onChange when clicking the already-selected range', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateRangeFilter value="7d" onChange={onChange} />)

    await user.click(screen.getByText('7d'))
    expect(onChange).toHaveBeenCalledWith('7d')
  })
})
