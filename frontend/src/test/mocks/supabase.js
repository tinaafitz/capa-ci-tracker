/**
 * Mock Supabase client for tests.
 *
 * Provides chainable query builder stubs and auth/realtime mocks
 * so component and hook tests can run without a Supabase instance.
 */
import { vi } from 'vitest'

// --- Query builder mock ---
// Each method returns `this` for chaining, except terminal methods
// which resolve to { data, error, count }.
export function createMockQueryBuilder(overrides = {}) {
  const defaults = { data: [], error: null, count: 0 }
  const result = { ...defaults, ...overrides }

  const builder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    // `then` makes the builder itself thenable, so `await supabase.from(...)...` works.
    then: vi.fn((resolve) => resolve(result)),
  }

  return builder
}

// --- Channel mock ---
export function createMockChannel() {
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    unsubscribe: vi.fn(),
  }
  return channel
}

// --- Auth mock ---
const mockSubscription = { unsubscribe: vi.fn() }

export const mockAuth = {
  getSession: vi.fn().mockResolvedValue({
    data: { session: null },
    error: null,
  }),
  getUser: vi.fn().mockResolvedValue({
    data: { user: null },
    error: null,
  }),
  onAuthStateChange: vi.fn().mockReturnValue({
    data: { subscription: mockSubscription },
  }),
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}

// --- Main mock client ---
const defaultBuilder = createMockQueryBuilder()

export const supabase = {
  from: vi.fn(() => defaultBuilder),
  channel: vi.fn(() => createMockChannel()),
  removeChannel: vi.fn(),
  auth: mockAuth,
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
}

/**
 * Reset all mocks between tests.
 */
export function resetSupabaseMocks() {
  vi.clearAllMocks()
  supabase.from.mockReturnValue(defaultBuilder)
}
