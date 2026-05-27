import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchTokenCandles,
  fetchTokens,
  postRegisterToken,
  subscribeTokenEvents,
  type CandleDto,
  type TokenDto,
  type TokenListSort,
} from '../lib/api'
import { isMintWatched, readWatchlist, toggleWatchMint } from '../lib/watchlist'
import BuyTokenModal from '../components/BuyTokenModal'
import TokenDetailModal from '../components/TokenDetailModal'
import { rangeWindowMs, type ChartRangeKey } from '../lib/chartRange'

const SORT_TABS: { key: TokenListSort; label: string; hint: string }[] = [
  { key: 'first_seen', label: 'Newest', hint: 'Latest mints first' },
  { key: 'last_seen', label: 'Active', hint: 'Recent price/update activity' },
  { key: 'change_desc', label: 'Top +%', hint: 'Largest price gain vs first quote' },
  { key: 'change_asc', label: 'Top −%', hint: 'Largest price drop vs first quote' },
]

function fmtUsd(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
}

/** Compact USD for dense insight rows */
function fmtUsdShort(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  const digits = abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits })
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

function fmtListed(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Jupiter `mcap` (USD) compact label */
function fmtMcap(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUsd(v)
}

function TokenThumb({ url, alt }: { url?: string | null; alt: string }) {
  const [bad, setBad] = useState(false)
  if (!url || bad) {
    return <div className="tokenThumb tokenThumbPlaceholder" aria-hidden />
  }
  return <img className="tokenThumb" src={url} alt="" onError={() => setBad(true)} title={alt} />
}

const MAIN_COL_SPAN = 13
const INSIGHTS_ROW_LIMIT = 10
/** Visible columns in each insight table (thumb + data cols). */
const INSIGHT_COL_SPAN = 6

export default function TokensPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tokensNonce, setTokensNonce] = useState(0)
  const [tokens, setTokens] = useState<TokenDto[]>([])
  const [sortMode, setSortMode] = useState<TokenListSort>('first_seen')
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [topMoversPct, setTopMoversPct] = useState<TokenDto[]>([])
  const [topByMcap, setTopByMcap] = useState<TokenDto[]>([])
  const [watchMints, setWatchMints] = useState<string[]>(() => readWatchlist())
  const [selected, setSelected] = useState<TokenDto | null>(null)
  const [buyFor, setBuyFor] = useState<TokenDto | null>(null)
  const [priceRange, setPriceRange] = useState<ChartRangeKey>('24h')
  const [candles, setCandles] = useState<CandleDto[] | null>(null)
  const [candlesError, setCandlesError] = useState<string | null>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchApplied, setSearchApplied] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addMint, setAddMint] = useState('')
  const [addName, setAddName] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  const loadTokens = useCallback(async () => {
    const rows = await fetchTokens({
      limit: 500,
      offset: 0,
      sort: sortMode,
      search: searchApplied || undefined,
    })
    setTokens(rows)
  }, [sortMode, searchApplied])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        await loadTokens()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadTokens, tokensNonce])

  useEffect(() => {
    const id = window.setTimeout(() => setSearchApplied(searchDraft.trim()), 280)
    return () => window.clearTimeout(id)
  }, [searchDraft])

  const closeAddModal = useCallback(() => {
    setAddOpen(false)
    setAddErr(null)
  }, [])

  useEffect(() => {
    if (!addOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAddModal()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [addOpen, closeAddModal])

  const loadInsights = useCallback(async () => {
    try {
      setInsightsLoading(true)
      const [mov, cap] = await Promise.all([
        fetchTokens({ limit: INSIGHTS_ROW_LIMIT, offset: 0, sort: 'change_desc' }),
        fetchTokens({ limit: INSIGHTS_ROW_LIMIT, offset: 0, sort: 'mcap_desc' }),
      ])
      setTopMoversPct(mov)
      setTopByMcap(cap)
    } catch {
      setTopMoversPct([])
      setTopByMcap([])
    } finally {
      setInsightsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInsights()
  }, [loadInsights])

  useEffect(() => {
    if (!loading) void loadInsights()
  }, [loading, loadInsights])

  useEffect(() => {
    let refreshTimer: number | undefined
    const refreshFromEvent = () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        void loadTokens().catch((e) => {
          setError(e instanceof Error ? e.message : 'Failed to load')
        })
        void loadInsights()
      }, 250)
    }

    const unsubscribe = subscribeTokenEvents(refreshFromEvent)
    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer)
      unsubscribe()
    }
  }, [loadTokens, loadInsights])

  useEffect(() => {
    const mint = selected?.mint
    if (!mint) return undefined

    let cancelled = false
    const pull = async () => {
      try {
        const { fromIso } = rangeWindowMs(priceRange)
        const payload = await fetchTokenCandles(mint, {
          limit: 2000,
          fromIso: fromIso ?? undefined,
        })
        if (!cancelled) {
          setCandles(payload.candles)
          setCandlesError(null)
        }
      } catch (e) {
        if (!cancelled) setCandlesError(e instanceof Error ? e.message : 'Failed to load chart')
      }
    }

    setCandles(null)
    setCandlesError(null)
    void pull()
    const id = window.setInterval(() => void pull(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [selected?.mint, priceRange])

  const rows = useMemo(() => {
    return tokens.map((t) => {
      const change =
        t.price_change_pct != null && Number.isFinite(t.price_change_pct)
          ? t.price_change_pct
          : pctChange(t.first_price_usd, t.price_usd)
      return { ...t, change }
    })
  }, [tokens])

  const moverPct = useCallback((t: TokenDto) => {
    if (t.price_change_pct != null && Number.isFinite(t.price_change_pct)) return t.price_change_pct
    return pctChange(t.first_price_usd, t.price_usd)
  }, [])

  const flipWatch = useCallback((mint: string) => {
    setWatchMints(toggleWatchMint(mint).mints)
  }, [])

  const closeTokenModal = useCallback(() => {
    setSelected(null)
    setCandles(null)
    setCandlesError(null)
  }, [])

  useEffect(() => {
    if (!selected) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTokenModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeTokenModal])

  const closeBuyModal = useCallback(() => {
    setBuyFor(null)
  }, [])

  useEffect(() => {
    if (!selected) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [selected])

  return (
    <div className="page tokensPage">
      <div className="pageHeader">
        <div>
          <h1>Tokens</h1>
          <p className="muted">
            Token metadata and mcap come from the Jupiter Tokens API when <code className="mono">jupiter_api_key</code>{' '}
            is set (see{' '}
            <a href="https://developers.jup.ag/docs/guides/how-to-get-token-information" target="_blank" rel="noreferrer">
              Jupiter token info
            </a>
            ). Price cron merges that into Postgres.
          </p>
        </div>
        <div className="rightMeta">
          {loading ? <span className="pill">Loading…</span> : <span className="pill">{rows.length} tokens</span>}
        </div>
      </div>

      {error ? (
        <div className="errorBox">
          <div className="errorTitle">Failed to load</div>
          <div className="errorMsg">{error}</div>
        </div>
      ) : null}

      <div className="tokensThreeCellGrid">
        <div className="tokensInsightsColumn">
          <div className="tokenInsightsGrid">
            <div className="card tokenInsightsCard">
          <div className="moversStripTitle">Best % movers</div>
          <p
            className="muted moversStripSub"
            title="Largest gain vs first tracked USD quote — same ordering as sort “Top +%”. Columns: Δ vs first, last price, Jupiter mcap."
          >
            Top gain vs first quote · shows Δ%, last $, Jupiter mcap.
          </p>
          <div className="tableWrap tokenInsightsTableWrap">
            <table className="table tableCompact tableInsights">
              <thead>
                <tr>
                  <th className="insightsThumbCell" aria-label="Icon" />
                  <th className="insightsSymCell">Sym</th>
                  <th>Name</th>
                  <th className="tabular" style={{ width: '13%', textAlign: 'right' }}>
                    Δ 1st
                  </th>
                  <th className="tabular" style={{ width: '17%', textAlign: 'right' }}>
                    Last
                  </th>
                  <th className="tabular" style={{ width: '17%', textAlign: 'right' }}>
                    Mcap
                  </th>
                </tr>
              </thead>
              <tbody>
                {insightsLoading ? (
                  <tr>
                    <td colSpan={INSIGHT_COL_SPAN} className="muted" style={{ padding: 12 }}>
                      Loading…
                    </td>
                  </tr>
                ) : topMoversPct.length === 0 ? (
                  <tr>
                    <td colSpan={INSIGHT_COL_SPAN} className="muted" style={{ padding: 12 }}>
                      No rows yet.
                    </td>
                  </tr>
                ) : (
                  topMoversPct.map((t) => {
                    const p = moverPct(t)
                    const cls = p == null ? 'muted' : p >= 0 ? 'pos' : 'neg'
                    const label = t.name?.trim() ? t.name.trim() : `${t.mint.slice(0, 6)}…`
                    const sym = t.token_symbol?.trim() || '—'
                    return (
                      <tr
                        key={`mov-${t.mint}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelected(t)}
                      >
                        <td className="insightsThumbCell">
                          <TokenThumb url={t.token_icon_url} alt={label} />
                        </td>
                        <td className="insightsSymCell" title={sym}>
                          {sym}
                        </td>
                        <td className="tableTokenName insightsNameCell" title={t.mint}>
                          {label}
                        </td>
                        <td className={`${cls} tabular`} style={{ textAlign: 'right' }}>
                          {p == null ? '—' : fmtPct(p)}
                        </td>
                        <td className="tabular muted" style={{ textAlign: 'right' }}>
                          {fmtUsdShort(t.price_usd)}
                        </td>
                        <td className="muted tabular" style={{ textAlign: 'right' }}>
                          {fmtMcap(t.jupiter_mcap_usd)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

            <div className="card tokenInsightsCard">
          <div className="moversStripTitle">Trending by market cap</div>
          <p
            className="muted moversStripSub"
            title="Sorted by Jupiter TOKEN field `mcap`. Requires jupiter_api_key and price cron."
          >
            Jupiter mcap order · ✓ = verified, 24h = stats24h.priceChange.
          </p>
          <div className="tableWrap tokenInsightsTableWrap">
            <table className="table tableCompact tableInsights">
              <thead>
                <tr>
                  <th className="insightsThumbCell" aria-label="Icon" />
                  <th className="insightsSymCell">Sym</th>
                  <th>Name</th>
                  <th className="tabular" style={{ width: '20%', textAlign: 'right' }}>
                    Mcap
                  </th>
                  <th style={{ width: '10%', textAlign: 'center' }} title="isVerified">
                    ✓
                  </th>
                  <th className="tabular" style={{ width: '14%', textAlign: 'right' }} title="stats24h.priceChange">
                    24h
                  </th>
                </tr>
              </thead>
              <tbody>
                {insightsLoading ? (
                  <tr>
                    <td colSpan={INSIGHT_COL_SPAN} className="muted" style={{ padding: 12 }}>
                      Loading…
                    </td>
                  </tr>
                ) : topByMcap.length === 0 ? (
                  <tr>
                    <td colSpan={INSIGHT_COL_SPAN} className="muted" style={{ padding: 12 }}>
                      No mcap data yet — check <code className="mono">jupiter_api_key</code>.
                    </td>
                  </tr>
                ) : (
                  topByMcap.map((t) => {
                    const label = t.name?.trim() ? t.name.trim() : `${t.mint.slice(0, 6)}…`
                    const sym = t.token_symbol?.trim() || '—'
                    const ver = t.jupiter_is_verified === true ? '✓' : t.jupiter_is_verified === false ? '—' : '…'
                    const j24 = t.stats_24h_price_change_pct
                    const j24cls =
                      j24 == null || !Number.isFinite(j24) ? 'muted' : j24 >= 0 ? 'pos' : 'neg'
                    return (
                      <tr
                        key={`cap-${t.mint}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelected(t)}
                      >
                        <td className="insightsThumbCell">
                          <TokenThumb url={t.token_icon_url} alt={label} />
                        </td>
                        <td className="insightsSymCell" title={sym}>
                          {sym}
                        </td>
                        <td className="tableTokenName insightsNameCell" title={t.mint}>
                          {label}
                        </td>
                        <td className="tabular muted" style={{ textAlign: 'right' }}>
                          {fmtMcap(t.jupiter_mcap_usd)}
                        </td>
                        <td className="muted" style={{ textAlign: 'center' }}>
                          {ver}
                        </td>
                        <td className={`${j24cls} tabular`} style={{ textAlign: 'right' }}>
                          {j24 != null && Number.isFinite(j24) ? fmtPct(j24) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
          </div>
        </div>

        <div className="card tokenInsightsCard tokensNewCell">
          <div className="tokensNewTop">
            <div>
              <div className="moversStripTitle">New</div>
              <p className="muted moversStripSub">Newest tracked tokens from Postgres.</p>
            </div>
            <button
              type="button"
              className="pill"
              onClick={() => {
                setAddMint('')
                setAddName('')
                setAddErr(null)
                setAddOpen(true)
              }}
            >
              Add token
            </button>
          </div>

          <div className="tokensNewToolbar">
          <div className="rangeBtns" role="tablist" aria-label="Sort tokens">
            {SORT_TABS.map(({ key, label, hint }) => (
              <button
                key={key}
                type="button"
                title={hint}
                className={`rangeBtn${sortMode === key ? ' active' : ''}`}
                role="tab"
                aria-selected={sortMode === key}
                onClick={() => setSortMode(key)}
              >
                {label}
              </button>
            ))}
          </div>
        <input
          type="search"
          className="formInput tokensNewSearchInput"
          placeholder="Search by name or mint…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          aria-label="Search tokens"
        />
      </div>

          <div className="tableWrap tokensNewTableWrap">
            <table className="table tableCompact tableInsights tokensNewTable">
            <thead>
              <tr>
                <th style={{ width: 44 }} aria-label="Watch list" />
                <th style={{ width: 40 }} aria-label="Icon" />
                <th style={{ width: 72 }}>Sym</th>
                <th style={{ minWidth: 160 }}>Name</th>
                <th style={{ width: 140 }}>Listed</th>
                <th>Contract address</th>
                <th style={{ width: 110 }}>First $</th>
                <th style={{ width: 110 }}>Last $</th>
                <th style={{ width: 96, textAlign: 'right' }}>Mcap</th>
                <th style={{ width: 72, textAlign: 'right' }} title="Jupiter stats24h.priceChange">
                  24h
                </th>
                <th style={{ width: 56 }} title="Jupiter isVerified">✓</th>
                <th style={{ width: 88, textAlign: 'right' }}>Δ 1st</th>
                <th style={{ width: 72 }}>Buy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={MAIN_COL_SPAN} className="muted" style={{ padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={MAIN_COL_SPAN} className="muted" style={{ padding: 16 }}>
                    {searchApplied ? 'No tokens match your search.' : 'No tokens yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((t) => {
                  const cls = t.change == null ? 'muted' : t.change >= 0 ? 'pos' : 'neg'
                  const watched = isMintWatched(t.mint, watchMints)
                  const sym = t.token_symbol?.trim() || '—'
                  const j24 = t.stats_24h_price_change_pct
                  const j24cls =
                    j24 == null || !Number.isFinite(j24) ? 'muted' : j24 >= 0 ? 'pos' : 'neg'
                  const ver =
                    t.jupiter_is_verified === true ? '✓' : t.jupiter_is_verified === false ? '—' : '…'
                  const dispName = t.name?.trim() ? t.name.trim() : '—'
                  return (
                    <tr
                      key={t.mint}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelected(t)
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()} style={{ verticalAlign: 'middle' }}>
                        <button
                          type="button"
                          className={`watchStarBtn${watched ? ' active' : ''}`}
                          aria-label={watched ? 'Remove from watch list' : 'Add to watch list'}
                          title={watched ? 'Remove from watch' : 'Watch'}
                          onClick={() => flipWatch(t.mint)}
                        >
                          {watched ? '★' : '☆'}
                        </button>
                      </td>
                      <td style={{ verticalAlign: 'middle' }}>
                        <TokenThumb url={t.token_icon_url} alt={dispName} />
                      </td>
                      <td className="muted" style={{ fontSize: 13 }} title={sym}>
                        {sym}
                      </td>
                      <td className="tableTokenName" title={t.name || ''}>
                        {dispName}
                      </td>
                      <td className="muted" title={t.first_seen ?? ''} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtListed(t.first_seen)}
                      </td>
                      <td className="monoEllipsis" title={t.mint}>
                        {t.mint}
                      </td>
                      <td>{fmtUsd(t.first_price_usd)}</td>
                      <td>{fmtUsd(t.price_usd)}</td>
                      <td className="muted" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                        {fmtMcap(t.jupiter_mcap_usd)}
                      </td>
                      <td className={j24cls} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                        {j24 != null && Number.isFinite(j24) ? fmtPct(j24) : '—'}
                      </td>
                      <td className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
                        {ver}
                      </td>
                      <td className={cls} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtPct(t.change)}
                      </td>
                      <td
                        onClick={(e) => e.stopPropagation()}
                        style={{ verticalAlign: 'middle' }}
                      >
                        <button
                          type="button"
                          className="btnBuySm"
                          onClick={() => {
                            setBuyFor(t)
                          }}
                        >
                          Buy
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      <BuyTokenModal
        token={buyFor}
        onClose={closeBuyModal}
        onBought={() => {
          setTokensNonce((x) => x + 1)
          void loadInsights()
        }}
      />

      {addOpen ? (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddModal()
          }}
          role="presentation"
        >
          <div
            className="card modalPanel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-token-title"
            style={{ width: 'min(460px, 100%)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div id="add-token-title" style={{ fontWeight: 650 }}>
                  Add token to list
                </div>
                <button type="button" className="pill" onClick={closeAddModal}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ padding: 14 }} className="formStack">
              <label className="muted" style={{ fontSize: 13 }}>
                Mint address
              </label>
              <input
                className="formInput"
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                placeholder="Base58 Solana mint"
                value={addMint}
                onChange={(e) => setAddMint(e.target.value)}
                autoComplete="off"
              />
              <label className="muted" style={{ fontSize: 13 }}>
                Name
              </label>
              <input
                className="formInput"
                placeholder="Display name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                autoComplete="off"
              />
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                Registers in Postgres (if enabled). Existing mints update the label. A Jupiter USD quote is fetched when
                possible.
              </p>
              {addErr ? (
                <div className="errorBox">
                  <div className="errorMsg">{addErr}</div>
                </div>
              ) : null}
              <button
                type="button"
                className="btnPrimary"
                disabled={addBusy}
                onClick={() => {
                  const mint = addMint.trim()
                  const name = addName.trim()
                  if (!mint || !name) {
                    setAddErr('Mint and name are required')
                    return
                  }
                  setAddBusy(true)
                  setAddErr(null)
                  void postRegisterToken({ mint, name })
                    .then(() => {
                      closeAddModal()
                      setAddMint('')
                      setAddName('')
                      setTokensNonce((x) => x + 1)
                      void loadInsights()
                    })
                    .catch((e) => {
                      setAddErr(e instanceof Error ? e.message : 'Failed to add token')
                    })
                    .finally(() => setAddBusy(false))
                }}
              >
                {addBusy ? 'Saving…' : 'Save token'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selected ? (
        <TokenDetailModal
          token={selected}
          onClose={closeTokenModal}
          onBuy={setBuyFor}
          priceRange={priceRange}
          onPriceRangeChange={setPriceRange}
          candles={candles}
          candlesError={candlesError}
          titleId="token-modal-title"
        />
      ) : null}
    </div>
  )
}
