export type TokenDto = {
  mint: string
  name: string
  first_slot: number
  last_slot: number
  /** Added in API alongside `sort`; omit on older backends. */
  first_seen?: string | null
  last_seen?: string | null
  first_price_usd: number | null
  price_usd: number | null
  price_change_pct?: number | null
  price_updated_at: string | null
  /** Jupiter Tokens API v2 (filled when `jupiter_api_key` set + cron ran). */
  token_symbol?: string | null
  token_icon_url?: string | null
  token_decimals?: number | null
  jupiter_is_verified?: boolean | null
  jupiter_mcap_usd?: number | null
  /** Jupiter Tokens API `liquidity` (USD). */
  jupiter_liquidity_usd?: number | null
  jupiter_organic_score?: number | null
  stats_24h_price_change_pct?: number | null
  /** Pump.fun live stream badge (from coin API, refreshed by token-monitor). */
  is_pump_live?: boolean | null
  /** Graduated to Raydium / DEX badge. */
  is_dex?: boolean | null
  pump_status_updated_at?: string | null
  raydium_pool?: string | null
  /** `a` | `l` when mint is on a tier list. */
  tier?: 'a' | 'l' | null
  /** When row moved from pump_tokens → a_tokens / l_tokens. */
  promoted_at?: string | null
  price_change_pct_at_promote?: number | null
  mcap_usd_at_promote?: number | null
  first_seen_at_promote?: string | null
  /** A_mark buy USD (open cycle, else price at promote). */
  a_mark_buy_price_usd?: number | null
  /** Current price vs A_mark buy — same basis as S_mark. */
  change_vs_a_mark_pct?: number | null
}

/** GET /tokens?sort=... (see token-monitor `TokenListSort::parse`). */
export type TokenListSort =
  | 'first_seen'
  | 'last_seen'
  | 'change_desc'
  | 'change_asc'
  | 'mcap_desc'

