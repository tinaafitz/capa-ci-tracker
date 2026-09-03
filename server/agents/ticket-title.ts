/**
 * ticket-title -- shared, idempotent ticket-title composition.
 *
 * Jenkins `capi_tests` (RHACM4K Ginkgo) test reports put the same
 * "KEY: summary" text in BOTH `className` (the describe-block spec) and
 * `name` (the test case). Naively composing `${className}: ${name}` therefore
 * doubled the title, e.g.:
 *
 *   "RHACM4K-61815: Provisions ...: RHACM4K-61815: Provisions ..."
 *
 * (Prow reports use distinct className/name — package path vs test func — so
 * they never doubled; see agents/ingest-prow.ts.)
 *
 * This module centralizes title composition so it is idempotent: composing a
 * title, or re-composing an already-composed title, always yields the same
 * single, truncated result.
 */

// Hard cap for ticket titles. Titles are truncated on a word boundary with an
// ellipsis so list views stay readable.
export const MAX_TITLE_LENGTH = 120;

const ELLIPSIS = '…'; // …

// A Jira-style issue key, e.g. RHACM4K-61815, CAPA-1234, ROSAENG-60868.
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+/;

// A Jira key appearing anywhere (used to detect a redundant leading prefix in
// already-stored titles that the data-repair must undo).
const JIRA_KEY_ANYWHERE = /[A-Z][A-Z0-9]+-\d+/;

/**
 * Truncate on a word boundary, appending an ellipsis. Never returns a string
 * longer than `max` (ellipsis included). Idempotent for already-short input.
 */
export function truncateTitle(text: string, max = MAX_TITLE_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;

  // Reserve one char for the ellipsis.
  const slice = trimmed.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  // Prefer a word boundary, but fall back to a hard cut for a single long word.
  const cut = lastSpace > Math.floor(max * 0.5) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}${ELLIPSIS}`;
}

/** Case-insensitive, whitespace-collapsed equality for title comparison. */
function sameText(a: string, b: string): boolean {
  return (
    a.trim().replace(/\s+/g, ' ').toLowerCase() ===
    b.trim().replace(/\s+/g, ' ').toLowerCase()
  );
}

/**
 * Collapse a doubled title down to a single occurrence. Handles two shapes:
 *
 *  1. Whole-string repetition: "X: Y: X: Y" -> "X: Y" (the Jenkins doubling,
 *     where the repeated unit is a multi-segment "KEY: summary" group).
 *  2. Adjacent-segment repetition: "X: X: Y" -> "X: Y".
 *
 * Case-insensitive and whitespace-normalized. Only collapses on equality, so
 * genuinely distinct "className: name" titles (Prow) are left untouched, and
 * the operation is idempotent — re-running never changes an already-collapsed
 * title.
 */
export function dedupeTitleSegments(title: string): string {
  const parts = title.split(': ').map((p) => p.trim());
  if (parts.length < 2) return title.trim();

  // Shape 1: an even split where the first half equals the second half,
  // possibly repeated more than twice (fold the whole thing to one copy).
  // Guard: only fold when the repeated unit itself carries a Jira key — that is
  // the doubling we target (Jenkins RHACM4K titles). This avoids eating a
  // legitimately periodic title like "a: b: a: b" that has no key.
  for (let unit = 1; unit <= Math.floor(parts.length / 2); unit++) {
    if (parts.length % unit !== 0) continue;
    const head = parts.slice(0, unit);
    if (!head.some((p) => JIRA_KEY_ANYWHERE.test(p))) continue;
    let allEqual = true;
    for (let start = unit; start < parts.length; start += unit) {
      for (let i = 0; i < unit; i++) {
        if (!sameText(parts[start + i], head[i])) {
          allEqual = false;
          break;
        }
      }
      if (!allEqual) break;
    }
    if (allEqual) return head.join(': ').trim();
  }

  // Shape 2: drop adjacent duplicate segments.
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && sameText(prev, part)) continue;
    out.push(part);
  }
  return out.join(': ').trim();
}

/**
 * Strip a redundant leading prefix that sits in front of a Jira key, e.g.
 * turn "CAPA Cluster Provisioning RHACM4K-61815: summary" into
 * "RHACM4K-61815: summary". This mirrors what composeTicketTitle() does at
 * ingest time when the className carries the same key as the name, and lets
 * the data-repair reconstruct the ideal "KEY: summary" form from an
 * already-doubled stored title.
 *
 * Only strips when the key is preceded by plain prefix text with no ": " of
 * its own (so genuine "className: name" titles are left untouched).
 */
export function stripRedundantKeyPrefix(title: string): string {
  const t = title.trim();
  const m = t.match(JIRA_KEY_ANYWHERE);
  if (!m || m.index === undefined || m.index === 0) return t;

  const prefix = t.slice(0, m.index);
  // Keep the prefix if it looks like its own labelled segment ("[Infra] x: y").
  if (prefix.includes(': ')) return t;

  return t.slice(m.index).trim();
}

/**
 * Compose a ticket title from a test failure's className + name.
 *
 * Rules:
 *  - If `name` already starts with the Jira key contained in `className`
 *    (i.e. the two carry the same "KEY: summary" payload), use just `name`
 *    rather than prepending the redundant className.
 *  - Otherwise join as "className: name".
 *  - Collapse any immediately-repeated segment (idempotency guard).
 *  - Hard-truncate on a word boundary.
 */
export function composeTicketTitle(
  className: string | null | undefined,
  name: string | null | undefined,
  fallback: string,
): string {
  const cn = (className ?? '').trim();
  const nm = (name ?? '').trim();

  let composed: string;
  if (!cn && !nm) {
    composed = fallback;
  } else if (!nm) {
    composed = cn;
  } else if (!cn) {
    composed = nm;
  } else {
    // If both sides carry the same Jira key + summary (the Jenkins RHACM4K
    // case), the className is redundant — keep only the name.
    const nameKey = nm.match(JIRA_KEY)?.[0];
    if (nameKey && cn.includes(nameKey)) {
      composed = nm;
    } else {
      composed = `${cn}: ${nm}`;
    }
  }

  return truncateTitle(dedupeTitleSegments(composed));
}
