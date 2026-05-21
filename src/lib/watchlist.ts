const STORAGE_KEY = 'pump-dashboard-watch-mints'
const MAX_MINTS = 80

export function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_MINTS)
  } catch {
    return []
  }
}

export function writeWatchlist(mints: string[]): void {
  const uniq = [...new Set(mints.map((m) => m.trim()).filter(Boolean))].slice(0, MAX_MINTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(uniq))
}

/** Toggle mint in watchlist; persists and returns the new list and whether it is now watched. */
export function toggleWatchMint(mint: string): { mints: string[]; watched: boolean } {
  const cur = readWatchlist()
  const idx = cur.indexOf(mint)
  let next: string[]
  let watched: boolean
  if (idx >= 0) {
    next = cur.filter((_, i) => i !== idx)
    watched = false
  } else {
    next = [...cur, mint].slice(0, MAX_MINTS)
    watched = true
  }
  writeWatchlist(next)
  return { mints: next, watched }
}

export function isMintWatched(mint: string, mints: string[]): boolean {
  return mints.includes(mint)
}
