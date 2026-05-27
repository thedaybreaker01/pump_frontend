export type ChartRangeKey = '15m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'all'

export const CHART_RANGE_OPTIONS: { key: ChartRangeKey; label: string }[] = [
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '1 week' },
  { key: '30d', label: '1 month' },
  { key: 'all', label: 'All' },
]

/** A-tier list + chart: 1s poll / 1s OHLC (matches `a_token_price_interval_secs`). */
export const TIER_A_POLL_MS = 1000

/** Paper mark history: poll + SSE fallback (matches A-tier price cadence). */
export const MARK_POLL_MS = 1000
export const TIER_A_CHART_BUCKET_SECS = 1 as const

/** L-tier: 2s poll / 5s OHLC. */
export const TIER_L_POLL_MS = 2000
export const TIER_L_CHART_BUCKET_SECS = 5 as const

/** A/L tier modals: short windows (1s bars → prefer 5–15m). */
export const TIER_CHART_RANGE_OPTIONS: { key: ChartRangeKey; label: string }[] = [
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
]

export function defaultTierChartRange(tier: 'a' | 'l'): ChartRangeKey {
  return tier === 'a' ? '15m' : '1h'
}

/** Visible history window on live 1s charts (seconds). */
export const TIER_A_LIVE_CHART_WINDOW_SECS = 15 * 60

export function rangeWindowMs(key: ChartRangeKey): {
  fromIso: string | null
  startMs: number | null
  endMs: number
} {
  const endMs = Date.now()
  if (key === 'all') {
    return { fromIso: null, startMs: null, endMs }
  }
  const ms: Record<Exclude<ChartRangeKey, 'all'>, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  const span = ms[key]
  return { fromIso: new Date(endMs - span).toISOString(), startMs: endMs - span, endMs }
}