export type PricePointDto = {
  ts: string
  price_usd: number
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export type HealthDto = {
  ok: boolean
  s_mark_enabled?: boolean
  s_mark_mode?: string
  manual_sell_enabled?: boolean
  l_tokens_enabled?: boolean
  wallet?: string
  wallet_pubkey?: string
  wallet_balance_sol?: number | null
  real_trade_enabled?: boolean
  real_trade_active?: boolean
  real_trade_buy_sol?: number
  real_trade_fee_reserve_sol?: number
}

export type SMarkModeDto = {
  mode: 'auto' | 'manual' | string
  s_mark_enabled: boolean
  manual_sell_enabled: boolean
}

export async function fetchSMarkMode(): Promise<SMarkModeDto> {
  const res = await fetch(`${API_BASE}/signals/s-mark-mode`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as SMarkModeDto
}

export async function putSMarkMode(mode: 'auto' | 'manual'): Promise<SMarkModeDto> {
  const res = await fetch(`${API_BASE}/signals/s-mark-mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const t = await res.text()
      if (t.trim()) msg = t.trim()
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await res.json()) as SMarkModeDto
}

export async function fetchHealth(): Promise<HealthDto> {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthDto
}

export type ManualMarkSellResultDto = {
  ok: boolean
  mint: string
  cycle_id: number
  sell_price_usd: number
  buy_price_usd: number
  pnl_pct: number
  reason: string
}

/** Paper S_mark at fresh Jupiter price (manual mode). */
export async function postManualMarkSell(mint: string): Promise<ManualMarkSellResultDto> {
  const res = await fetch(`${API_BASE}/signals/manual-sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mint }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const t = await res.text()
      if (t.trim()) msg = t.trim()
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await res.json()) as ManualMarkSellResultDto
}

export type TokenEventDto = {
  mint?: string
  op?: string
  at?: string
}

export type MarkCycleEventDto = {
  op?: string
  cycle_id?: number
  mint?: string
  status?: string
}

export type ATierPromoteEventDto = {
  op?: string
  mint?: string
  token_name?: string | null
  price_usd?: number | null
  mcap_usd?: number | null
  price_change_pct?: number | null
  is_dex?: boolean | null
  is_pump_live?: boolean | null
  promoted_at?: string | null
}

export function subscribeATokenPromoteEvents(
  onChange: (event: ATierPromoteEventDto) => void,
  onError?: () => void,
): () => void {
  const url = new URL(`${API_BASE}/a-tokens/events`, window.location.origin)
  const source = new EventSource(url.toString())

  source.addEventListener('a-token-promote', (event) => {
    try {
      onChange(JSON.parse(event.data) as ATierPromoteEventDto)
    } catch {
      onChange({})
    }
  })
  source.onerror = () => {
    onError?.()
  }

  return () => source.close()
}

export function subscribeMarkCycleEvents(
  onChange: (event: MarkCycleEventDto) => void,
  onError?: () => void,
): () => void {
  const url = new URL(`${API_BASE}/signals/mark-events`, window.location.origin)
  const source = new EventSource(url.toString())

  source.addEventListener('mark-change', (event) => {
    try {
      onChange(JSON.parse(event.data) as MarkCycleEventDto)
    } catch {
      onChange({})
    }
  })
  source.onerror = () => {
    onError?.()
  }

  return () => source.close()
}

export function subscribeTokenEvents(onChange: (event: TokenEventDto) => void, onError?: () => void): () => void {
  const url = new URL(`${API_BASE}/tokens/events`, window.location.origin)
  const source = new EventSource(url.toString())

  source.addEventListener('token-change', (event) => {
    try {
      onChange(JSON.parse(event.data) as TokenEventDto)
    } catch {
      onChange({})
    }
  })
  source.onerror = () => {
    onError?.()
  }

  return () => source.close()
}

export async function fetchTokens(params?: {
  limit?: number
  offset?: number
  sort?: TokenListSort
  /** Case-insensitive substring on name or mint (backend filter). */
  search?: string
}): Promise<TokenDto[]> {
  const url = new URL(`${API_BASE}/tokens`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset))
  if (params?.sort) url.searchParams.set('sort', params.sort)
  const q = params?.search?.trim()
  if (q) url.searchParams.set('search', q)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TokenDto[]
}

export async function postRegisterToken(body: { mint: string; name: string }): Promise<TokenDto> {
  const url = new URL(`${API_BASE}/tokens`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as TokenDto
}

/** GET /tokens-batch?mints=comma,separated (max 80). Order matches request. */
export async function fetchTokensBatch(mints: string[]): Promise<TokenDto[]> {
  const cleaned = [...new Set(mints.map((m) => m.trim()).filter(Boolean))].slice(0, 80)
  if (cleaned.length === 0) return []

  const url = new URL(`${API_BASE}/tokens-batch`, window.location.origin)
  url.searchParams.set('mints', cleaned.join(','))

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TokenDto[]
}

/** GET /tokens/:mint — works for pump_tokens, a_tokens, or l_tokens home. */
export async function fetchToken(mint: string): Promise<TokenDto> {
  const res = await fetch(`${API_BASE}/tokens/${encodeURIComponent(mint.trim())}`)
  if (!res.ok) throw new Error(res.status === 404 ? 'Token not found' : `HTTP ${res.status}`)
  return (await res.json()) as TokenDto
}

export async function fetchTokenPrices(
  mint: string,
  params?: { limit?: number; fromIso?: string | null },
): Promise<PricePointDto[]> {
  const url = new URL(`${API_BASE}/tokens/${mint}/prices`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.fromIso) url.searchParams.set('from', params.fromIso)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as PricePointDto[]
}

export type CandleDto = {
  ts: string
  open_usd: number
  high_usd: number
  low_usd: number
  close_usd: number
  samples: number
}

/** GET /tokens/:mint/candles — 1-minute OHLC from `token_prices`. */
export async function fetchATokens(params?: {
  limit?: number
  offset?: number
  search?: string
}): Promise<TokenDto[]> {
  const url = new URL(`${API_BASE}/a-tokens`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset))
  const q = params?.search?.trim()
  if (q) url.searchParams.set('search', q)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TokenDto[]
}

