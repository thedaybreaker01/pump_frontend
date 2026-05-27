import { useCallback, useEffect, useState } from 'react'
import { fetchSMarkMode, putSMarkMode, type SMarkModeDto } from '../lib/api'

type Mode = 'auto' | 'manual'

export default function SMarkModeToggle() {
  const [state, setState] = useState<SMarkModeDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetchSMarkMode()
      setState(r)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load mode')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(id)
  }, [load])

  const setMode = async (mode: Mode) => {
    if (busy || state?.mode === mode) return
    setBusy(true)
    setErr(null)
    try {
      const r = await putSMarkMode(mode)
      setState(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update mode')
    } finally {
      setBusy(false)
    }
  }

  const mode = state?.mode === 'manual' ? 'manual' : state?.mode === 'auto' ? 'auto' : null

  return (
    <div className="sMarkModeToggle">
      <div className="sMarkModeToggleHead">
        <span className="sMarkModeToggleTitle">S_mark</span>
        {mode ? (
          <span className={`sMarkModePill sMarkModePill${mode === 'manual' ? 'Manual' : 'Auto'}`}>
            {mode}
          </span>
        ) : null}
      </div>
      <div className="sMarkModeSeg" role="group" aria-label="S_mark exit mode">
        <button
          type="button"
          className={`sMarkModeSegBtn${mode === 'auto' ? ' active' : ''}`}
          disabled={busy || !state?.s_mark_enabled}
          title="Bot exits on TP, drawdown, trailing, time stop"
          onClick={() => void setMode('auto')}
        >
          Auto
        </button>
        <button
          type="button"
          className={`sMarkModeSegBtn${mode === 'manual' ? ' active' : ''}`}
          disabled={busy || !state?.s_mark_enabled}
          title="You sell from the A-token chart (Sell button)"
          onClick={() => void setMode('manual')}
        >
          Manual
        </button>
      </div>
      {!state?.s_mark_enabled ? (
        <div className="sMarkModeHint muted">S_mark disabled in config</div>
      ) : mode === 'manual' ? (
        <div className="sMarkModeHint muted">Sell on A-token chart</div>
      ) : (
        <div className="sMarkModeHint muted">Rules on ~1s ticks</div>
      )}
      {err ? <div className="sMarkModeErr">{err}</div> : null}
    </div>
  )
}
