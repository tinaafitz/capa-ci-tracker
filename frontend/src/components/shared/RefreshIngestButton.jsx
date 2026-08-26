import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { FilterSelect } from '@/components/shared/FilterSelect'

const API_URL = import.meta.env.VITE_API_URL || '/api'

// Slightly longer than the server's default INGEST_RUN_TIMEOUT_MS (300s) so the
// client abort is a defense-in-depth backstop, not the primary timeout.
const CLIENT_TIMEOUT_MS = 310_000

const SOURCE_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'jenkins', label: 'Jenkins' },
  { value: 'prow', label: 'Prow' },
]

/**
 * Triggers an on-demand CI ingest via POST /api/refresh-ingest.
 * Calls onRefreshed() on success so the parent can re-fetch its data.
 *
 * A small source selector next to the button lets the user pick which source
 * to ingest: Jenkins only, Prow only, or Both (default). The chosen source is
 * sent in the POST body as { source }.
 *
 * States:
 *   idle       – "Refresh" button, outline variant
 *   loading    – disabled, spinning icon, "Refreshing…"
 *   success    – "Updated" with check, clears back to idle after 3 s
 *   alreadyRunning – "Already running…", clears after 3 s
 *   disabled   – "Ingest disabled", clears after 4 s
 *   error      – "Refresh failed", re-enables the button
 */
export function RefreshIngestButton({ onRefreshed }) {
  const [state, setState] = useState('idle') // idle | loading | success | alreadyRunning | disabled | error
  const [source, setSource] = useState('both') // both | jenkins | prow
  const timerRef = useRef(null)

  // Auto-reset transient states back to idle
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function scheduleReset(ms = 3000) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), ms)
  }

  async function handleClick() {
    if (state === 'loading') return

    setState('loading')

    try {
      const res = await fetch(`${API_URL}/refresh-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
        // Defense-in-depth: abort if the server somehow never responds.
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      })

      if (res.status === 409) {
        setState('alreadyRunning')
        scheduleReset(3000)
        return
      }

      const body = await res.json()

      if (!res.ok) {
        setState('error')
        return
      }

      if (body.ok === false) {
        // Ingest is disabled server-side
        setState('disabled')
        scheduleReset(4000)
        return
      }

      // ok: true — success
      setState('success')
      scheduleReset(3000)
      if (typeof onRefreshed === 'function') {
        onRefreshed()
      }
    } catch {
      setState('error')
    }
  }

  const isLoading = state === 'loading'
  const isTransient = ['success', 'alreadyRunning', 'disabled'].includes(state)

  return (
    <div className="flex items-center gap-2">
      <FilterSelect
        value={source}
        onValueChange={setSource}
        options={SOURCE_OPTIONS}
        triggerClassName="h-8 text-xs"
        aria-label="Select ingest source"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={state === 'error' || state === 'idle' ? handleClick : undefined}
        disabled={isLoading || isTransient}
        className="h-8 gap-1.5 text-xs"
        aria-label="Trigger on-demand CI ingest"
      >
        {/* Icon */}
        {isLoading ? (
          <svg
            className="size-3.5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : state === 'success' ? (
          <svg
            className="size-3.5 text-green-600"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : state === 'error' ? (
          <svg
            className="size-3.5 text-destructive"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            className="size-3.5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
              clipRule="evenodd"
            />
          </svg>
        )}

        {/* Label */}
        {isLoading && 'Refreshing…'}
        {state === 'idle' && 'Refresh'}
        {state === 'success' && 'Updated'}
        {state === 'alreadyRunning' && 'Already running…'}
        {state === 'disabled' && 'Ingest disabled'}
        {state === 'error' && 'Refresh failed'}
      </Button>
    </div>
  )
}
