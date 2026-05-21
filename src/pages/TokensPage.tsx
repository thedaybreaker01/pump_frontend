import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTokenPrices, fetchTokens, postRegisterToken, type PricePointDto, type TokenDto, type TokenListSort } from '../lib/api'
import { isMintWatched, readWatchlist, toggleWatchMint } from '../lib/watchlist'
import BuyTokenModal from '../components/BuyTokenModal'
import PriceChart from '../components/PriceChart'

const SORT_TABS: { key: TokenListSort; label: string; hint: string }[] = [
  { key: 'first_seen', label: 'Newest', hint: 'Latest mints first' },
  { key: 'last_seen', label: 'Active', hint: 'Recent price/update activity' },
  { key: 'change_desc', label: 'Top +%', hint: 'Largest price gain vs first quote' },
  { key: 'change_asc', label: 'Top −%', hint: 'Largest price drop vs first quote' },
]

export type ChartRangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | 'all'

const CHART_RANGE_OPTIONS: { key: ChartRangeKey; label: string }[] = [
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '1 week' },
  { key: '30d', label: '1 month' },
  { key: 'all', label: 'All' },
]

function fromIsoForRange(key: ChartRangeKey): string | null {
  if (key === 'all') return null
  const ms: Record<Exclude<ChartRangeKey, 'all'>, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() - ms[key]).toISOString()
}

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

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
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
  const [prices, setPrices] = useState<PricePointDto[] | null>(null)
  const [pricesError, setPricesError] = useState<string | null>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchApplied, setSearchApplied] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addMint, setAddMint] = useState('')
  const [addName, setAddName] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const rows = await fetchTokens({
          limit: 500,
          offset: 0,
          sort: sortMode,
          search: searchApplied || undefined,
        })
        if (!cancelled) setTokens(rows)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sortMode, tokensNonce, searchApplied])

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
    const mint = selected?.mint
    if (!mint) return undefined

    let cancelled = false
    ;(async () => {
      setPrices(null)
      setPricesError(null)
      try {
        const fromIso = fromIsoForRange(priceRange)
        const pts = await fetchTokenPrices(mint, {
          limit: 2000,
          fromIso: fromIso ?? undefined,
        })
        if (!cancelled) setPrices(pts)
      } catch (e) {
        if (!cancelled) setPricesError(e instanceof Error ? e.message : 'Failed to load prices')
      }
    })()
    return () => {
      cancelled = true
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
    setPrices(null)
    setPricesError(null)
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

        <div className="card tokensNewCell">
          <div className="tokensNewCellHeader">
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

      <div className="sortToolbar tokensNewToolbar">
          <div className="muted tokensNewSortLabel">
            Sort
          </div>
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
          className="formInput toolbarSearchInput tokensNewSearchInput"
          placeholder="Search by name or mint…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          aria-label="Search tokens"
        />
      </div>

          <div className="tableWrap tokensNewTableWrap">
            <table className="table tokensNewTable">
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
            aria-labelledby="token-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div id="token-modal-title" style={{ fontWeight: 650 }}>
                    {selected.name || 'Token'}
                  </div>
                  <div className="muted monoEllipsis" title={selected.mint}>{selected.mint}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <a
                    href={`https://jup.ag/tokens/${encodeURIComponent(selected.mint)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="jupAgTokenLink"
                    title="Open token page on jup.ag"
                    aria-label="Open token on Jupiter (jup.ag)"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="jupAgTokenLinkIcon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M15 3h6v6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M10 14L21 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </a>
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

            <div className="tokenInfoPanel">
              <div className="tokenInfoGrid">
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Symbol</div>
                  <div className="tokenInfoValue">{selected.token_symbol?.trim() || '—'}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Verified</div>
                  <div className="tokenInfoValue">
                    {selected.jupiter_is_verified === true ? 'Yes' : selected.jupiter_is_verified === false ? 'No' : '—'}
                  </div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Decimals</div>
                  <div className="tokenInfoValue">
                    {selected.token_decimals != null && Number.isFinite(selected.token_decimals)
                      ? selected.token_decimals
                      : '—'}
                  </div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Jupiter Mcap</div>
                  <div className="tokenInfoValue">{fmtMcap(selected.jupiter_mcap_usd)}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Organic score</div>
                  <div className="tokenInfoValue">
                    {selected.jupiter_organic_score != null && Number.isFinite(selected.jupiter_organic_score)
                      ? selected.jupiter_organic_score.toFixed(2)
                      : '—'}
                  </div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">24h (Jupiter)</div>
                  <div
                    className={`tokenInfoValue ${
                      selected.stats_24h_price_change_pct == null || !Number.isFinite(selected.stats_24h_price_change_pct)
                        ? 'muted'
                        : selected.stats_24h_price_change_pct >= 0
                          ? 'pos'
                          : 'neg'
                    }`}
                  >
                    {selected.stats_24h_price_change_pct != null && Number.isFinite(selected.stats_24h_price_change_pct)
                      ? fmtPct(selected.stats_24h_price_change_pct)
                      : '—'}
                  </div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">First USD</div>
                  <div className="tokenInfoValue">{fmtUsd(selected.first_price_usd)}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Last USD</div>
                  <div className="tokenInfoValue">{fmtUsd(selected.price_usd)}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Change vs first</div>
                  <div
                    className={`tokenInfoValue ${
                      selected.price_change_pct == null || !Number.isFinite(selected.price_change_pct)
                        ? 'muted'
                        : selected.price_change_pct >= 0
                          ? 'pos'
                          : 'neg'
                    }`}
                  >
                    {selected.price_change_pct != null && Number.isFinite(selected.price_change_pct)
                      ? fmtPct(selected.price_change_pct)
                      : fmtPct(pctChange(selected.first_price_usd, selected.price_usd))}
                  </div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">First seen</div>
                  <div className="tokenInfoValue">{fmtDateTime(selected.first_seen)}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Last seen</div>
                  <div className="tokenInfoValue">{fmtDateTime(selected.last_seen)}</div>
                </div>
                <div className="tokenInfoItem">
                  <div className="tokenInfoLabel">Price updated</div>
                  <div className="tokenInfoValue">{fmtDateTime(selected.price_updated_at)}</div>
                </div>
                <div className="tokenInfoItem tokenInfoItemWide">
                  <div className="tokenInfoLabel">Icon URL</div>
                  <div className="tokenInfoValue monoEllipsis" title={selected.token_icon_url || ''}>
                    {selected.token_icon_url || '—'}
                  </div>
                </div>
              </div>
            </div>

            <div className="chartToolbar">
              <div className="muted" style={{ fontSize: 13 }}>
                Price history (30 min samples)
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

            {pricesError ? (
              <div className="errorBox" style={{ margin: 14 }}>
                <div className="errorTitle">Failed to load price history</div>
                <div className="errorMsg">{pricesError}</div>
              </div>
            ) : prices ? (
              <PriceChart points={prices} compact />
            ) : (
              <div className="muted" style={{ padding: 14 }}>Loading price history…</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
