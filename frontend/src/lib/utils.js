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