export async function fetchLTokens(params?: {
  limit?: number
  offset?: number
  search?: string
}): Promise<TokenDto[]> {
  const url = new URL(`${API_BASE}/l-tokens`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset))
  const q = params?.search?.trim()
  if (q) url.searchParams.set('search', q)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TokenDto[]
}

export type CandlesPayload = {
  candles: CandleDto[]
  promoted_at?: string | null
  promoted_price_usd?: number | null
  tier?: 'a' | 'l' | null
  s_mark_at?: string | null
  s_mark_price_usd?: number | null
  s_mark_reason?: string | null
  mark_cycle_id?: number | null
  mark_cycle_status?: string | null
  consecutive_down_count?: number | null
  s_mark_consecutive_downs?: number | null
}

export async function fetchTokenCandles(
  mint: string,
  params?: {
    limit?: number
    fromIso?: string | null
    bucketSecs?: 1 | 5 | 10 | 60
    markCycleId?: number
  },
): Promise<CandlesPayload> {
  const url = new URL(`${API_BASE}/tokens/${mint}/candles`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.fromIso) url.searchParams.set('from', params.fromIso)
  if (params?.bucketSecs != null) url.searchParams.set('bucket_secs', String(params.bucketSecs))
  if (params?.markCycleId != null) url.searchParams.set('mark_cycle_id', String(params.markCycleId))

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw: unknown = await res.json()
  if (Array.isArray(raw)) {
    const candles = (raw as CandleDto[]).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    return { candles }
  }
  const body = raw as CandlesPayload
  const candles = (body.candles ?? []).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  return {
    candles,
    promoted_at: body.promoted_at ?? null,
    promoted_price_usd: body.promoted_price_usd ?? null,
    tier: body.tier ?? null,
    s_mark_at: body.s_mark_at ?? null,
    s_mark_price_usd: body.s_mark_price_usd ?? null,
    s_mark_reason: body.s_mark_reason ?? null,
    mark_cycle_id: body.mark_cycle_id ?? null,
    mark_cycle_status: body.mark_cycle_status ?? null,
    consecutive_down_count: body.consecutive_down_count ?? null,
    s_mark_consecutive_downs: body.s_mark_consecutive_downs ?? null,
  }
}

/** Extend chart `from` so A/S mark markers are never clipped by the selected range. */
export function chartFromIsoIncludingMarkEvents(
  rangeFromIso: string | null | undefined,
  ...eventIsos: (string | null | undefined)[]
): string | undefined {
  let fromMs = rangeFromIso ? Date.parse(rangeFromIso) : Number.NaN
  const bufferMs = 15_000
  for (const iso of eventIsos) {
    const ms = iso ? Date.parse(iso) : Number.NaN
    if (!Number.isFinite(ms)) continue
    const need = ms - bufferMs
    if (!Number.isFinite(fromMs) || need < fromMs) fromMs = need
  }
  if (!Number.isFinite(fromMs)) return undefined
  return new Date(fromMs).toISOString()
}

/** @deprecated use chartFromIsoIncludingMarkEvents */
export function chartFromIsoIncludingPromotion(
  rangeFromIso: string | null | undefined,
  promotedAt: string | null | undefined,
): string | undefined {
  return chartFromIsoIncludingMarkEvents(rangeFromIso, promotedAt)
}

export type TradePositionDto = {
  id: number
  mint: string
  token_name: string
  buy_price_usd: number
  buy_at: string
  token_amount_remaining: number
  current_price_usd: number | null
  unrealized_profit_usd: number | null
}

export type SellHistoryRowDto = {
  id: number
  position_id: number | null
  mint: string
  token_name: string
  sell_tx_signature: string | null
  sold_at: string
  /** Snapshot from position at sell time; 0 on legacy rows before migration. */
  buy_price_usd: number
  sell_price_usd: number
  token_decimals: number
  tokens_sold_raw: string
  /** tokens_sold_raw / 10^decimals */
  amount_sold_human: number
  sol_received_lamports: number | null
  /** `(sell_price - buy_price) * amount` when buy snapshot exists; else legacy stored value. */
  profit_usd: number
  closed_position: boolean
}

