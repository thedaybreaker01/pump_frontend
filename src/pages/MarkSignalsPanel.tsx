import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import TokenCandleChart from '../components/TokenCandleChart'
import { TIER_A_CHART_BUCKET_SECS, TIER_A_POLL_MS } from '../lib/chartRange'
import {
  chartFromIsoIncludingMarkEvents,
  fetchMarkCycleDetail,
  fetchAllMarkCycles,
  fetchMarkCycles,
  fetchMarkSummary,
  type MarkPnlSummaryDto,
  fetchTokenCandles,
  type CandleDto,
  type LifecycleLogDto,
  type MarkCycleDetailDto,
  type MarkCycleDto,
  type MarkSnapshotDto,
} from '../lib/api'

type Preset = 'day' | 'week' | 'month'

/** Matches `paper_buy_sol` in config.toml (shown in UI when API has no rows yet). */
const PAPER_BUY_SOL_DEFAULT = 0.05

function presetRange(key: Preset): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  if (key === 'day') from.setDate(from.getDate() - 1)
  else if (key === 'week') from.setDate(from.getDate() - 7)
  else from.setDate(from.getDate() - 30)
  return { from: from.toISOString(), to: to.toISOString() }
}

function fmtUsd(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
}

function fmtMcap(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUsd(v)
}

