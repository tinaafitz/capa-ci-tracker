/**
 * Test utilities: custom render that wraps components with
 * the providers they need (Router, AppProvider).
 */
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Re-export everything from testing-library
export * from '@testing-library/react'

/**
 * A lightweight wrapper that provides BrowserRouter context.
 * Does NOT include AppProvider so we can test components both
 * with and without the full app context.
 */
export function renderWithRouter(ui, { route = '/', ...options } = {}) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
    ...options,
  })
}
