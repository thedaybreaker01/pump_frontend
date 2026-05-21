import { useCallback, useEffect, useState } from 'react'
import {
  fetchEstimateSell,
  fetchTradePositions,
  postTradeSell,
  type TradePositionDto,
} from '../lib/api'

function fmtUsd(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
}

function fmtQty(v: number) {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  const digits = abs >= 1 ? 6 : abs >= 0.0001 ? 8 : 12
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtSolEst(v: number | null) {
  if (v == null || !Number.isFinite(v)) return null
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 8 })} SOL`
}

export default function PositionsPage() {
  const [rows, setRows] = useState<TradePositionDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sellPos, setSellPos] = useState<TradePositionDto | null>(null)
  const [sellAmt, setSellAmt] = useState('')
  const [sellBusy, setSellBusy] = useState(false)
  const [sellErr, setSellErr] = useState<string | null>(null)
  const [sellEstSol, setSellEstSol] = useState<number | null>(null)
  const [sellEstUsd, setSellEstUsd] = useState<number | null>(null)
  const [sellEstBusy, setSellEstBusy] = useState(false)
  const [sellEstErr, setSellEstErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchTradePositions()
      setRows(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load positions')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openSell = (p: TradePositionDto) => {
    setSellPos(p)
    setSellAmt(String(p.token_amount_remaining))
    setSellErr(null)
    setSellEstSol(null)
    setSellEstUsd(null)
    setSellEstErr(null)
  }

  const closeSell = () => {
    setSellPos(null)
    setSellErr(null)
    setSellEstSol(null)
    setSellEstUsd(null)
    setSellEstErr(null)
  }

  useEffect(() => {
    if (!sellPos) return undefined

    const raw = sellAmt.trim()
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      setSellEstSol(null)
      setSellEstUsd(null)
      setSellEstErr(null)
      setSellEstBusy(false)
      return undefined
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setSellEstBusy(true)
      setSellEstErr(null)
      void fetchEstimateSell({ mint: sellPos.mint, token_amount: n })
        .then((r) => {
          if (cancelled) return
          setSellEstSol(r.estimated_sol)
          setSellEstUsd(r.estimated_usd)
          if (r.estimated_sol == null && r.estimated_usd == null) {
            setSellEstErr('Could not estimate — Jupiter USD prices missing.')
          }
        })
        .catch((e) => {
          if (cancelled) return
          setSellEstSol(null)
          setSellEstUsd(null)
          setSellEstErr(e instanceof Error ? e.message : 'Estimate failed')
        })
        .finally(() => {
          if (!cancelled) setSellEstBusy(false)
        })
    }, 320)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [sellPos, sellAmt])

  const submitSell = async () => {
    if (!sellPos) return
    setSellBusy(true)
    setSellErr(null)
    try {
      await postTradeSell({ position_id: sellPos.id, token_amount: sellAmt.trim() })
      closeSell()
      await load()
    } catch (e) {
      setSellErr(e instanceof Error ? e.message : 'Sell failed')
    } finally {
      setSellBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Open positions</h1>
          <p className="muted">Buys still held in the wallet; unrealized PnL uses Jupiter price snapshots.</p>
        </div>
        <button type="button" className="pill" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? (
        <div className="errorBox">
          <div className="errorTitle">Failed to load</div>
          <div className="errorMsg">{error}</div>
        </div>
      ) : null}

      <div className="card">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Token</th>
                <th style={{ width: 130 }}>Buy price</th>
                <th style={{ width: 130 }}>Now</th>
                <th style={{ width: 160 }}>Amount held</th>
                <th style={{ width: 140 }}>Unreal P/L</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 16 }}>
                    No open positions. Buy from the Tokens page.
                  </td>
                </tr>
              ) : (
                rows.map((p) => {
                  const pl = p.unrealized_profit_usd
                  const cls = pl == null ? 'muted' : pl >= 0 ? 'pos' : 'neg'
                  return (
                    <tr key={p.id}>
                      <td className="monoEllipsis" title={p.mint}>
                        {p.token_name || p.mint.slice(0, 8)}
                      </td>
                      <td>{fmtUsd(p.buy_price_usd)}</td>
                      <td>{fmtUsd(p.current_price_usd)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtQty(p.token_amount_remaining)}</td>
                      <td className={cls} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtUsd(pl ?? null)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btnBuySm" onClick={() => openSell(p)}>
                          Sell
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

      {sellPos ? (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSell()
          }}
          role="presentation"
        >
          <div
            className="card modalPanel"
            role="dialog"
            aria-modal="true"
            style={{ width: 'min(440px, 100%)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 650 }}>Sell {sellPos.token_name || 'token'}</div>
                  <div className="muted monoEllipsis" title={sellPos.mint}>
                    {sellPos.mint}
                  </div>
                </div>
                <button type="button" className="pill" onClick={closeSell}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ padding: 14 }} className="formStack">
              <label className="muted" style={{ fontSize: 13 }}>
                Token amount (human units)
              </label>
              <input
                className="formInput"
                value={sellAmt}
                onChange={(e) => setSellAmt(e.target.value)}
                inputMode="decimal"
              />
              <div className="muted" style={{ fontSize: 12, margin: 0 }}>
                {sellEstBusy ? (
                  <span>Estimating proceeds…</span>
                ) : fmtSolEst(sellEstSol) ? (
                  <span>
                    ≈ <strong style={{ color: 'var(--text)' }}>{fmtSolEst(sellEstSol)}</strong>
                    {sellEstUsd != null && Number.isFinite(sellEstUsd) ? (
                      <>
                        {' '}
                        (~ {fmtUsd(sellEstUsd)} spot — not a swap quote)
                      </>
                    ) : null}
                  </span>
                ) : sellEstUsd != null && Number.isFinite(sellEstUsd) ? (
                  <span>
                    ≈ <strong style={{ color: 'var(--text)' }}>{fmtUsd(sellEstUsd)}</strong> notional USD (SOL midpoint unavailable — not a swap quote)
                  </span>
                ) : sellEstErr ? (
                  <span style={{ color: 'rgba(248, 113, 113, 0.95)' }}>{sellEstErr}</span>
                ) : (
                  <span>Enter an amount to see approximate SOL proceeds.</span>
                )}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Max you can sell from this lot: {fmtQty(sellPos.token_amount_remaining)}
              </p>
              {sellErr ? (
                <div className="errorBox" style={{ marginTop: 4 }}>
                  <div className="errorMsg">{sellErr}</div>
                </div>
              ) : null}
              <button type="button" className="btnPrimary" disabled={sellBusy} onClick={() => void submitSell()}>
                {sellBusy ? 'Submitting…' : 'Submit sell'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
