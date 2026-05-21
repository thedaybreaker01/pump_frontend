import { useCallback, useEffect, useState } from 'react';
import { fetchEstimateBuy, postTradeBuy, type TokenDto } from '../lib/api';

function fmtUsd(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 8
  });
}

function fmtTokEstimate(v: number | null) {
  if (v == null || !Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  const digits = abs >= 1 ? 6 : abs >= 0.0001 ? 8 : 12;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function BuyTokenModal(props: {
  token: TokenDto | null;
  onClose: () => void;
  onBought: () => void;
}) {
  const { token, onClose, onBought } = props;
  const [buySol, setBuySol] = useState('0.05');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [estTokens, setEstTokens] = useState<number | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [estLoading, setEstLoading] = useState(false);

  useEffect(() => {
    if (token) {
      setBuySol('0.05');
      setErr(null);
      setEstTokens(null);
      setEstErr(null);
    }
  }, [token?.mint]);

  useEffect(() => {
    if (!token) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [token, onClose]);

  useEffect(() => {
    if (!token) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const n = Number(buySol);
    if (!Number.isFinite(n) || n <= 0) {
      setEstTokens(null);
      setEstErr(null);
      setEstLoading(false);
      return undefined;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setEstLoading(true);
      setEstErr(null);
      void fetchEstimateBuy({ mint: token.mint, sol_amount: n })
        .then((r) => {
          if (cancelled) return;
          setEstTokens(r.estimated_tokens);
          if (r.estimated_tokens == null) {
            setEstErr(
              'Could not estimate — Jupiter USD prices missing for SOL or this mint.'
            );
          }
        })
        .catch((e) => {
          if (cancelled) return;
          setEstTokens(null);
          setEstErr(e instanceof Error ? e.message : 'Estimate failed');
        })
        .finally(() => {
          if (!cancelled) setEstLoading(false);
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [token, buySol]);

  const submit = useCallback(async () => {
    if (!token) return;
    const n = Number(buySol);
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Enter a positive SOL amount');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await postTradeBuy({ mint: token.mint, sol_amount: n });
      onBought();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Buy failed');
    } finally {
      setBusy(false);
    }
  }, [token, buySol, onBought, onClose]);

  if (!token) return null;

  const tokStr = fmtTokEstimate(estTokens);

  return (
    <div
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="card modalPanel"
        role="dialog"
        aria-modal="true"
        style={{ width: 'min(460px, 100%)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: 14,
            borderBottom: '1px solid rgba(255,255,255,0.12)'
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center'
            }}
          >
            <div>
              <div style={{ fontWeight: 650 }}>Buy {token.name || 'token'}</div>
              <div className="muted monoEllipsis" title={token.mint}>
                {token.mint}
              </div>
            </div>
            <button type="button" className="pill" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div style={{ padding: 14 }} className="formStack">
          <div className="muted" style={{ fontSize: 13 }}>
            Current price (USD estimate)
          </div>
          <div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
            {fmtUsd(token.price_usd)}
          </div>
          <label className="muted" style={{ fontSize: 13 }}>
            SOL to spend
          </label>
          <input
            className="formInput"
            inputMode="decimal"
            value={buySol}
            onChange={(e) => setBuySol(e.target.value)}
          />
          <div className="muted" style={{ fontSize: 12, margin: 0 }}>
            {estLoading ? (
              <span>Estimating tokens…</span>
            ) : tokStr ? (
              <span>
                ≈ <strong style={{ color: 'var(--text)' }}>{tokStr}</strong>{' '}
                tokens (spot USD midpoint — not a swap quote)
              </span>
            ) : estErr ? (
              <span style={{ color: 'rgba(248, 113, 113, 0.95)' }}>
                {estErr}
              </span>
            ) : (
              <span>Enter SOL amount to see an approximate token count.</span>
            )}
          </div>
          {err ? (
            <div className="errorBox">
              <div className="errorMsg">{err}</div>
            </div>
          ) : null}
          <button
            type="button"
            className="btnPrimary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Submitting…' : 'Submit buy'}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            Uses Jupiter swap from your configured wallet
            (`wallet_secret_key_base58`). Real funds at risk — test wallets
            only.
          </p>
        </div>
      </div>
    </div>
  );
}
