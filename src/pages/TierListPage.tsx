import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  chartFromIsoIncludingPromotion,
  fetchATokens,
  fetchLTokens,
  fetchMarkCycles,
  fetchSMarkMode,
  fetchToken,
  fetchTokenCandles,
  postManualMarkSell,
  subscribeATokenPromoteEvents,
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
  focusMint?: string | null
  onFocusMintHandled?: () => void
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
  const [newMintHighlights, setNewMintHighlights] = useState<Set<string>>(() => new Set())
  const knownMintsRef = useRef<Set<string> | null>(null)
  const [manualSellEnabled, setManualSellEnabled] = useState(false)
  const [manualSellBusy, setManualSellBusy] = useState(false)
  const [manualSellError, setManualSellError] = useState<string | null>(null)
  const [missingFocus, setMissingFocus] = useState<{
    mint: string
    name: string
    tier: string | null
    exitReason: string | null
    cycleId: number | null
  } | null>(null)

  useEffect(() => {
    if (props.tier !== 'a') return undefined
    let cancelled = false
    const pull = () => {
      void fetchSMarkMode()
        .then((m) => {
          if (!cancelled) setManualSellEnabled(m.manual_sell_enabled === true)
        })
        .catch(() => {
          if (!cancelled) setManualSellEnabled(false)
        })
    }
    pull()
    const id = window.setInterval(pull, 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [props.tier])

  const load = useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true
    if (background) setRefreshing(true)
    try {
      const params = { limit: 500, offset: 0, search: searchApplied || undefined }
      const rows =
        props.tier === 'a' ? await fetchATokens(params) : await fetchLTokens(params)

      if (props.tier === 'a') {
        const nextMints = new Set(rows.map((r) => r.mint))
        if (knownMintsRef.current != null) {
          const fresh: string[] = []
          for (const m of nextMints) {
            if (!knownMintsRef.current.has(m)) fresh.push(m)
          }
          if (fresh.length > 0) {
            setNewMintHighlights((prev) => {
              const n = new Set(prev)
              for (const m of fresh) n.add(m)
              return n
            })
            window.setTimeout(() => {
              setNewMintHighlights((prev) => {
                const n = new Set(prev)
                for (const m of fresh) n.delete(m)
                return n
              })
            }, 12_000)
          }
        }
        knownMintsRef.current = nextMints
      }

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

  useEffect(() => {
    if (props.tier !== 'a') return undefined
    let debounce: number | undefined
    const unsub = subscribeATokenPromoteEvents((ev) => {
      const mint = ev.mint?.trim()
      if (mint) {
        setNewMintHighlights((prev) => new Set(prev).add(mint))
        window.setTimeout(() => {
          setNewMintHighlights((prev) => {
            const n = new Set(prev)
            n.delete(mint)
            return n
          })
        }, 12_000)
      }
      if (debounce != null) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        void load({ background: true }).catch(() => {})
      }, 80)
    })
    return () => {
      unsub()
      if (debounce != null) window.clearTimeout(debounce)
    }
  }, [props.tier, load])

  useEffect(() => {
    const mint = props.focusMint?.trim()
    if (!mint || props.tier !== 'a') {
      setMissingFocus(null)
      return
    }
    const row = tokens.find((t) => t.mint === mint)
    if (row) {
      setSelected(row)
      setMissingFocus(null)
      props.onFocusMintHandled?.()
      return
    }
    if (loading) return

    let cancelled = false
    void (async () => {
      try {
        const [tok, cycles] = await Promise.all([
          fetchToken(mint),
          fetchMarkCycles({ mint, activeOnA: false, history: 's_marked', limit: 3 }),
        ])
        if (cancelled) return
        if (tok.tier === 'a') {
          setTokens((prev) => (prev.some((t) => t.mint === mint) ? prev : [tok, ...prev]))
          setSelected(tok)
          setMissingFocus(null)
          props.onFocusMintHandled?.()
          return
        }
        const latest = cycles[0]
        setMissingFocus({
          mint,
          name: tok.name?.trim() || latest?.token_name?.trim() || mint.slice(0, 8),
          tier: tok.tier ?? null,
          exitReason: latest?.s_mark_reason ?? latest?.close_reason ?? null,
          cycleId: latest?.id ?? null,
        })
        props.onFocusMintHandled?.()
      } catch {
        if (!cancelled) {
          setMissingFocus({
            mint,
            name: mint.slice(0, 8),
            tier: null,
            exitReason: null,
            cycleId: null,
          })
          props.onFocusMintHandled?.()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [props.focusMint, props.tier, tokens, loading, props.onFocusMintHandled])

  const rows = useMemo(() => {
    return tokens.map((t) => {
      const change =
        props.tier === 'a'
          ? t.change_vs_a_mark_pct != null && Number.isFinite(t.change_vs_a_mark_pct)
            ? t.change_vs_a_mark_pct
            : pctChange(t.a_mark_buy_price_usd ?? null, t.price_usd)
          : t.price_change_pct != null && Number.isFinite(t.price_change_pct)
            ? t.price_change_pct
            : pctChange(t.first_price_usd, t.price_usd)
      return { ...t, change }
    })
  }, [tokens, props.tier])

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
    setManualSellBusy(false)
    setManualSellError(null)
  }, [])

  const submitManualSell = useCallback(async () => {
    const mint = selected?.mint
    if (!mint || !manualSellEnabled) return
    setManualSellBusy(true)
    setManualSellError(null)
    try {
      await postManualMarkSell(mint)
      closeTokenModal()
      await load({ background: true })
    } catch (e) {
      setManualSellError(e instanceof Error ? e.message : 'Sell failed')
    } finally {
      setManualSellBusy(false)
    }
  }, [selected?.mint, manualSellEnabled, closeTokenModal, load])

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
      {missingFocus ? (
        <div className="aFocusMissingBanner" role="status">
          <strong>{missingFocus.name}</strong> was promoted to A but is no longer on this list
          {missingFocus.tier === 'a'
            ? ' (refreshing…)'
            : missingFocus.exitReason
              ? ` — exited: ${missingFocus.exitReason.replace(/_/g, ' ')}`
              : ' — likely removed when pump.fun DEX badge lagged after graduation'}
          . Check <strong>Buy / Sell → Mark signals → S_marked</strong> for history
          {missingFocus.cycleId != null ? ` (cycle #${missingFocus.cycleId})` : ''}.
          <button type="button" className="pill" style={{ marginLeft: 10 }} onClick={() => setMissingFocus(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

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

      {props.tier === 'a' && newMintHighlights.size > 0 ? (
        <div className="aPromoteBanner" role="status">
          <span className="aPromoteBannerBadge">NEW</span>
          <span>
            {newMintHighlights.size === 1
              ? '1 token just moved to A_tokens'
              : `${newMintHighlights.size} tokens just moved to A_tokens`}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            — highlighted in the list below
          </span>
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
                <th style={{ width: 96, textAlign: 'right' }} title={props.tier === 'a' ? 'Current token USD vs A_mark buy (S_mark rules use this)' : 'Change vs first seen price'}>
                  {props.tier === 'a' ? 'vs A_mark' : 'Change'}
                </th>
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
                  const isNew = props.tier === 'a' && newMintHighlights.has(t.mint)
                  return (
                    <tr
                      key={t.mint}
                      className={isNew ? 'tierRowNew' : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelected(t)}
                    >
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
                          {props.tier !== 'a' && t.is_pump_live !== true && t.is_dex !== true ? (
                            <span className="muted" style={{ fontSize: 12 }}>
                              —
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{fmtMcap(t.jupiter_mcap_usd)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.first_price_usd)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price_usd)}</td>
                      <td className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDateTime(t.promoted_at)}
                      </td>
                      <td
                        className={cls}
                        style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                        title={
                          props.tier === 'a' && t.a_mark_buy_price_usd != null
                            ? `A_mark buy ${fmtUsd(t.a_mark_buy_price_usd)} → now ${fmtUsd(t.price_usd)}`
                            : props.tier === 'a'
                              ? 'A_mark buy price unavailable'
                              : `First ${fmtUsd(t.first_price_usd)} → now ${fmtUsd(t.price_usd)}`
                        }
                      >
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
          manualSellEnabled={props.tier === 'a' && manualSellEnabled}
          onManualSell={() => void submitManualSell()}
          manualSellBusy={manualSellBusy}
          manualSellError={manualSellError}
        />
      ) : null}
    </div>
  )
}