export type SellHistoryBundleDto = {
  items: SellHistoryRowDto[]
  profit_by_mint: { mint: string; token_name: string; profit_usd: number }[]
  profit_by_day: { day: string; profit_usd: number }[]
  total_profit_usd: number
  trades_winning: number
  trades_losing: number
}

export async function fetchTradePositions(): Promise<TradePositionDto[]> {
  const url = new URL(`${API_BASE}/trades/positions`, window.location.origin)
  const res = await fetch(url.toString())
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as TradePositionDto[]
}

export async function postTradeBuy(body: { mint: string; sol_amount: number }): Promise<TradePositionDto> {
  const url = new URL(`${API_BASE}/trades/buy`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as TradePositionDto
}

export async function postTradeSell(body: { position_id: number; token_amount: string }): Promise<void> {
  const url = new URL(`${API_BASE}/trades/sell`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

export type EstimateBuyDto = {
  sol_amount: number
  sol_price_usd: number | null
  token_price_usd: number | null
  estimated_tokens: number | null
  estimated_usd_spent: number | null
}

export async function fetchEstimateBuy(params: { mint: string; sol_amount: number }): Promise<EstimateBuyDto> {
  const url = new URL(`${API_BASE}/trades/estimate-buy`, window.location.origin)
  url.searchParams.set('mint', params.mint)
  url.searchParams.set('sol_amount', String(params.sol_amount))
  const res = await fetch(url.toString())
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as EstimateBuyDto
}

export type EstimateSellDto = {
  token_amount: number
  token_price_usd: number | null
  estimated_usd: number | null
  sol_price_usd: number | null
  estimated_sol: number | null
}

export async function fetchEstimateSell(params: {
  mint: string
  token_amount: number
}): Promise<EstimateSellDto> {
  const url = new URL(`${API_BASE}/trades/estimate-sell`, window.location.origin)
  url.searchParams.set('mint', params.mint)
  url.searchParams.set('token_amount', String(params.token_amount))
  const res = await fetch(url.toString())
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as EstimateSellDto
}

export async function fetchSellHistoryBundle(params: { from: string; to: string }): Promise<SellHistoryBundleDto> {
  const url = new URL(`${API_BASE}/trades/sell-history`, window.location.origin)
  url.searchParams.set('from', params.from)
  url.searchParams.set('to', params.to)
  const res = await fetch(url.toString())
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as SellHistoryBundleDto
}

/** A_mark / S_mark validation history (no execution). */
export type MarkCycleDto = {
  id: number
  mint: string
  cycle_no: number
  token_name: string | null
  a_mark_at: string
  a_mark_reason: string
  buy_price_usd: number
  a_mark_mcap_usd: number | null
  status: string
  s_mark_at: string | null
  s_mark_reason: string | null
  sell_price_usd: number | null
  s_mark_mcap_usd: number | null
  consecutive_down_count: number
  last_snapshot_price_usd: number | null
  last_snapshot_at: string | null
  closed_at: string | null
  close_reason: string | null
  profit_multiple: number | null
  /** Sell − buy (USD) at S_mark (token price delta only). */
  pnl_usd: number | null
  /** Percent P/L vs buy @ A_mark. */
  pnl_pct: number | null
  /** Paper sim: SOL in at A_mark. */
  buy_sol: number | null
  /** Paper sim: SOL out at S_mark. */
  sell_sol: number | null
  /** Paper sim: sell_sol − buy_sol. */
  pnl_sol: number | null
  pnl_sol_pct: number | null
  /** Real trade ledger: SOL in on buy. */
  real_buy_sol?: number | null
  /** Real trade ledger: SOL out on sell. */
  real_sell_sol?: number | null
  /** Real trade ledger: real_sell_sol − real_buy_sol. */
  real_pnl_sol?: number | null
  real_pnl_sol_pct?: number | null
  real_buy_at?: string | null
  real_sell_at?: string | null
}

export type MarkSnapshotDto = {
  id: number
  fetched_at: string
  price_usd: number
  consecutive_down_count: number
  fetch_seq: number
}

export type LifecycleLogDto = {
  id: number
  event_at: string
  event_type: string
  detail: Record<string, unknown>
}

export type MarkCycleDetailDto = {
  cycle: MarkCycleDto
  snapshots: MarkSnapshotDto[]
  lifecycle: LifecycleLogDto[]
}

export type MarkPnlSummaryDto = {
  total_pnl_usd: number
  total_pnl_sol: number
  wins: number
  losses: number
  breakeven: number
  with_pnl: number
  with_pnl_sol: number
  total_s_marked: number
}

export type MarkSummaryDto = {
  counts: {
    total_cycles: number
    s_marked: number
    open: number
    demoted_without_s_mark: number
  }
  /** All completed S_mark cycles in range (not limited to table page size). */
  pnl?: MarkPnlSummaryDto | null
}

export async function fetchMarkCycles(params?: {
  limit?: number
  offset?: number
  mint?: string
  from?: string
  to?: string
  /** Default true: only open cycles for mints still on a_tokens. */
  activeOnA?: boolean
  /** `s_marked` | `demoted` — list completed S_mark rows or demoted-without-S_mark. */
  history?: 's_marked' | 'demoted'
}): Promise<MarkCycleDto[]> {
  const url = new URL(`${API_BASE}/signals/mark-cycles`, window.location.origin)
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit))
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset))
  if (params?.mint) url.searchParams.set('mint', params.mint)
  if (params?.from) url.searchParams.set('from', params.from)
  if (params?.to) url.searchParams.set('to', params.to)
  if (params?.history) {
    url.searchParams.set('history', params.history)
  } else {
    const activeOnA = params?.activeOnA ?? true
    url.searchParams.set('active_on_a', activeOnA ? 'true' : 'false')
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as MarkCycleDto[]
}

