import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTokenCandles, fetchTokensBatch, type CandleDto, type TokenDto } from '../lib/api'
import { readWatchlist, toggleWatchMint } from '../lib/watchlist'
import BuyTokenModal from '../components/BuyTokenModal'
import TokenCandleChart from '../components/TokenCandleChart'
import { CHART_RANGE_OPTIONS, rangeWindowMs, type ChartRangeKey } from '../lib/chartRange'

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

export default function WatchlistPage() {
  const [watchMints, setWatchMints] = useState<string[]>(() => readWatchlist())
  const [watchTokens, setWatchTokens] = useState<TokenDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<TokenDto | null>(null)
  const [buyFor, setBuyFor] = useState<TokenDto | null>(null)
  const [priceRange, setPriceRange] = useState<ChartRangeKey>('24h')
  const [candles, setCandles] = useState<CandleDto[] | null>(null)
  const [candlesError, setCandlesError] = useState<string | null>(null)

  useEffect(() => {
    if (watchMints.length === 0) {
      setWatchTokens([])
      setError(null)
      return undefined
    }

    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const rows = await fetchTokensBatch(watchMints)
        if (!cancelled) setWatchTokens(rows)
      } catch (e) {
        if (!cancelled) {
          setWatchTokens([])
          setError(e instanceof Error ? e.message : 'Failed to load')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [watchMints])

  const rows = useMemo(() => {
    return watchTokens.map((t) => {
      const change =
        t.price_change_pct != null && Number.isFinite(t.price_change_pct)
          ? t.price_change_pct
          : pctChange(t.first_price_usd, t.price_usd)
      return { ...t, change }
    })
  }, [watchTokens])

  const flipWatch = useCallback((mint: string) => {
    setWatchMints(toggleWatchMint(mint).mints)
  }, [])

  const closeTokenModal = useCallback(() => {
    setSelected(null)
    setCandles(null)
    setCandlesError(null)
  }, [])

  const closeBuyModal = useCallback(() => {
    setBuyFor(null)
  }, [])

  useEffect(() => {
    const mint = selected?.mint
    if (!mint) return undefined

    let cancelled = false
    ;(async () => {
      setCandles(null)
      setCandlesError(null)
      try {
        const { fromIso } = rangeWindowMs(priceRange)
        const payload = await fetchTokenCandles(mint, {
          limit: 2000,
          fromIso: fromIso ?? undefined,
        })
        if (!cancelled) setCandles(payload.candles)
      } catch (e) {
        if (!cancelled) setCandlesError(e instanceof Error ? e.message : 'Failed to load chart')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected?.mint, priceRange])

  useEffect(() => {
    if (!selected) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTokenModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeTokenModal])

  useEffect(() => {
    if (!selected) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [selected])

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Watch list</h1>
          <p className="muted">
            Pinned mints (stored in this browser). Dead tokens stay visible here with last stored prices; the main list hides them and skips live quotes.
          </p>
        </div>
        <div className="rightMeta">
          <span className="pill">{watchMints.length} pinned</span>
        </div>
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
                <th style={{ width: 40 }} aria-label="Remove" />
                <th style={{ minWidth: 160 }}>Name</th>
                <th style={{ width: 72 }}>Status</th>
                <th style={{ width: 130 }}>First</th>
                <th style={{ width: 130 }}>Last</th>
                <th style={{ width: 100, textAlign: 'right' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {watchMints.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16 }}>
                    No pins yet. Use ☆ on the Tokens page to add mints.
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16 }}>
                    No rows returned — mints may be unknown to the tracker yet.
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const cls = t.change == null ? 'muted' : t.change >= 0 ? 'pos' : 'neg'
                  return (
                    <tr
                      key={`w-${t.mint}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelected(t)}
                    >
                      <td onClick={(e) => e.stopPropagation()} style={{ verticalAlign: 'middle' }}>
                        <button
                          type="button"
                          className="watchStarBtn active"
                          aria-label="Remove from watch list"
                          title="Remove from watch"
                          onClick={() => flipWatch(t.mint)}
                        >
                          ★
                        </button>
                      </td>
                      <td className="tableTokenName" title={t.name || t.mint}>
                        {t.name?.trim() || '—'}
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Active
                        </span>
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

      <BuyTokenModal token={buyFor} onClose={closeBuyModal} onBought={() => {}} />

      {selected ? (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeTokenModal()
          }}
          role="presentation"
        >
          <div
            className="card modalPanel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="watch-token-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div id="watch-token-modal-title" style={{ fontWeight: 650 }}>
                    {selected.name || 'Token'}
                  </div>
                  <div className="muted monoEllipsis" title={selected.mint}>
                    {selected.mint}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btnPrimary"
                    style={{ padding: '8px 14px', fontSize: 13 }}
                    onClick={() => {
                      setBuyFor(selected)
                      closeTokenModal()
                    }}
                  >
                    Buy
                  </button>
                  <button type="button" className="pill" onClick={closeTokenModal}>
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="chartToolbar">
              <div className="muted" style={{ fontSize: 13 }}>
                Price history (1m candles)
                {candles && candles.length > 0 ? (
                  <span className="mono"> · {candles.length} bars</span>
                ) : null}
              </div>
              <div className="rangeBtns" role="group" aria-label="Chart time range">
                {CHART_RANGE_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={`rangeBtn${priceRange === key ? ' active' : ''}`}
                    onClick={() => setPriceRange(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {candlesError ? (
              <div className="errorBox" style={{ margin: 14 }}>
                <div className="errorTitle">Failed to load price history</div>
                <div className="errorMsg">{candlesError}</div>
              </div>
            ) : candles ? (
              <TokenCandleChart candles={candles} compact />
            ) : (
              <div className="muted" style={{ padding: 14 }}>
                Loading price history…
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
