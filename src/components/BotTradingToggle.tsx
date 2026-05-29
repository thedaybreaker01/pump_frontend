import { useCallback, useEffect, useState } from 'react'
import { fetchBotTrading, putBotTrading, type BotTradingDto } from '../lib/api'

export default function BotTradingToggle() {
  const [state, setState] = useState<BotTradingDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetchBotTrading()
      setState(r)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load bot status')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(id)
  }, [load])

  const setEnabled = async (enabled: boolean) => {
    if (busy || state?.enabled === enabled) return
    setBusy(true)
    setErr(null)
    try {
      const r = await putBotTrading(enabled)
      setState(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update bot')
    } finally {
      setBusy(false)
    }
  }

  const on = state?.enabled === true

  return (
    <div className="botTradingToggle">
      <div className="botTradingToggleHead">
        <span className="botTradingToggleTitle">Bot</span>
        {state != null ? (
          <span className={`botTradingPill${on ? 'On' : 'Off'}`}>{on ? 'ON' : 'OFF'}</span>
        ) : null}
      </div>
      <div className="botTradingSeg" role="group" aria-label="Bot trading on or off">
        <button
          type="button"
          className={`botTradingSegBtn botTradingSegBtnOn${on ? ' active' : ''}`}
          disabled={busy || on === true}
          title="Resume A-tier promote, buys, and sells"
          onClick={() => void setEnabled(true)}
        >
          Turn on
        </button>
        <button
          type="button"
          className={`botTradingSegBtn botTradingSegBtnOff${on === false ? ' active' : ''}`}
          disabled={busy || on === false}
          title="Stop new A_tokens, buys, and sells"
          onClick={() => void setEnabled(false)}
        >
          Turn off
        </button>
      </div>
      <div className="botTradingHint muted">
        {on
          ? 'Trading active — DEX → A, buys & sells allowed'
          : 'Paused — no new A_tokens, no buys or sells'}
      </div>
      {err ? <div className="botTradingErr">{err}</div> : null}
    </div>
  )
}
