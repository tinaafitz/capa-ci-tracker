import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/config/supabase'

/**
 * Hook for managing Supabase Google OAuth authentication.
 *
 * - Checks for an existing session on mount
 * - Subscribes to auth state changes (login/logout/token refresh)
 * - Provides signIn (Google OAuth), signOut, user, session, loading
 * - Cleans up the auth listener on unmount
 */
const DEV_BYPASS_AUTH = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

const DEV_USER = {
  id: 'dev-user-000',
  email: 'dev@redhat.com',
  user_metadata: { full_name: 'Dev User', avatar_url: null },
}

export function useAuth() {
  const [session, setSession] = useState(DEV_BYPASS_AUTH ? {} : null)
  const [user, setUser] = useState(DEV_BYPASS_AUTH ? DEV_USER : null)
  const [loading, setLoading] = useState(!DEV_BYPASS_AUTH)
  const mountedRef = useRef(true)

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return
    mountedRef.current = true

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!mountedRef.current) return
      setSession(currentSession)
      setUser(currentSession?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mountedRef.current) return
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Supabase handles the redirect URL via dashboard config.
        // queryParams restricts the Google consent screen to Red Hat domain.
        queryParams: {
          hd: 'redhat.com',
        },
      },
    })
    if (error) {
      console.error('Sign-in error:', error.message)
    }
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Sign-out error:', error.message)
    }
    return { error }
  }, [])

  return { user, session, loading, signIn, signOut }
}
