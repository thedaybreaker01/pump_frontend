import type { CandleDto, TokenDto } from '../lib/api'
import TokenCandleChart from './TokenCandleChart'
import { CHART_RANGE_OPTIONS, type ChartRangeKey } from '../lib/chartRange'

function fmtUsd(v: number | null) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })
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

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtMcap(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return fmtUsd(v)
}

type Props = {
  token: TokenDto
  onClose: () => void
  onBuy: (token: TokenDto) => void
  priceRange: ChartRangeKey
  onPriceRangeChange: (key: ChartRangeKey) => void
  candles: CandleDto[] | null
  candlesError: string | null
  titleId?: string
  /** A/L tier live chart (see `liveRefreshSecs` + `chartBucketSecs`). */
  liveChart?: boolean
  chartRangeOptions?: { key: ChartRangeKey; label: string }[]
  chartBucketSecs?: 1 | 5 | 10 | 60
  liveRefreshSecs?: number
  sMarkAt?: string | null
  sMarkPriceUsd?: number | null
  sMarkReason?: string | null
  /** Open A_mark cycle: progress toward downtrend S_mark. */
  markWatch?: { status: string; downCount: number; downNeeded: number } | null
  promotedAt?: string | null
  promotedPriceUsd?: number | null
  chartTier?: 'a' | 'l' | null
  /** Manual S_mark: show Sell when open A_mark cycle exists. */
  manualSellEnabled?: boolean
  onManualSell?: () => void
  manualSellBusy?: boolean
  manualSellError?: string | null
}

