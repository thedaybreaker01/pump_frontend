import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeATokenPromoteEvents, type ATierPromoteEventDto } from '../lib/api'

export type ATierPromoteAlert = ATierPromoteEventDto & { id: number; at: number }

function fmtUsd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
}

function fmtMcap(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUsd(v)
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function desktopNotify(alert: ATierPromoteAlert) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const name = alert.token_name?.trim() || `${alert.mint}`.slice(0, 8)
  const px = fmtUsd(alert.price_usd)
  const body = [alert.is_dex ? 'DEX graduated' : 'Promoted to A', px ? `Price ${px}` : null]
    .filter(Boolean)
    .join(' · ')
  try {
    new Notification(`New A-token: ${name}`, { body, tag: `a-promote-${alert.mint}` })
  } catch {
    /* ignore */
  }
}

type Props = {
  onPromote?: (alert: ATierPromoteAlert) => void
  onOpenA?: (mint: string) => void
}

const MAX_VISIBLE = 6
const AUTO_DISMISS_MS = 45_000

export default function ATokenPromoteAlerts(props: Props) {
  const { onPromote, onOpenA } = props
  const [alerts, setAlerts] = useState<ATierPromoteAlert[]>([])
  const idRef = useRef(0)
  const seenMints = useRef<Set<string>>(new Set())

  const pushAlert = useCallback(
    (ev: ATierPromoteEventDto) => {
      const mint = ev.mint?.trim()
      if (!mint) return
      if (seenMints.current.has(mint)) return
      seenMints.current.add(mint)
      if (seenMints.current.size > 500) {
        const keep = [...seenMints.current].slice(-200)
        seenMints.current = new Set(keep)
      }

      if (ev.op === 'demote') {
        setAlerts((prev) => prev.filter((a) => a.mint !== mint))
        return
      }

      const alert: ATierPromoteAlert = {
        ...ev,
        mint,
        id: ++idRef.current,
        at: Date.now(),
      }
      setAlerts((prev) => [alert, ...prev].slice(0, MAX_VISIBLE))
      onPromote?.(alert)
      desktopNotify(alert)
    },
    [onPromote],
  )

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const unsub = subscribeATokenPromoteEvents((ev) => pushAlert(ev))
    return unsub
  }, [pushAlert])

  useEffect(() => {
    if (alerts.length === 0) return undefined
    const timers = alerts.map((a) =>
      window.setTimeout(() => {
        setAlerts((prev) => prev.filter((x) => x.id !== a.id))
      }, AUTO_DISMISS_MS),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [alerts])

  const dismiss = (id: number) => setAlerts((prev) => prev.filter((a) => a.id !== id))

  if (alerts.length === 0) return null

  return (
    <div className="aPromoteToastStack" role="region" aria-label="A-token promotions">
      {alerts.map((a) => {
        const name = a.token_name?.trim() || 'Unnamed'
        const px = fmtUsd(a.price_usd)
        const mcap = fmtMcap(a.mcap_usd)
        const chg = fmtPct(a.price_change_pct)
        return (
          <div key={a.id} className="aPromoteToast">
            <div className="aPromoteToastAccent" aria-hidden />
            <div className="aPromoteToastBody">
              <div className="aPromoteToastHead">
                <span className="aPromoteToastBadge">NEW A</span>
                <span className="aPromoteToastTitle" title={a.mint}>
                  {name}
                </span>
                <button
                  type="button"
                  className="aPromoteToastClose"
                  aria-label="Dismiss"
                  onClick={() => dismiss(a.id)}
                >
                  ×
                </button>
              </div>
              <div className="aPromoteToastSub">
                {a.is_dex === true ? (
                  <span className="pill pillDex">DEX</span>
                ) : a.is_pump_live === true ? (
                  <span className="pill pillLive">LIVE</span>
                ) : (
                  <span className="pill">A-tier</span>
                )}
                {px ? <span className="tabular">{px}</span> : null}
                {mcap ? <span className="muted">mcap {mcap}</span> : null}
                {chg ? <span className={chg.startsWith('+') ? 'pos' : 'neg'}>{chg}</span> : null}
              </div>
              <div className="aPromoteToastMint monoEllipsis" title={a.mint}>
                {a.mint}
              </div>
              <div className="aPromoteToastActions">
                <button
                  type="button"
                  className="aPromoteToastBtn aPromoteToastBtn--primary"
                  onClick={() => {
                    if (a.mint) onOpenA?.(a.mint)
                  }}
                >
                  Open A list
                </button>
                <button type="button" className="aPromoteToastBtn" onClick={() => dismiss(a.id)}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
