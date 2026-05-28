import { useCallback, useEffect, useState } from 'react'
import { fetchHealth, type HealthDto } from '../lib/api'

function shortPubkey(pk: string | undefined): string {
  if (!pk || pk.length < 12) return pk ?? '—'
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`
}

export default function WalletBalance() {
  const [health, setHealth] = useState<HealthDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void fetchHealth()
      .then((h) => {
        setHealth(h)
        setError(null)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load wallet')
      })
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const configured = health?.wallet === 'configured'
  const balance =
    health?.wallet_balance_sol != null && Number.isFinite(health.wallet_balance_sol)
      ? health.wallet_balance_sol.toFixed(4)
      : null

  return (
    <div className="walletBalance" aria-live="polite">
      <div className="walletBalanceLabel">Wallet</div>
      {!configured ? (
        <div className="walletBalanceMuted">
          {error ?? 'Set wallet_secret_key_base58 in config'}
        </div>
      ) : (
        <>
          <div className="walletBalanceSol">
            {balance != null ? `${balance} SOL` : '— SOL'}
          </div>
          <div className="walletBalanceMeta" title={health?.wallet_pubkey}>
            {shortPubkey(health?.wallet_pubkey)}
            {health?.real_trade_active ? (
              <span className="walletBalanceLive">
                {' '}
                · live · {health.real_trade_buy_sol?.toFixed(2) ?? '?'} SOL/buy
              </span>
            ) : health?.real_trade_enabled ? (
              <span className="walletBalanceMuted"> · real trade off (no wallet in worker)</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