export default function TokenDetailModal(props: Props) {
  const {
    token: selected,
    onClose,
    onBuy,
    priceRange,
    onPriceRangeChange,
    candles,
    candlesError,
    titleId,
    liveChart = false,
    chartRangeOptions = CHART_RANGE_OPTIONS,
    chartBucketSecs = 60,
    liveRefreshSecs = 2,
    sMarkAt,
    sMarkPriceUsd,
    sMarkReason,
    markWatch,
    promotedAt,
    promotedPriceUsd,
    chartTier,
    manualSellEnabled = false,
    onManualSell,
    manualSellBusy = false,
    manualSellError,
  } = props

  const showManualSell =
    manualSellEnabled && chartTier === 'a' && markWatch?.status === 'open' && !sMarkAt

  const tierLabel =
    chartTier === 'a' ? 'A-token' : chartTier === 'l' ? 'L-token' : selected.tier === 'a' ? 'A-token' : selected.tier === 'l' ? 'L-token' : null
  const promotedIso = promotedAt ?? selected.promoted_at ?? null

  return (
    <div
      className="modalBackdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        className="card modalPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId ?? 'token-detail-modal-title'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <div id={titleId ?? 'token-detail-modal-title'} style={{ fontWeight: 650 }}>
                {selected.name || 'Token'}
                {selected.is_pump_live === true ? (
                  <span className="pill pillLive" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                    LIVE
                  </span>
                ) : null}
                {selected.is_dex === true ? (
                  <span className="pill pillDex" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                    DEX
                  </span>
                ) : null}
              </div>
              <div className="muted monoEllipsis" title={selected.mint}>
                {selected.mint}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <a
                href={`https://trade.padre.gg/trade/solana/${encodeURIComponent(selected.mint)}`}
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
              {showManualSell ? (
                <button
                  type="button"
                  className="btnSellSm"
                  style={{ padding: '8px 14px', fontSize: 13 }}
                  disabled={manualSellBusy}
                  title="S_mark at current Jupiter price and remove from A_tokens"
                  onClick={() => onManualSell?.()}
                >
                  {manualSellBusy ? 'Selling…' : 'Sell'}
                </button>
              ) : null}
              <button
                type="button"
                className="btnPrimary"
                style={{ padding: '8px 14px', fontSize: 13 }}
                onClick={() => {
                  onBuy(selected)
                  onClose()
                }}
              >
                Buy
              </button>
              <button type="button" className="pill" onClick={onClose}>
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
                  selected.stats_24h_price_change_pct == null ||
                  !Number.isFinite(selected.stats_24h_price_change_pct)
                    ? 'muted'
                    : selected.stats_24h_price_change_pct >= 0
                      ? 'pos'
                      : 'neg'
                }`}
              >
                {selected.stats_24h_price_change_pct != null &&
                Number.isFinite(selected.stats_24h_price_change_pct)
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
            {promotedIso ? (
              <div className="tokenInfoItem">
                <div className="tokenInfoLabel">
                  Promoted{tierLabel ? ` (${tierLabel})` : ''}
                </div>
                <div className="tokenInfoValue">{fmtDateTime(promotedIso)}</div>
              </div>
            ) : null}
            {selected.price_change_pct_at_promote != null &&
            Number.isFinite(selected.price_change_pct_at_promote) ? (
              <div className="tokenInfoItem">
                <div className="tokenInfoLabel">Change at promote</div>
                <div className="tokenInfoValue">{fmtPct(selected.price_change_pct_at_promote)}</div>
              </div>
            ) : null}
            {selected.mcap_usd_at_promote != null && Number.isFinite(selected.mcap_usd_at_promote) ? (
              <div className="tokenInfoItem">
                <div className="tokenInfoLabel">Mcap at promote</div>
                <div className="tokenInfoValue">{fmtMcap(selected.mcap_usd_at_promote)}</div>
              </div>
            ) : null}
            <div className="tokenInfoItem">
              <div className="tokenInfoLabel">First seen (mint)</div>
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
            Price history
            {candles && candles.length > 0 ? (
              <span className="mono">
                {' '}
                · {candles.filter((c) => (c.samples ?? 0) > 0).length}{' '}
                {liveChart ? `${chartBucketSecs}s` : '1m'} bars
                {liveChart ? ` · refreshes every ${liveRefreshSecs}s` : ''}
                {markWatch?.status === 'open' ? (
                  <span>
                    {' '}
                    · S_mark watch: {markWatch.downCount}/{markWatch.downNeeded} down ticks
                    {chartTier === 'a' ? ' (tier_price must be running)' : ''}
                  </span>
                ) : sMarkAt ? (
                  <span> · S_mark recorded</span>
                ) : chartTier === 'a' && liveChart && manualSellEnabled ? (
                  <span> · manual sell — use Sell when ready (fresh Jupiter price)</span>
                ) : chartTier === 'a' && liveChart ? (
                  <span> · no S_mark yet (auto rules: TP, drawdown, trailing, time stop, or DEX lost)</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="rangeBtns" role="group" aria-label="Chart time range">
            {chartRangeOptions.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`rangeBtn${priceRange === key ? ' active' : ''}`}
                onClick={() => onPriceRangeChange(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {manualSellError ? (
          <div className="errorBox" style={{ margin: '0 14px 8px' }}>
            <div className="errorTitle">Sell failed</div>
            <div className="errorMsg">{manualSellError}</div>
          </div>
        ) : null}
        {candlesError ? (
          <div className="errorBox" style={{ margin: 14 }}>
            <div className="errorTitle">Failed to load price history</div>
            <div className="errorMsg">{candlesError}</div>
          </div>
        ) : candles ? (
          <TokenCandleChart
            candles={candles}
            compact
            live={liveChart}
            promotedAt={promotedIso}
            promotedPriceUsd={promotedPriceUsd}
            tier={chartTier ?? selected.tier ?? null}
            bucketSecs={chartBucketSecs}
            liveRefreshSecs={liveChart ? liveRefreshSecs : undefined}
            sMarkAt={sMarkAt}
            sMarkPriceUsd={sMarkPriceUsd}
            sMarkReason={sMarkReason}
          />
        ) : (
          <div className="muted" style={{ padding: 14 }}>
            Loading price history…
          </div>
        )}
      </div>
    </div>
  )
}
