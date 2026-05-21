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
  /** Backend stops pricing / hides from main list when true. */
  dead_token?: boolean
  dead_marked_at?: string | null
  /** Jupiter Tokens API v2 (filled when `jupiter_api_key` set + cron ran). */
  token_symbol?: string | null
  token_icon_url?: string | null
  token_decimals?: number | null
  jupiter_is_verified?: boolean | null
  jupiter_mcap_usd?: number | null
  jupiter_organic_score?: number | null
  stats_24h_price_change_pct?: number | null
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

