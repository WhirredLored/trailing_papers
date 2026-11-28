/**
 * Deterministic date formatting, with no dependency on pdf-lib or anything else
 * heavy — this is imported by both the PDF renderer and a public, SSR-rendered
 * page, and the latter must not pull a PDF-generation library into its bundle
 * just to print a date (see DECISIONS.md).
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * Format an ISO timestamp as "September 17, 2026", in UTC.
 *
 * UTC rather than a local zone is a deliberate trade: a document rendered in two
 * places must read the same, and `toLocaleDateString` would make the printed date
 * a property of the server's zone and ICU build. The cost is that an estimate
 * issued late evening US-time carries the following UTC date; the frozen
 * `issued_at` remains the authoritative instant either way.
 */
export function formatDateStable(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Not a date: ${iso}`)
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}
