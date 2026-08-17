import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Strip the email domain from an assignee string.
 * "tfitzgerald@redhat.com" → "tfitzgerald"
 * Already-short names pass through unchanged.
 */
export function formatAssignee(email) {
  if (!email) return null
  const atIndex = email.indexOf('@')
  return atIndex > 0 ? email.slice(0, atIndex) : email
}

export function formatRelative(dateStr) {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  if (isNaN(date)) return '--'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'just now'
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMo = Math.floor(diffDay / 30)
  if (diffMo < 12) return `${diffMo}mo ago`
  return `${Math.floor(diffMo / 12)}y ago`
}

export function formatAbsolute(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date)) return ''
  return date.toLocaleString()
}

export function truncateJobName(jobName) {
  if (!jobName) return ''
  const parts = jobName.split('_')
  if (parts.length > 1) return parts[parts.length - 1]
  return jobName.length > 40 ? jobName.slice(-40) : jobName
}

export function truncateBuildId(buildId) {
  if (!buildId) return ''
  const id = String(buildId)
  return id.length > 8 ? id.slice(-8) : id
}
