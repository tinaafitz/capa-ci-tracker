import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeverityBadge, SEVERITY_ORDER } from './SeverityBadge'

describe('SeverityBadge', () => {
  it('renders "Nightly Blocker" for nightly_blocker severity', () => {
    render(<SeverityBadge severity="nightly_blocker" />)
    expect(screen.getByText('Nightly Blocker')).toBeInTheDocument()
  })

  it('renders "Test Regression" for test_regression severity', () => {
    render(<SeverityBadge severity="test_regression" />)
    expect(screen.getByText('Test Regression')).toBeInTheDocument()
  })

  it('renders "Flaky" for flaky severity', () => {
    render(<SeverityBadge severity="flaky" />)
    expect(screen.getByText('Flaky')).toBeInTheDocument()
  })

  it('renders "Infrastructure" for infrastructure severity', () => {
    render(<SeverityBadge severity="infrastructure" />)
    expect(screen.getByText('Infrastructure')).toBeInTheDocument()
  })

  it('renders "Upstream Breakage" for upstream_breakage severity', () => {
    render(<SeverityBadge severity="upstream_breakage" />)
    expect(screen.getByText('Upstream Breakage')).toBeInTheDocument()
  })

  it('falls back to "Test Regression" for unknown severity', () => {
    render(<SeverityBadge severity="completely_unknown" />)
    expect(screen.getByText('Test Regression')).toBeInTheDocument()
  })

  it('falls back to "Test Regression" for undefined severity', () => {
    render(<SeverityBadge severity={undefined} />)
    expect(screen.getByText('Test Regression')).toBeInTheDocument()
  })

  it('renders all known severities correctly', () => {
    const labels = ['Nightly Blocker', 'Test Regression', 'Flaky', 'Infrastructure', 'Upstream Breakage']
    SEVERITY_ORDER.forEach((severity, i) => {
      const { unmount } = render(<SeverityBadge severity={severity} />)
      expect(screen.getByText(labels[i])).toBeInTheDocument()
      unmount()
    })
  })
})

describe('SEVERITY_ORDER', () => {
  it('contains all five severities', () => {
    expect(SEVERITY_ORDER).toEqual([
      'nightly_blocker',
      'test_regression',
      'flaky',
      'infrastructure',
      'upstream_breakage',
    ])
  })

  it('has nightly_blocker first (highest priority)', () => {
    expect(SEVERITY_ORDER[0]).toBe('nightly_blocker')
  })
})
