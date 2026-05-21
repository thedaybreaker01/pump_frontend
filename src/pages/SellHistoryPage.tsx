import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fetchSellHistoryBundle, type SellHistoryBundleDto, type SellHistoryRowDto } from '../lib/api'

type Preset = 'day' | 'week' | 'month'

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
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })
}

function fmtAmtTokens(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v)
  const maxFrac = abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8
  return v.toLocaleString(undefined, { maximumFractionDigits: maxFrac })
}

function fmtBuyPx(r: SellHistoryRowDto) {
  if (r.buy_price_usd > 0 && Number.isFinite(r.buy_price_usd)) return fmtUsd(r.buy_price_usd)
  return '—'
}

function sellOutcomeLabel(r: SellHistoryRowDto): { text: string; className: string } {
  if (r.buy_price_usd > 0 && Number.isFinite(r.sell_price_usd)) {
    if (r.sell_price_usd > r.buy_price_usd) return { text: 'Win', className: 'pos' }
    if (r.sell_price_usd < r.buy_price_usd) return { text: 'Loss', className: 'neg' }
    return { text: 'Flat', className: 'muted' }
  }
  if (r.profit_usd > 0) return { text: 'Win', className: 'pos' }
  if (r.profit_usd < 0) return { text: 'Loss', className: 'neg' }
  return { text: 'Flat', className: 'muted' }
}

const PIE_COLORS = ['#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#94a3b8', '#22d3ee']

export default function SellHistoryPage() {
  const [preset, setPreset] = useState<Preset>('month')
  const [fromIso, setFromIso] = useState(() => presetRange('month').from.slice(0, 16))
  const [toIso, setToIso] = useState(() => presetRange('month').to.slice(0, 16))
  const [data, setData] = useState<SellHistoryBundleDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRange = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const d = await fetchSellHistoryBundle({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      })
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sell history')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const { from, to } = presetRange(preset)
    setFromIso(from.slice(0, 16))
    setToIso(to.slice(0, 16))
    void loadRange(from, to)
  }, [preset, loadRange])

  const applyCustom = () => {
    const from = new Date(fromIso)
    const to = new Date(toIso)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      setError('Invalid date range')
      return
    }
    void loadRange(from.toISOString(), to.toISOString())
  }

  const pieData = useMemo(() => {
    if (!data?.profit_by_mint?.length) return []
    const sorted = [...data.profit_by_mint].sort((a, b) => Math.abs(b.profit_usd) - Math.abs(a.profit_usd))
    const top = 8
    const head = sorted.slice(0, top)
    const tail = sorted.slice(top)
    const other = tail.reduce((s, x) => s + x.profit_usd, 0)
    const rows = head.map((x) => ({
      name: x.token_name || x.mint.slice(0, 6),
      value: x.profit_usd,
    }))
    if (Math.abs(other) > 1e-12) rows.push({ name: 'Other', value: other })
    return rows
  }, [data])

  const barData = useMemo(() => {
    if (!data?.profit_by_day) return []
    return data.profit_by_day.map((d) => ({
      day: d.day,
      profit_usd: d.profit_usd,
    }))
  }, [data])

  const mintBarData = useMemo(() => {
    if (!data?.profit_by_mint?.length) return []
    return [...data.profit_by_mint]
      .sort((a, b) => Math.abs(b.profit_usd) - Math.abs(a.profit_usd))
      .slice(0, 12)
      .map((m) => ({
        label: (m.token_name || m.mint).slice(0, 14),
        profit_usd: m.profit_usd,
      }))
  }, [data])

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Sell history</h1>
          <p className="muted">
            Realized P/L uses (sell price − buy price) × amount sold when buy price was recorded; charts and totals match that rule.
          </p>
        </div>
      </div>

      <div className="card sellHistoryRangeBar">
        <div className="sellHistoryRangeInner">
          <div className="rangeBtns sellHistoryPresetBtns" role="tablist" aria-label="Quick date range">
            {(
              [
                ['day', '24h'],
                ['week', '7d'],
                ['month', '30d'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`rangeBtn sellHistoryPresetBtn${preset === k ? ' active' : ''}`}
                onClick={() => setPreset(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="sellHistoryCustomRow">
            <input
              type="datetime-local"
              className="formInput sellHistoryDtInput"
              value={fromIso}
              onChange={(e) => setFromIso(e.target.value)}
              aria-label="From"
            />
            <span className="muted sellHistoryDash">–</span>
            <input
              type="datetime-local"
              className="formInput sellHistoryDtInput"
              value={toIso}
              onChange={(e) => setToIso(e.target.value)}
              aria-label="To"
            />
            <button type="button" className="pill sellHistoryApplyBtn" onClick={applyCustom} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="errorBox">
          <div className="errorTitle">Error</div>
          <div className="errorMsg">{error}</div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="muted" style={{ padding: 16 }}>
          Loading…
        </div>
      ) : data ? (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Total realized P/L
                </div>
                <div style={{ fontSize: 20, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtUsd(data.total_profit_usd)}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Winning / losing trades
                </div>
                <div style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
                  <span className="pos">{data.trades_winning}</span>
                  <span className="muted"> / </span>
                  <span className="neg">{data.trades_losing}</span>
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Rows in range
                </div>
                <div style={{ fontSize: 16 }}>{data.items.length}</div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div className="card" style={{ padding: 12, minHeight: 320 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                P/L by token (pie)
              </div>
              {pieData.length === 0 ? (
                <div className="muted" style={{ padding: 24 }}>
                  No mint-level data.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtUsd(typeof v === 'number' ? v : Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card" style={{ padding: 12, minHeight: 320 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                P/L by day (bars)
              </div>
              {barData.length === 0 ? (
                <div className="muted" style={{ padding: 24 }}>
                  No daily buckets.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="day" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtUsd(typeof v === 'number' ? v : Number(v))} />
                    <Bar dataKey="profit_usd" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card" style={{ padding: 12, minHeight: 320 }}>
              <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                Top tokens by realized P/L (bars)
              </div>
              {mintBarData.length === 0 ? (
                <div className="muted" style={{ padding: 24 }}>
                  No token breakdown.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={mintBarData} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                    <YAxis type="category" dataKey="label" width={92} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmtUsd(typeof v === 'number' ? v : Number(v))} />
                    <Bar dataKey="profit_usd" fill="#34d399" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card">
            <div className="tableWrap">
              <table className="table sellHistoryTable">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Sold at</th>
                    <th>Amount</th>
                    <th>Buy px</th>
                    <th>Sell px</th>
                    <th style={{ textAlign: 'right' }}>P/L</th>
                    <th>Result</th>
                    <th>Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted" style={{ padding: 16 }}>
                        No sells in this range.
                      </td>
                    </tr>
                  ) : (
                    data.items.map((r) => {
                      const out = sellOutcomeLabel(r)
                      return (
                        <tr key={r.id}>
                          <td className="monoEllipsis" title={r.mint}>
                            {r.token_name || r.mint.slice(0, 8)}
                          </td>
                          <td className="muted" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {new Date(r.sold_at).toLocaleString()}
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }} title={r.tokens_sold_raw}>
                            {fmtAmtTokens(r.amount_sold_human)}
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBuyPx(r)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.sell_price_usd)}</td>
                          <td
                            className={r.profit_usd > 0 ? 'pos' : r.profit_usd < 0 ? 'neg' : 'muted'}
                            style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {fmtUsd(r.profit_usd)}
                          </td>
                          <td className={out.className} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {out.text}
                          </td>
                          <td>{r.closed_position ? 'Yes' : 'Partial'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
