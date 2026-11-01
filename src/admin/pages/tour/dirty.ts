/**
 * Whether the tour editor holds edits the server has not seen. The Stops view edits `stops`; the
 * Advanced view edits a text copy of them that only reaches `stops` on "Apply text" (or Save), so
 * that text counts too while it is open: text that reads as different stops is an edit, and so is
 * text that cannot be read at all (the curator is part-way through typing). Whitespace-only changes
 * to readable text are not.
 */
export function tourIsDirty({
  stops,
  saved,
  view,
  jsonText,
}: {
  /** null while the tour is loading */
  stops: readonly unknown[] | null
  /** JSON.stringify of the stops as last loaded or saved */
  saved: string
  view: 'stops' | 'json'
  jsonText: string
}): boolean {
  if (!stops) return false
  const current = JSON.stringify(stops)
  if (current !== saved) return true
  if (view !== 'json') return false
  try {
    return JSON.stringify(JSON.parse(jsonText || '[]')) !== current
  } catch {
    return true
  }
}
