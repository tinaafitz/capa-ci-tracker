import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from './useAuth'

// The new useAuth hook is purely static -- on OCP, oauth-proxy handles auth
// before traffic reaches the app. The hook returns a static authenticated state.
// With VITE_DEV_BYPASS_AUTH=true (set in .env), it returns a dev user instead.

describe('useAuth (PostgREST / OCP deployment)', () => {
  it('returns a user immediately with no loading', () => {
    const { result } = renderHook(() => useAuth())

    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeTruthy()
    expect(result.current.user.email).toBeTruthy()
  })

  it('returns a non-null session', () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.session).toEqual({})
  })

  it('returns signIn and signOut functions', () => {
    const { result } = renderHook(() => useAuth())
    expect(typeof result.current.signIn).toBe('function')
    expect(typeof result.current.signOut).toBe('function')
  })

  it('signIn is a no-op', () => {
    const { result } = renderHook(() => useAuth())
    // Should not throw
    result.current.signIn()
  })

  it('returns all expected properties', () => {
    const { result } = renderHook(() => useAuth())

    expect(result.current).toHaveProperty('user')
    expect(result.current).toHaveProperty('session')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('signIn')
    expect(result.current).toHaveProperty('signOut')
  })

  it('user has expected shape with user_metadata', () => {
    const { result } = renderHook(() => useAuth())

    expect(result.current.user.id).toBeTruthy()
    expect(result.current.user.email).toBeTruthy()
    expect(result.current.user.user_metadata).toBeTruthy()
    expect(result.current.user.user_metadata).toHaveProperty('full_name')
    expect(result.current.user.user_metadata).toHaveProperty('avatar_url')
  })
})
