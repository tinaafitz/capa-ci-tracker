/**
 * Tests for the Builds table's Reason column.
 *
 * The infra badge sits in a fixed-width column immediately left of the Tests
 * counts. `cleanup_verification_failure` is wider than that column and, being
 * one of the few classes with no `infra_` prefix to strip, used to reach the
 * badge unabbreviated and render straight over the Tests digits.
 */

import { describe, it, expect } from 'vitest'
import { renderWithRouter, screen } from '@/test/test-utils'
import { BuildHistoryTable } from './BuildHistoryTable'

function buildRow(overrides = {}) {
  return {
    id: 'build-1',
    external_id: '345',
    job_name: 'capi_tests',
    job_url: 'https://ci.example.invalid/capi_tests/345/',
    source: 'jenkins',
    status: 'success',
    is_infra: 0,
    failure_class: null,
    failure_reason: null,
    pass_count: 6,
    fail_count: 2,
    skip_count: 0,
    started_at: '2026-09-04T10:00:00.000Z',
    duration_ms: 3_300_000,
    parameters: '{}',
    ocp_version: null,
    ...overrides,
  }
}

function renderTable(build) {
  return renderWithRouter(
    <BuildHistoryTable
      builds={[build]}
      loading={false}
      totalCount={1}
      page={1}
      totalPages={1}
      filters={{}}
      onFiltersChange={() => {}}
      onPageChange={() => {}}
      onBuildClick={() => {}}
    />
  )
}

describe('Builds table Reason column', () => {
  it('abbreviates cleanup_verification_failure so it fits its column', () => {
    renderTable(
      buildRow({ failure_class: 'cleanup_verification_failure' })
    )
    expect(screen.getByText('infra:cleanup')).toBeInTheDocument()
    expect(
      screen.queryByText('infra:cleanup_verification_failure')
    ).not.toBeInTheDocument()
  })

  it('keeps the unabbreviated class and reason on hover', () => {
    renderTable(
      buildRow({
        failure_class: 'cleanup_verification_failure',
        failure_reason: 'ENIs still attached to the VPC',
      })
    )
    expect(screen.getByText('infra:cleanup')).toHaveAttribute(
      'title',
      'cleanup_verification_failure — ENIs still attached to the VPC'
    )
  })

  it('clips rather than overflowing when a class has no short label', () => {
    // Guards the next long class someone adds to the taxonomy: the base badge
    // is `w-fit shrink-0`, so without these it grows past the cell.
    renderTable(
      buildRow({ is_infra: 1, failure_class: 'infra_some_very_long_new_class' })
    )
    const badge = screen.getByText('infra:some_very_long_new_class')
    expect(badge).toHaveClass('max-w-full')
    expect(badge).toHaveClass('truncate')
  })

  it('still strips the infra_ prefix for ordinary infra classes', () => {
    renderTable(buildRow({ is_infra: 1, failure_class: 'infra_teardown' }))
    expect(screen.getByText('infra:teardown')).toBeInTheDocument()
  })

  it('does not resolve a failure_class up the prototype chain', () => {
    // failure_class is writable through the PATCH API. A bare object lookup
    // would return Object.prototype.constructor here and hand React a
    // function to render as the label.
    renderTable(buildRow({ is_infra: 1, failure_class: 'constructor' }))
    expect(screen.getByText('infra:constructor')).toBeInTheDocument()
  })

  it('shows no badge for a clean product build', () => {
    renderTable(buildRow())
    expect(screen.queryByText(/^infra:/)).not.toBeInTheDocument()
  })
})

describe('Builds table parameter chips', () => {
  // The chip line truncates on narrow screens, so order is load-bearing:
  // host and prefix are what identify which run this was.
  it('puts host first and prefix second', () => {
    renderTable(
      buildRow({
        parameters: JSON.stringify({
          FEATURE_GROUP: 'day1-networking',
          NAME_PREFIX: 'tst',
          OCP_HUB_API_URL: 'https://api.test-hub-one.example.invalid:6443',
          EXTRA_FEATURE_VARS:
            'openshift_version=5.0.0-rc.0 channel_group=candidate',
        }),
      })
    )
    expect(screen.getByText(/^host:test-hub-one/)).toHaveTextContent(
      'host:test-hub-one • prefix:tst • group:day1-networking • channel:candidate • ocp:5.0.0-rc.0'
    )
  })

  it('keeps host first when the optional chips are absent', () => {
    renderTable(
      buildRow({
        parameters: JSON.stringify({
          NAME_PREFIX: 'rc0',
          OCP_HUB_API_URL: 'https://api.test-hub-two.example.invalid:6443',
        }),
      })
    )
    expect(screen.getByText(/^host:test-hub-two/)).toHaveTextContent(
      'host:test-hub-two • prefix:rc0'
    )
  })
})
