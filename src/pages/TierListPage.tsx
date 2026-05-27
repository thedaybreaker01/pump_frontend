import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  chartFromIsoIncludingPromotion,
  fetchATokens,
  fetchLTokens,
  fetchTokenCandles,
  type CandleDto,
  type TokenDto,
} from '../lib/api'
import BuyTokenModal from '../components/BuyTokenModal'
import TokenDetailModal from '../components/TokenDetailModal'
import {
  defaultTierChartRange,
  rangeWindowMs,
  TIER_A_CHART_BUCKET_SECS,
  TIER_A_POLL_MS,
  TIER_CHART_RANGE_OPTIONS,
  TIER_L_CHART_BUCKET_SECS,
  TIER_L_POLL_MS,
  type ChartRangeKey,
} from '../lib/chartRange'

function fmtUsd(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
}

function fmtPct(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function pctChange(first: number | null, last: number | null): number | null {
  if (first == null || last == null) return null
  if (first === 0) return null
  return ((last - first) / first) * 100
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtMcap(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUsd(v)
}

type Props = {
  tier: 'a' | 'l'
  title: string
  description: string
  fastPriceHint: string
}

export default function TierListPage(props: Props) {
  const tierPollMs = props.tier === 'a' ? TIER_A_POLL_MS : TIER_L_POLL_MS
  const tierChartBucketSecs = props.tier === 'a' ? TIER_A_CHART_BUCKET_SECS : TIER_L_CHART_BUCKET_SECS

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokens, setTokens] = useState<TokenDto[]>([])
  const [searchDraft, setSearchDraft] = useState('')
  const [searchApplied, setSearchApplied] = useState('')
  const [selected, setSelected] = useState<TokenDto | null>(null)
  const [buyFor, setBuyFor] = useState<TokenDto | null>(null)
  const [priceRange, setPriceRange] = useState<ChartRangeKey>(() =>
    defaultTierChartRange(props.tier),
  )
  const [candles, setCandles] = useState<CandleDto[] | null>(null)
  const [candlesError, setCandlesError] = useState<string | null>(null)
  const [promotedAt, setPromotedAt] = useState<string | null>(null)
  const [promotedPriceUsd, setPromotedPriceUsd] = useState<number | null>(null)
  const [chartSMarkAt, setChartSMarkAt] = useState<string | null>(null)
  const [chartSMarkPrice, setChartSMarkPrice] = useState<number | null>(null)
  const [chartSMarkReason, setChartSMarkReason] = useState<string | null>(null)
  const [chartMarkWatch, setChartMarkWatch] = useState<{
    status: string
    downCount: number
    downNeeded: number
  } | null>(null)

  const load = useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true
    if (background) setRefreshing(true)
    try {
      const params = { limit: 500, offset: 0, search: searchApplied || undefined }
      const rows =
        props.tier === 'a' ? await fetchATokens(params) : await fetchLTokens(params)
      setTokens(rows)
      setSelected((prev) => (prev ? rows.find((r) => r.mint === prev.mint) ?? prev : null))
      setError(null)
    } finally {
      if (background) setRefreshing(false)
    }
  }, [props.tier, searchApplied])

  useEffect(() => {
    const id = window.setTimeout(() => setSearchApplied(searchDraft.trim()), 280)
    return () => window.clearTimeout(id)
  }, [searchDraft])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        await load()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ background: true }).catch((e) => {
        setError(e instanceof Error ? e.message : 'Refresh failed')
      })
    }, tierPollMs)
    return () => window.clearInterval(id)
  }, [load, tierPollMs])

  const rows = useMemo(() => {
    return tokens.map((t) => {
      const change =
        t.price_change_pct != null && Number.isFinite(t.price_change_pct)
          ? t.price_change_pct
          : pctChange(t.first_price_usd, t.price_usd)
      return { ...t, change }
    })
  }, [tokens])

  const closeTokenModal = useCallback(() => {
    setSelected(null)
    setCandles(null)
    setCandlesError(null)
    setPromotedAt(null)
    setPromotedPriceUsd(null)
    setChartSMarkAt(null)
    setChartSMarkPrice(null)
    setChartSMarkReason(null)
    setChartMarkWatch(null)
  }, [])

  useEffect(() => {
    const mint = selected?.mint
    if (!mint) return undefined

    let cancelled = false
    const pull = async () => {
      try {
        const { fromIso } = rangeWindowMs(priceRange)
        const promoteAt = selected?.promoted_at ?? null
        const from = chartFromIsoIncludingPromotion(fromIso, promoteAt)
        const data = await fetchTokenCandles(mint, {
          limit: 5000,
          fromIso: from,
          bucketSecs: tierChartBucketSecs,
        })
        if (!cancelled) {
          setCandles(data.candles)
          setPromotedAt(data.promoted_at ?? promoteAt)
          setPromotedPriceUsd(data.promoted_price_usd ?? null)
          setChartSMarkAt(data.s_mark_at ?? null)
          setChartSMarkPrice(data.s_mark_price_usd ?? null)
          setChartSMarkReason(data.s_mark_reason ?? null)
          if (
            props.tier === 'a' &&
            data.mark_cycle_status === 'open' &&
            data.consecutive_down_count != null &&
            data.s_mark_consecutive_downs != null
          ) {
            setChartMarkWatch({
              status: 'open',
              downCount: data.consecutive_down_count,
              downNeeded: data.s_mark_consecutive_downs,
            })
          } else {
            setChartMarkWatch(null)
          }
          setCandlesError(null)
        }
      } catch (e) {
        if (!cancelled) setCandlesError(e instanceof Error ? e.message : 'Failed to load chart')
      }
    }

    setCandles(null)
    setCandlesError(null)
    void pull()
    const id = window.setInterval(() => void pull(), tierPollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selected?.mint, selected?.promoted_at, priceRange, tierPollMs, tierChartBucketSecs])

  useEffect(() => {
    if (!selected) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTokenModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeTokenModal])

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>{props.title}</h1>
          <p className="muted">{props.description}</p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {props.fastPriceHint}
          </p>
        </div>
        <div className="rightMeta">
          {loading ? (
            <span className="pill">Loading…</span>
          ) : refreshing ? (
            <span className="pill">{rows.length} tokens · updating…</span>
          ) : (
            <span className="pill">{rows.length} tokens</span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          type="search"
          className="searchInput"
          placeholder="Search name or mint…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
      </div>

      {error ? (
        <div className="errorBox">
          <div className="errorTitle">Failed to load</div>
          <div className="errorMsg">{error}</div>
        </div>
      ) : null}

      <div className="card">
        <div className="tableWrap">
          <table className="table watchTable">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Name</th>
                <th style={{ width: 88 }}>Badges</th>
                <th style={{ width: 100 }}>Mcap</th>
                <th style={{ width: 120 }}>First USD</th>
                <th style={{ width: 120 }}>Last USD</th>
                <th style={{ width: 140 }}>Promoted</th>
                <th style={{ width: 90, textAlign: 'right' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 16 }}>
                    No tokens in this tier yet. Promotion runs automatically while the monitor is up.
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const cls = t.change == null ? 'muted' : t.change >= 0 ? 'pos' : 'neg'
                  return (
                    <tr key={t.mint} style={{ cursor: 'pointer' }} onClick={() => setSelected(t)}>
                      <td className="tableTokenName" title={t.name || t.mint}>
                        {t.name?.trim() || '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {t.is_pump_live === true ? (
                            <span className="pill pillLive" title="Pump.fun live">
                              LIVE
                            </span>
                          ) : null}
                          {t.is_dex === true ? (
                            <span className="pill pillDex" title="Graduated to Raydium">
                              DEX
                            </span>
                          ) : null}
                          {t.is_pump_live !== true && t.is_dex !== true ? (
                            <span className="muted" style={{ fontSize: 12 }}>
                              —
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{fmtMcap(t.jupiter_mcap_usd)}</td>
                      <td className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDateTime(t.promoted_at)}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.first_price_usd)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price_usd)}</td>
                      <td className={cls} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtPct(t.change)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BuyTokenModal token={buyFor} onClose={() => setBuyFor(null)} onBought={() => void load()} />

      {selected ? (
        <TokenDetailModal
          token={selected}
          onClose={closeTokenModal}
          onBuy={setBuyFor}
          priceRange={priceRange}
          onPriceRangeChange={setPriceRange}
          candles={candles}
          candlesError={candlesError}
          titleId="tier-token-modal-title"
          liveChart
          chartRangeOptions={TIER_CHART_RANGE_OPTIONS}
          chartBucketSecs={tierChartBucketSecs}
          liveRefreshSecs={tierPollMs / 1000}
          promotedAt={promotedAt ?? selected.promoted_at}
          promotedPriceUsd={promotedPriceUsd}
          chartTier={props.tier}
          sMarkAt={chartSMarkAt}
          sMarkPriceUsd={chartSMarkPrice}
          sMarkReason={chartSMarkReason}
          markWatch={chartMarkWatch}
        />
      ) : null}
    </div>
  )
}