/** Load every cycle in range (paginated server-side). */
export async function fetchAllMarkCycles(
  params: Omit<NonNullable<Parameters<typeof fetchMarkCycles>[0]>, 'limit' | 'offset'>,
): Promise<MarkCycleDto[]> {
  const pageSize = 500
  const out: MarkCycleDto[] = []
  let offset = 0
  for (;;) {
    const batch = await fetchMarkCycles({ ...params, limit: pageSize, offset })
    out.push(...batch)
    if (batch.length < pageSize) break
    offset += pageSize
  }
  return out
}

export async function fetchMarkCycleDetail(id: number): Promise<MarkCycleDetailDto> {
  const url = new URL(`${API_BASE}/signals/mark-cycles/${id}`, window.location.origin)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as MarkCycleDetailDto
}

export type MarkPaperFeedDto = {
  id: number
  event_at: string
  event_type: string
  mint: string
  cycle_id: number | null
  token_name: string | null
  detail: Record<string, unknown>
  buy_sol: number | null
  sell_sol: number | null
  pnl_sol: number | null
}

export async function fetchMarkPaperFeed(limit = 40): Promise<MarkPaperFeedDto[]> {
  const url = new URL(`${API_BASE}/signals/mark-feed`, window.location.origin)
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as MarkPaperFeedDto[]
}

export async function fetchMarkSummary(params?: {
  from?: string
  to?: string
  activeOnA?: boolean
  history?: 's_marked' | 'demoted'
}): Promise<MarkSummaryDto> {
  const url = new URL(`${API_BASE}/signals/mark-summary`, window.location.origin)
  if (params?.from) url.searchParams.set('from', params.from)
  if (params?.to) url.searchParams.set('to', params.to)
  if (params?.history) {
    url.searchParams.set('history', params.history)
  } else {
    const activeOnA = params?.activeOnA ?? true
    url.searchParams.set('active_on_a', activeOnA ? 'true' : 'false')
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as MarkSummaryDto
}
