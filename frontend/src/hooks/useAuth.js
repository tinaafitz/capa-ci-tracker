/**
 * Authentication hook for OpenShift deployment.
 *
 * On OCP, the oauth-proxy sidecar handles authentication before traffic
 * reaches nginx. The app never sees unauthenticated requests.
 *
 * For local development without OCP, set VITE_DEV_BYPASS_AUTH=true in .env.
 * Both paths return a static authenticated state since PostgREST does not
 * require per-user auth tokens.
 */

const DEV_BYPASS_AUTH = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

const DEV_USER = {
  id: 'dev-user-000',
  email: 'dev@redhat.com',
  user_metadata: { full_name: 'Dev User', avatar_url: null },
}

const OCP_USER = {
  id: 'ocp-user',
  email: 'authenticated-via-ocp',
  user_metadata: { full_name: 'OCP User', avatar_url: null },
}

export function useAuth() {
  const user = DEV_BYPASS_AUTH ? DEV_USER : OCP_USER

  return {
    user,
    session: {},
    loading: false,
    signIn: () => {},
    signOut: () => {
      // On OCP, sign out via the oauth-proxy sign_out endpoint
      window.location.href = '/oauth/sign_out'
    },
  }
}