function solTradeCell(
  sol: number | null | undefined,
  tokenUsd: number | null | undefined,
  mcap?: number | null | undefined,
) {
  return (
    <div className="markSolCell">
      <div className="markSolCellPrimary tabular">{sol != null ? fmtSol(sol) : '—'}</div>
      {tokenUsd != null && Number.isFinite(tokenUsd) ? (
        <div className="markSolCellSub muted">token {fmtUsd(tokenUsd)}</div>
      ) : null}
      {mcap != null ? <div className="markSolCellSub muted">mcap {fmtMcap(mcap)}</div> : null}
    </div>
  )
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

/** Paper SOL P/L (preferred when `pnl_sol` is set on the cycle). */
function markPnlSol(c: MarkCycleDto): { sol: number; pct: number } | null {
  if (
    c.pnl_sol != null &&
    c.pnl_sol_pct != null &&
    Number.isFinite(c.pnl_sol) &&
    Number.isFinite(c.pnl_sol_pct)
  ) {
    return { sol: c.pnl_sol, pct: c.pnl_sol_pct }
  }
  return null
}

/** Legacy token USD price delta (not wallet P/L). */
function markPnlPrice(c: MarkCycleDto): { usd: number; pct: number } | null {
  if (c.pnl_usd != null && c.pnl_pct != null && Number.isFinite(c.pnl_usd) && Number.isFinite(c.pnl_pct)) {
    return { usd: c.pnl_usd, pct: c.pnl_pct }
  }
  const buy = c.buy_price_usd
  const sell = c.sell_price_usd
  if (sell == null || !Number.isFinite(sell) || !Number.isFinite(buy) || buy <= 0) return null
  const usd = sell - buy
  return { usd, pct: (usd / buy) * 100 }
}

function fmtSignedSol(v: number) {
  const abs = Math.abs(v)
  const digits = abs >= 1 ? 4 : 6
  const body = abs.toLocaleString(undefined, { maximumFractionDigits: digits })
  if (v < 0) return `−${body} SOL`
  if (v > 0) return `+${body} SOL`
  return `${body} SOL`
}

function fmtSol(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`
}

function pnlClass(usd: number) {
  return usd > 0 ? 'pos' : usd < 0 ? 'neg' : 'muted'
}

function fmtSignedUsd(v: number) {
  const formatted = Math.abs(v).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  })
  if (v < 0) return `-${formatted}`
  if (v > 0) return `+${formatted}`
  return formatted
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtShortDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function sMarkReasonLabel(reason: string | null | undefined) {
  if (!reason) return '—'
  const labels: Record<string, string> = {
    downtrend_3: '3 down ticks',
    drawdown_from_buy: 'Drawdown stop',
    profit_10x: 'Take profit',
    profit_target: 'Take profit',
    trailing_from_peak: 'Trailing stop',
    time_stop_underwater: 'Time stop',
    dex_badge_lost: 'DEX lost',
    tier_exit: 'Tier exit',
    token_deleted: 'Token deleted',
  }
  return labels[reason] ?? reason
}

function outcomeBadge(c: MarkCycleDto): { text: string; className: string } | null {
  const pnl = markPnlSol(c)
  if (!pnl) return null
  if (pnl.sol > 0) return { text: 'Win', className: 'markOutcomeWin' }
  if (pnl.sol < 0) return { text: 'Loss', className: 'markOutcomeLoss' }
  return { text: 'Flat', className: 'markOutcomeFlat' }
}

function formatLifecycleLine(ev: LifecycleLogDto): string {
  const d = ev.detail as Record<string, unknown>
  switch (ev.event_type) {
    case 'a_mark': {
      const buySol = typeof d.buy_sol === 'number' ? fmtSol(d.buy_sol) : null
      const px = fmtUsd(typeof d.buy_price_usd === 'number' ? d.buy_price_usd : null)
      return buySol
        ? `Paper buy ${buySol} · token ${px} · ${String(d.reason ?? '—')}`
        : `Buy ${px} · mcap ${fmtMcap(typeof d.mcap_usd === 'number' ? d.mcap_usd : null)} · ${String(d.reason ?? '—')}`
    }
    case 's_mark': {
      const pnlSol = typeof d.pnl_sol === 'number' ? fmtSignedSol(d.pnl_sol) : null
      const sellSol = typeof d.sell_sol === 'number' ? fmtSol(d.sell_sol) : null
      const px = fmtUsd(typeof d.sell_price_usd === 'number' ? d.sell_price_usd : null)
      if (pnlSol && sellSol) {
        return `Paper sell ${sellSol} · P/L ${pnlSol} · token ${px} · ${String(d.reason ?? '—')}`
      }
      return `Sell ${px} · mcap ${fmtMcap(typeof d.mcap_usd === 'number' ? d.mcap_usd : null)} · ${String(d.reason ?? '—')}`
    }
    case 'moved_to_pump_tokens':
      return `Moved to pump_tokens · ${String(d.token_name ?? d.mint ?? '')}`
    case 'demoted':
      return `Demoted · ${String(d.reason ?? '—')}`
    default:
      return Object.keys(d).length > 0 ? JSON.stringify(d) : '—'
  }
}

function statusLabel(s: string) {
  switch (s) {
    case 'open':
      return 'Open (on A)'
    case 's_marked':
      return 'S_mark (sell signal)'
    case 'demoted':
      return 'Demoted (no S_mark)'
    case 'token_deleted':
      return 'Token deleted'
    default:
      return s
  }
}

/** Tier price ticks (~1s) as chart points. */
function snapshotsAsCandles(snapshots: MarkSnapshotDto[]): CandleDto[] {
  return snapshots.map((s) => ({
    ts: s.fetched_at,
    open_usd: s.price_usd,
    high_usd: s.price_usd,
    low_usd: s.price_usd,
    close_usd: s.price_usd,
    samples: 1,
  }))
}

/** Snapshots are authoritative; fill gaps from `token_prices` buckets when sparse. */
function mergeMarkChartCandles(snapshots: MarkSnapshotDto[], apiCandles: CandleDto[]): CandleDto[] {
  const snapCandles = snapshotsAsCandles(snapshots)
  const byTs = new Map<string, CandleDto>()
  for (const c of apiCandles.filter((x) => (x.samples ?? 0) > 0)) {
    byTs.set(c.ts, c)
  }
  for (const c of snapCandles) {
    byTs.set(c.ts, c)
  }
  const merged = [...byTs.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  return merged.length > 0 ? merged : snapCandles
}

function cycleBucketSecs(cycle: MarkCycleDto): 1 | 5 | 60 {
  const start = Date.parse(cycle.a_mark_at)
  const end = Date.parse(cycle.s_mark_at ?? cycle.closed_at ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 60
  return end - start < 20 * 60_000 ? TIER_A_CHART_BUCKET_SECS : 60
}

type ListMode = 'on_a' | 's_marked' | 'demoted'

export default function MarkSignalsPanel() {
  const [listMode, setListMode] = useState<ListMode>('s_marked')
  const [preset, setPreset] = useState<Preset>('week')
  const [fromIso, setFromIso] = useState(() => presetRange('week').from.slice(0, 16))
  const [toIso, setToIso] = useState(() => presetRange('week').to.slice(0, 16))
  const [cycles, setCycles] = useState<MarkCycleDto[]>([])
  const [summary, setSummary] = useState<{
    total_cycles: number
    s_marked: number
    open: number
    demoted_without_s_mark: number
  } | null>(null)
  const [pnlSummary, setPnlSummary] = useState<MarkPnlSummaryDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<MarkCycleDetailDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [chartCandles, setChartCandles] = useState<CandleDto[]>([])
  const [chartPromotedAt, setChartPromotedAt] = useState<string | null>(null)
  const [chartPromotedPrice, setChartPromotedPrice] = useState<number | null>(null)
  const [chartSMarkAt, setChartSMarkAt] = useState<string | null>(null)
  const [chartSMarkPrice, setChartSMarkPrice] = useState<number | null>(null)
  const [chartSMarkReason, setChartSMarkReason] = useState<string | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'snapshots' | 'log'>('snapshots')

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const fromRfc = new Date(from).toISOString()
      const toRfc = new Date(to).toISOString()
      const summaryOpts =
        listMode === 'on_a'
          ? { from: fromRfc, to: toRfc, activeOnA: true as const }
          : { from: fromRfc, to: toRfc, history: listMode as 's_marked' | 'demoted' }

      const sum = await fetchMarkSummary(summaryOpts)

      const list =
        listMode === 's_marked' || listMode === 'demoted'
          ? await fetchAllMarkCycles(summaryOpts)
          : await fetchMarkCycles({ ...summaryOpts, limit: 500 })

      setCycles(list)
      setSummary(sum.counts)
      setPnlSummary(listMode === 's_marked' ? sum.pnl ?? null : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mark history')
      setCycles([])
      setSummary(null)
      setPnlSummary(null)
    } finally {
      setLoading(false)
    }
  }, [listMode])

  useEffect(() => {
    void load(fromIso, toIso)
  }, [fromIso, toIso, load])

  useEffect(() => {
    setSelectedId(null)
    setDetailTab('snapshots')
  }, [listMode])

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      return undefined
    }
    let cancelled = false
    setDetailLoading(true)
    void fetchMarkCycleDetail(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load cycle detail')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId == null || listMode !== 'on_a') return undefined
    const id = window.setInterval(() => {
      void fetchMarkCycleDetail(selectedId)
        .then((d) => setDetail(d))
        .catch(() => {})
    }, TIER_A_POLL_MS)
    return () => window.clearInterval(id)
  }, [selectedId, listMode])

  useEffect(() => {
    const cycle = cycles.find((c) => c.id === selectedId) ?? detail?.cycle ?? null
    if (!cycle) {
      setChartCandles([])
      setChartPromotedAt(null)
      setChartPromotedPrice(null)
      setChartSMarkAt(null)
      setChartSMarkPrice(null)
      setChartSMarkReason(null)
      return undefined
    }
    let cancelled = false
    setChartLoading(true)
    if (detailLoading || detail?.cycle.id !== cycle.id) {
      return undefined
    }
    const bucketSecs = cycleBucketSecs(cycle)
    const from = chartFromIsoIncludingMarkEvents(
      null,
      cycle.a_mark_at,
      cycle.s_mark_at,
      cycle.closed_at,
    )
    const snaps = detail?.snapshots ?? []
    void fetchTokenCandles(cycle.mint, {
      limit: 2500,
      fromIso: from,
      bucketSecs,
      markCycleId: cycle.id,
    })
      .then((payload) => {
        if (cancelled) return
        const apiCandles = payload.candles.filter((c) => (c.samples ?? 0) > 0)
        const candles = mergeMarkChartCandles(snaps, apiCandles)
        setChartCandles(candles)
        setChartPromotedAt(cycle.a_mark_at)
        setChartPromotedPrice(cycle.buy_price_usd)
        const smAt = cycle.s_mark_at ?? payload.s_mark_at ?? null
        setChartSMarkAt(smAt)
        setChartSMarkPrice(smAt ? (cycle.sell_price_usd ?? payload.s_mark_price_usd ?? null) : null)
        setChartSMarkReason(smAt ? (cycle.s_mark_reason ?? payload.s_mark_reason ?? null) : null)
      })
      .catch(() => {
        if (!cancelled) {
          setChartCandles(mergeMarkChartCandles(snaps, []))
        }
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, cycles, detail, detailLoading, fromIso, listMode])

  const applyPreset = (p: Preset) => {
    setPreset(p)
    const r = presetRange(p)
    setFromIso(r.from.slice(0, 16))
    setToIso(r.to.slice(0, 16))
  }

  const selectedCycle = useMemo(
    () => cycles.find((c) => c.id === selectedId) ?? detail?.cycle ?? null,
    [cycles, selectedId, detail],
  )

  const selectedPnlSol = selectedCycle ? markPnlSol(selectedCycle) : null
  const selectedPnlPrice = selectedCycle ? markPnlPrice(selectedCycle) : null

  const paperBuySol =
    cycles.find((c) => c.buy_sol != null && c.buy_sol > 0)?.buy_sol ?? PAPER_BUY_SOL_DEFAULT

  const solStats = useMemo(() => {
    if (listMode !== 's_marked') return null
    const rows = cycles
      .map((c) => ({ c, pnl: markPnlSol(c) }))
      .filter((x): x is { c: MarkCycleDto; pnl: { sol: number; pct: number } } => x.pnl != null)
    const totalPnl = pnlSummary?.total_pnl_sol ?? rows.reduce((s, x) => s + x.pnl.sol, 0)
    const wins = pnlSummary?.wins ?? rows.filter((x) => x.pnl.sol > 0).length
    const losses = pnlSummary?.losses ?? rows.filter((x) => x.pnl.sol < 0).length
    const n = pnlSummary?.with_pnl_sol ?? rows.length
    const deployed = paperBuySol * n
    const roiPct = deployed > 0 ? (totalPnl / deployed) * 100 : 0
    const winRate = n > 0 ? (wins / n) * 100 : 0
    const chartRows = [...rows]
      .sort((a, b) => Date.parse(a.c.s_mark_at ?? '') - Date.parse(b.c.s_mark_at ?? ''))
      .map((x, i) => ({
        name: (x.c.token_name || x.c.mint.slice(0, 6)).slice(0, 10),
        pnl: x.pnl.sol,
        fill: x.pnl.sol >= 0 ? 'var(--pos)' : 'var(--neg)',
        idx: i + 1,
      }))
    return { totalPnl, wins, losses, n, deployed, roiPct, winRate, chartRows, legacy: (pnlSummary?.total_s_marked ?? cycles.length) - n }
  }, [cycles, listMode, pnlSummary, paperBuySol])

  const tableColSpan = listMode === 's_marked' ? 7 : listMode === 'on_a' ? 6 : 6

  return (
    <div className="markPanel">
      <p className="markIntro">
        {listMode === 'on_a' && (
          <>
            <strong>On A list now</strong> — DEX-validated tokens on A_tokens with live ~1s prices until S_mark.
          </>
        )}
        {listMode === 's_marked' && (
          <>
            <strong>Paper trade history</strong> — each A_mark simulates buying{' '}
            <strong>{paperBuySol} SOL</strong>; S_mark simulates selling back to SOL. P/L is net SOL
            (not token price alone). No wallet transactions.
          </>
        )}
        {listMode === 'demoted' && (
          <>
            <strong>Demoted</strong> — left A without S_mark (below tier rules). Full lifecycle still available per row.
          </>
        )}
      </p>

      <div className="markToolbar">
        <div className="rangeBtns" role="group" aria-label="List mode">
          <button
            type="button"
            className={`rangeBtn${listMode === 'on_a' ? ' active' : ''}`}
            onClick={() => setListMode('on_a')}
          >
            On A list now
          </button>
          <button
            type="button"
            className={`rangeBtn${listMode === 's_marked' ? ' active' : ''}`}
            onClick={() => setListMode('s_marked')}
          >
            Paper P/L history
          </button>
          <button
            type="button"
            className={`rangeBtn${listMode === 'demoted' ? ' active' : ''}`}
            onClick={() => setListMode('demoted')}
          >
            Demoted (no S)
          </button>
        </div>
        <div className="rangeBtns" role="group" aria-label="Range preset">
          {(['day', 'week', 'month'] as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`rangeBtn${preset === p ? ' active' : ''}`}
              onClick={() => applyPreset(p)}
            >
              {p === 'day' ? '24h' : p === 'week' ? '7d' : '30d'}
            </button>
          ))}
        </div>
        <label className="muted" style={{ fontSize: 12 }}>
          From{' '}
          <input
            type="datetime-local"
            value={fromIso}
            onChange={(e) => setFromIso(e.target.value)}
            className="searchInput"
            style={{ width: 168, marginLeft: 4 }}
          />
        </label>
        <label className="muted" style={{ fontSize: 12 }}>
          To{' '}
          <input
            type="datetime-local"
            value={toIso}
            onChange={(e) => setToIso(e.target.value)}
            className="searchInput"
            style={{ width: 168, marginLeft: 4 }}
          />
        </label>
      </div>

      {listMode === 's_marked' && solStats && !loading ? (
        <div className="markSolDashboard">
          <div className={`markSolDashCard markSolDashCard--hero ${pnlClass(solStats.totalPnl)}`}>
            <span className="markSolDashLabel">Net P/L (SOL)</span>
            <span className="markSolDashValue tabular">{fmtSignedSol(solStats.totalPnl)}</span>
            <span className="markSolDashMeta">
              ROI {fmtPct(solStats.roiPct)} on {fmtSol(solStats.deployed)} deployed
            </span>
          </div>
          <div className="markSolDashCard">
            <span className="markSolDashLabel">Win rate</span>
            <span className="markSolDashValue tabular">{solStats.winRate.toFixed(0)}%</span>
            <span className="markSolDashMeta">
              <span className="pos">{solStats.wins}W</span>
              {' · '}
              <span className="neg">{solStats.losses}L</span>
              {solStats.n > solStats.wins + solStats.losses ? (
                <> · {solStats.n - solStats.wins - solStats.losses} flat</>
              ) : null}
            </span>
          </div>
          <div className="markSolDashCard">
            <span className="markSolDashLabel">Trades</span>
            <span className="markSolDashValue tabular">{solStats.n}</span>
            <span className="markSolDashMeta">
              {fmtSol(paperBuySol)} in per A_mark
              {summary && cycles.length < summary.s_marked
                ? ` · showing ${cycles.length}/${summary.s_marked}`
                : null}
            </span>
          </div>
          {solStats.legacy > 0 ? (
            <div className="markSolDashCard markSolDashCard--muted">
              <span className="markSolDashLabel">Legacy rows</span>
              <span className="markSolDashValue tabular">{solStats.legacy}</span>
              <span className="markSolDashMeta">Completed before paper-SOL (price-only P/L)</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {listMode === 's_marked' && solStats && solStats.chartRows.length > 0 && !loading ? (
        <div className="markSolChartCard">
          <div className="markSolChartTitle">P/L per trade (SOL)</div>
          <div className="markSolChartWrap">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={solStats.chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `${Number(v).toFixed(3)}`} />
                <Tooltip
                  formatter={(v) => [fmtSignedSol(Number(v ?? 0)), 'P/L']}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { name: string; idx: number } | undefined
                    return p ? `#${p.idx} ${p.name}` : ''
                  }}
                  contentStyle={{
                    background: 'rgb(22,26,34)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {solStats.chartRows.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#34d399' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {summary && listMode !== 's_marked' ? (
        <div className="markSummaryRow">
          {listMode === 'on_a' ? (
            <span className="pill">{summary.open} open on A</span>
          ) : (
            <span className="pill">{summary.demoted_without_s_mark} demoted without S_mark</span>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="errorBox">
          <div className="errorTitle">Error</div>
          <div className="errorMsg">{error}</div>
        </div>
      ) : null}

      <div className="markTableCard">
        <div className="tableWrap">
          <table className="table watchTable tableCompact">
            <thead>
              <tr>
                <th>Token</th>
                {listMode === 's_marked' ? (
                  <>
                    <th>Closed</th>
                    <th>SOL in</th>
                    <th>SOL out</th>
                    <th style={{ textAlign: 'right' }}>P/L (SOL)</th>
                    <th>Exit</th>
                    <th style={{ textAlign: 'center' }}>Result</th>
                  </>
                ) : (
                  <>
                    <th>A_mark</th>
                    <th>Buy</th>
                    <th>S_mark</th>
                    <th>Sell</th>
                    <th>Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="muted" style={{ padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              ) : cycles.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="muted" style={{ padding: 16 }}>
                    {listMode === 's_marked'
                      ? 'No S_mark cycles in this date range.'
                      : listMode === 'demoted'
                        ? 'No demoted-without-S_mark cycles in this range.'
                        : 'No open cycles on A_tokens.'}
                  </td>
                </tr>
              ) : (
                cycles.map((c) => {
                  const pnlSol = markPnlSol(c)
                  const pnlPrice = markPnlPrice(c)
                  const badge = outcomeBadge(c)
                  const isSelected = selectedId === c.id
                  const buySol = c.buy_sol ?? paperBuySol
                  return (
                    <tr
                      key={c.id}
                      className={`markRowClickable${isSelected ? ' markRowSelected' : ''}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <td className="tableTokenName" title={c.mint}>
                        {c.token_name?.trim() || `${c.mint.slice(0, 8)}…`}
                        <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                          #{c.cycle_no}
                        </span>
                      </td>
                      {listMode === 's_marked' ? (
                        <>
                          <td className="tabular">{fmtShortDateTime(c.s_mark_at ?? c.closed_at)}</td>
                          <td>{solTradeCell(buySol, c.buy_price_usd, c.a_mark_mcap_usd)}</td>
                          <td>{solTradeCell(c.sell_sol, c.sell_price_usd, c.s_mark_mcap_usd)}</td>
                          <td
                            className={`tabular ${pnlSol ? pnlClass(pnlSol.sol) : pnlPrice ? pnlClass(pnlPrice.usd) : 'muted'}`}
                            style={{ textAlign: 'right', fontWeight: 600 }}
                          >
                            {pnlSol ? (
                              <>
                                <div>{fmtSignedSol(pnlSol.sol)}</div>
                                <div style={{ fontSize: 11, fontWeight: 500 }}>{fmtPct(pnlSol.pct)}</div>
                              </>
                            ) : pnlPrice ? (
                              <>
                                <div className="muted" style={{ fontSize: 10 }}>
                                  legacy
                                </div>
                                <div>{fmtSignedUsd(pnlPrice.usd)}</div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <span className="markReasonPill">{sMarkReasonLabel(c.s_mark_reason)}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {badge ? (
                              <span className={`markOutcomeBadge ${badge.className}`}>{badge.text}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="tabular">{fmtShortDateTime(c.a_mark_at)}</td>
                          <td>
                            {c.buy_sol != null
                              ? solTradeCell(c.buy_sol, c.buy_price_usd, c.a_mark_mcap_usd)
                              : solTradeCell(paperBuySol, c.buy_price_usd, c.a_mark_mcap_usd)}
                          </td>
                          <td>
                            <span className="markReasonPill">{sMarkReasonLabel(c.s_mark_reason)}</span>
                          </td>
                          <td>{solTradeCell(c.sell_sol, c.sell_price_usd, c.s_mark_mcap_usd)}</td>
                          <td style={{ fontSize: 12 }}>{statusLabel(c.status)}</td>
                        </>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!selectedCycle ? (
        <div className="markDetailCard markEmptyDetail">
          Select a row to see the paper trade (SOL in → SOL out), net P/L in SOL, price chart, and lifecycle.
        </div>
      ) : detailLoading ? (
        <div className="markDetailCard markEmptyDetail">Loading cycle detail…</div>
      ) : (
        <div className="markDetailCard">
          <div className="markDetailHeader">
            <div className="markDetailTitle">
              <h3>
                {selectedCycle.token_name?.trim() || 'Unnamed'}{' '}
                <span className="muted" style={{ fontWeight: 500 }}>
                  · cycle #{selectedCycle.cycle_no}
                </span>
              </h3>
              <div className="markDetailMint" title={selectedCycle.mint}>
                {selectedCycle.mint}
              </div>
            </div>
            {selectedPnlSol ? (
              <div className="markPnlHero">
                <div className="markPnlHeroLabel">Paper P/L (SOL)</div>
                <div className={`markPnlHeroValue ${pnlClass(selectedPnlSol.sol)}`}>
                  {fmtSignedSol(selectedPnlSol.sol)}
                </div>
                <div className={`markPnlHeroSub ${pnlClass(selectedPnlSol.sol)}`}>
                  {fmtPct(selectedPnlSol.pct)}
                  {selectedCycle.buy_sol != null && selectedCycle.sell_sol != null
                    ? ` · ${fmtSol(selectedCycle.buy_sol)} → ${fmtSol(selectedCycle.sell_sol)}`
                    : null}
                  {selectedCycle.profit_multiple != null
                    ? ` · ${selectedCycle.profit_multiple.toFixed(2)}× price`
                    : null}
                </div>
              </div>
            ) : selectedPnlPrice ? (
              <div className="markPnlHero">
                <div className="markPnlHeroLabel">Price delta only (legacy)</div>
                <div className={`markPnlHeroValue ${pnlClass(selectedPnlPrice.usd)}`}>
                  {fmtSignedUsd(selectedPnlPrice.usd)}
                </div>
                <div className={`markPnlHeroSub ${pnlClass(selectedPnlPrice.usd)}`}>
                  {fmtPct(selectedPnlPrice.pct)}
                </div>
              </div>
            ) : (
              <div className="markPnlHero">
                <div className="markPnlHeroLabel">Status</div>
                <div className="markPnlHeroValue" style={{ fontSize: 16 }}>
                  {statusLabel(selectedCycle.status)}
                </div>
              </div>
            )}
          </div>

          {selectedCycle.buy_sol != null || selectedCycle.sell_sol != null ? (
            <div className="markSolFlow">
              <div className="markSolFlowStep">
                <span className="markSolFlowTag">A_mark · paper buy</span>
                <span className="markSolFlowAmount tabular">
                  {fmtSol(selectedCycle.buy_sol ?? paperBuySol)}
                </span>
                <span className="markSolFlowSub muted">{fmtUsd(selectedCycle.buy_price_usd)} / token</span>
              </div>
              <div className="markSolFlowArrow" aria-hidden>
                →
              </div>
              <div className="markSolFlowStep">
                <span className="markSolFlowTag">S_mark · paper sell</span>
                <span className="markSolFlowAmount tabular">
                  {selectedCycle.sell_sol != null ? fmtSol(selectedCycle.sell_sol) : '—'}
                </span>
                <span className="markSolFlowSub muted">{fmtUsd(selectedCycle.sell_price_usd)} / token</span>
              </div>
              {selectedPnlSol ? (
                <>
                  <div className="markSolFlowArrow" aria-hidden>
                    =
                  </div>
                  <div className={`markSolFlowStep markSolFlowStep--pnl ${pnlClass(selectedPnlSol.sol)}`}>
                    <span className="markSolFlowTag">Net</span>
                    <span className="markSolFlowAmount tabular">{fmtSignedSol(selectedPnlSol.sol)}</span>
                    <span className="markSolFlowSub">{fmtPct(selectedPnlSol.pct)}</span>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="markStatGrid">
            <div className="markStatCard">
              <span className="markStatLabel">A_mark reason</span>
              <span className="markStatValue">{selectedCycle.a_mark_reason}</span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">Buy @ A_mark</span>
              <span className="markStatValue">
                {selectedCycle.buy_sol != null ? fmtSol(selectedCycle.buy_sol) : '—'}
              </span>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                token {fmtUsd(selectedCycle.buy_price_usd)} · mcap {fmtMcap(selectedCycle.a_mark_mcap_usd)}
              </span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">S_mark reason</span>
              <span className="markStatValue">{sMarkReasonLabel(selectedCycle.s_mark_reason)}</span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">Sell @ S_mark</span>
              <span className="markStatValue">
                {selectedCycle.sell_sol != null ? fmtSol(selectedCycle.sell_sol) : '—'}
              </span>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                token {fmtUsd(selectedCycle.sell_price_usd)} · mcap {fmtMcap(selectedCycle.s_mark_mcap_usd)}
              </span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">A_mark time</span>
              <span className="markStatValue">{fmtDateTime(selectedCycle.a_mark_at)}</span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">S_mark time</span>
              <span className="markStatValue">{fmtDateTime(selectedCycle.s_mark_at)}</span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">Down streak @ S</span>
              <span className="markStatValue">{selectedCycle.consecutive_down_count}</span>
            </div>
            <div className="markStatCard">
              <span className="markStatLabel">Status</span>
              <span className="markStatValue">{statusLabel(selectedCycle.status)}</span>
            </div>
          </div>

          <div className="markChartBlock">
            <div className="markChartBlockTitle">Price chart · A / S markers</div>
            {chartLoading ? (
              <div className="muted">Loading chart…</div>
            ) : (
              <TokenCandleChart
                candles={chartCandles}
                compact
                promotedAt={chartPromotedAt}
                promotedPriceUsd={chartPromotedPrice}
                tier="a"
                sMarkAt={chartSMarkAt}
                sMarkPriceUsd={chartSMarkPrice}
                sMarkReason={chartSMarkReason}
                bucketSecs={cycleBucketSecs(selectedCycle)}
                live={selectedCycle.status === 'open'}
                liveRefreshSecs={TIER_A_POLL_MS / 1000}
              />
            )}
          </div>

          <div className="markDetailTabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'snapshots'}
              className={`markDetailTab${detailTab === 'snapshots' ? ' active' : ''}`}
              onClick={() => setDetailTab('snapshots')}
            >
              Price snapshots ({detail?.snapshots.length ?? 0})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === 'log'}
              className={`markDetailTab${detailTab === 'log' ? ' active' : ''}`}
              onClick={() => setDetailTab('log')}
            >
              Lifecycle log ({detail?.lifecycle.length ?? 0})
            </button>
          </div>

          <div className="markDetailTabBody">
            {detailTab === 'snapshots' ? (
              <div className="tableWrap">
                <table className="table markSnapshotTable">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>USD</th>
                      <th>Down#</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.snapshots ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          No snapshots yet (~1s ticks while on A).
                        </td>
                      </tr>
                    ) : (
                      (detail?.snapshots ?? []).map((s: MarkSnapshotDto) => (
                        <tr key={s.id}>
                          <td className="tabular">{fmtDateTime(s.fetched_at)}</td>
                          <td className="tabular">{fmtUsd(s.price_usd)}</td>
                          <td className="tabular">{s.consecutive_down_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div>
                {(detail?.lifecycle ?? []).length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No lifecycle events recorded.
                  </p>
                ) : (
                  (detail?.lifecycle ?? []).map((ev: LifecycleLogDto) => (
                    <div key={ev.id} className="markLogItem">
                      <div className="markLogTime">{fmtDateTime(ev.event_at)}</div>
                      <div className="markLogType">{ev.event_type}</div>
                      <div className="markLogDetail">{formatLifecycleLine(ev)}</div>
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>
                          Raw JSON
                        </summary>
                        <pre
                          style={{
                            margin: '6px 0 0',
                            whiteSpace: 'pre-wrap',
                            fontSize: 11,
                            opacity: 0.85,
                          }}
                        >
                          {JSON.stringify(ev.detail, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
