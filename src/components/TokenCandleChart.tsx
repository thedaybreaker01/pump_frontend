import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { CandleDto } from '../lib/api'
import { TIER_A_LIVE_CHART_WINDOW_SECS } from '../lib/chartRange'

const MIN_CHART_PRICE_USD = 1e-12
const MIN_CANDLES_FOR_OHLC = 30
const MIN_CANDLES_FOR_OHLC_LIVE = 3

/** Padre / terminal-like palette for dense 1s bars. */
const TV = {
  plotBg: '#0c0e14',
  grid: '#1e222d',
  gridAccent: '#2a3142',
  text: '#d1d4dc',
  textMuted: '#787b86',
  up: '#26a69a',
  upBorder: '#1b8a7a',
  down: '#ef5350',
  downBorder: '#c62828',
  line: '#5b9cf6',
  volUp: 'rgba(38, 166, 154, 0.45)',
  volDown: 'rgba(239, 83, 80, 0.45)',
  markerA: '#f0b429',
  markerL: '#5c9eff',
  markerS: '#ef5350',
  crosshair: '#758696',
}

function toUtcSeconds(ts: string | number): UTCTimestamp | null {
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts)) return null
    const sec = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
    return sec as UTCTimestamp
  }
  const ms = Date.parse(ts)
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000) as UTCTimestamp
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= MIN_CHART_PRICE_USD ? n : null
}

function isRealBar(c: CandleDto): boolean {
  return (c.samples ?? 0) > 0
}

function injectMarkAnchorCandles(
  candles: CandleDto[],
  anchors: { at?: string | null; price?: number | null }[],
): CandleDto[] {
  const bySec = new Map<number, CandleDto>()
  for (const c of candles) {
    if (!isRealBar(c)) continue
    const t = toUtcSeconds(c.ts as string | number)
    if (t == null) continue
    bySec.set(t as number, c)
  }
  for (const a of anchors) {
    if (!a.at) continue
    const px = num(a.price)
    if (px == null) continue
    const t = toUtcSeconds(a.at)
    if (t == null) continue
    if (!bySec.has(t as number)) {
      bySec.set(t as number, {
        ts: a.at,
        open_usd: px,
        high_usd: px,
        low_usd: px,
        close_usd: px,
        samples: 1,
      })
    }
  }
  return [...bySec.values()].sort(
    (a, b) =>
      (toUtcSeconds(a.ts as string | number) as number) -
      (toUtcSeconds(b.ts as string | number) as number),
  )
}

function ohlcForChart(
  o: number,
  h: number,
  l: number,
  c: number,
  tightBodies: boolean,
): { open: number; high: number; low: number; close: number } {
  const ref = Math.max(o, h, l, c, MIN_CHART_PRICE_USD)
  const floor = ref * 1e-6
  const cap = ref * 1e6
  let lo = Math.max(l, floor)
  let hi = Math.min(Math.max(h, lo), cap)
  let open = o
  let close = c
  lo = Math.min(lo, open, close)
  hi = Math.max(hi, open, close, lo)

  const span = hi - lo
  const minSpan = ref * (tightBodies ? 0.0006 : 0.0015)
  if (span < minSpan) {
    const mid = (open + close) / 2
    const half = minSpan / 2
    if (close >= open) {
      open = mid - half * 0.4
      close = mid + half * 0.4
      hi = mid + half
      lo = mid - half
    } else {
      open = mid + half * 0.4
      close = mid - half * 0.4
      hi = mid + half
      lo = mid - half
    }
  }

  return { open, high: hi, low: lo, close }
}

function buildCandleSeries(
  candles: CandleDto[],
  tightBodies: boolean,
): CandlestickData<UTCTimestamp>[] {
  const byTime = new Map<number, CandlestickData<UTCTimestamp>>()
  for (const c of candles) {
    if (!isRealBar(c)) continue
    const t = toUtcSeconds(c.ts as string | number)
    const o = num(c.open_usd)
    const h = num(c.high_usd)
    const l = num(c.low_usd)
    const cl = num(c.close_usd)
    if (t == null || o == null || h == null || l == null || cl == null) continue
    byTime.set(t as number, { time: t, ...ohlcForChart(o, h, l, cl, tightBodies) })
  }
  return [...byTime.values()].sort((a, b) => (a.time as number) - (b.time as number))
}

function buildLineSeries(candles: CandleDto[]): LineData<UTCTimestamp>[] {
  const byTime = new Map<number, LineData<UTCTimestamp>>()
  for (const c of candles) {
    if (!isRealBar(c)) continue
    const t = toUtcSeconds(c.ts as string | number)
    const cl = num(c.close_usd)
    if (t == null || cl == null) continue
    byTime.set(t as number, { time: t, value: cl })
  }
  return [...byTime.values()].sort((a, b) => (a.time as number) - (b.time as number))
}

function buildVolumeSeries(
  candles: CandleDto[],
  candleData: CandlestickData<UTCTimestamp>[],
): HistogramData<UTCTimestamp>[] {
  const closeByTime = new Map<number, number>()
  for (const d of candleData) {
    closeByTime.set(d.time as number, d.close)
  }
  const out: HistogramData<UTCTimestamp>[] = []
  for (const c of candles) {
    if (!isRealBar(c)) continue
    const t = toUtcSeconds(c.ts as string | number)
    if (t == null) continue
    const o = num(c.open_usd)
    const cl = num(c.close_usd)
    const samples = Math.max(c.samples ?? 1, 1)
    const h = num(c.high_usd)
    const l = num(c.low_usd)
    const range = h != null && l != null ? Math.max(h - l, 0) : 0
    const value = Math.max(samples, range * 1e6)
    const prevClose = closeByTime.get(t as number) ?? cl ?? o ?? 0
    const closePx = cl ?? prevClose
    const openPx = o ?? prevClose
    const up = closePx >= openPx
    out.push({
      time: t,
      value,
      color: up ? TV.volUp : TV.volDown,
    })
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number))
}

function priceFormatForValues(vals: number[]) {
  const ref = Math.max(...vals, MIN_CHART_PRICE_USD)
  let minMove = 0.01
  let precision = 2
  if (ref < 1) {
    const exp = Math.floor(Math.log10(ref))
    minMove = 10 ** (exp - 1)
    precision = Math.min(12, Math.max(6, -exp + 3))
  } else if (ref < 1000) {
    minMove = 0.0001
    precision = 6
  }
  return { type: 'price' as const, precision, minMove }
}

function formatUsdLabel(p: number): string {
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (p >= 1e-4) return p.toFixed(8)
  return p.toPrecision(6)
}

function formatUsdCompact(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`
  if (p >= 10_000) return `$${(p / 1_000).toFixed(1)}K`
  return formatUsdLabel(p)
}

function formatTimeLabel(sec: number, showSeconds: boolean): string {
  const d = new Date(sec * 1000)
  if (showSeconds) {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function priceAtBucket(candles: CandleDto[], promotedSec: number, bucketSecs: number): number | null {
  const bucketStart = promotedSec - (promotedSec % bucketSecs)
  let best: { dist: number; price: number } | null = null
  for (const c of candles) {
    if (!isRealBar(c)) continue
    const t = toUtcSeconds(c.ts as string | number)
    const cl = num(c.close_usd)
    if (t == null || cl == null) continue
    const dist = Math.abs((t as number) - bucketStart)
    if (!best || dist < best.dist) best = { dist, price: cl }
  }
  return best?.price ?? null
}

type ChartMode = 'candles' | 'line'

type OhlcHead = {
  price: string
  changePct: string | null
  changeUp: boolean | null
  o: string | null
  h: string | null
  l: string | null
  c: string | null
  time: string | null
}

function headFromCandle(
  c: CandlestickData<UTCTimestamp> | null,
  firstClose: number | null,
  showSeconds: boolean,
): OhlcHead {
  if (!c) {
    return {
      price: '—',
      changePct: null,
      changeUp: null,
      o: null,
      h: null,
      l: null,
      c: null,
      time: null,
    }
  }
  const chg =
    firstClose != null && firstClose > 0
      ? ((c.close - firstClose) / firstClose) * 100
      : null
  return {
    price: formatUsdCompact(c.close),
    changePct: chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : null,
    changeUp: chg != null ? chg >= 0 : null,
    o: formatUsdLabel(c.open),
    h: formatUsdLabel(c.high),
    l: formatUsdLabel(c.low),
    c: formatUsdLabel(c.close),
    time: formatTimeLabel(c.time as number, showSeconds),
  }
}

export default function TokenCandleChart(props: {
  candles: CandleDto[]
  compact?: boolean
  live?: boolean
  promotedAt?: string | null
  promotedPriceUsd?: number | null
  tier?: 'a' | 'l' | null
  sMarkAt?: string | null
  sMarkPriceUsd?: number | null
  sMarkReason?: string | null
  bucketSecs?: number
  liveRefreshSecs?: number
}) {
  const {
    candles,
    compact,
    live = false,
    promotedAt,
    promotedPriceUsd,
    tier,
    sMarkAt,
    sMarkPriceUsd,
    sMarkReason,
    bucketSecs = live ? (tier === 'a' ? 1 : 5) : 60,
    liveRefreshSecs: liveRefreshSecsProp,
  } = props

  const isFastLive = live && bucketSecs <= 1
  const liveRefreshSecs =
    liveRefreshSecsProp ?? (bucketSecs <= 1 ? 1 : bucketSecs <= 5 ? 2 : 60)
  const barLabel =
    bucketSecs <= 1 ? '1s' : bucketSecs <= 5 ? '5s' : bucketSecs <= 10 ? '10s' : '1m'
  const minCandlesForOhlc = live ? MIN_CANDLES_FOR_OHLC_LIVE : MIN_CANDLES_FOR_OHLC
  const chartHeight = compact ? (isFastLive ? 400 : 300) : isFastLive ? 540 : 440

  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const modeRef = useRef<ChartMode>('line')
  const firstCloseRef = useRef<number | null>(null)

  const [ohlcHead, setOhlcHead] = useState<OhlcHead>({
    price: '—',
    changePct: null,
    changeUp: null,
    o: null,
    h: null,
    l: null,
    c: null,
    time: null,
  })

  const candlesForChart = useMemo(
    () =>
      injectMarkAnchorCandles(candles, [
        { at: promotedAt, price: promotedPriceUsd },
        { at: sMarkAt, price: sMarkPriceUsd },
      ]),
    [candles, promotedAt, promotedPriceUsd, sMarkAt, sMarkPriceUsd],
  )

  const plan = useMemo(() => {
    const real = candlesForChart.filter(isRealBar)
    const candleData = buildCandleSeries(candlesForChart, isFastLive)
    const lineData = buildLineSeries(candlesForChart)
    const mode: ChartMode = candleData.length >= minCandlesForOhlc ? 'candles' : 'line'
    const active = mode === 'candles' ? candleData : lineData
    const times = active.map((d) => d.time as number)
    const spanSec = times.length >= 2 ? Math.max(...times) - Math.min(...times) : 0
    const volumeData =
      mode === 'candles' && isFastLive ? buildVolumeSeries(candlesForChart, candleData) : []
    const firstClose =
      mode === 'candles' && candleData.length > 0
        ? candleData[0]!.close
        : lineData.length > 0
          ? lineData[0]!.value
          : null
    return {
      mode,
      candleData,
      lineData,
      volumeData,
      realCount: real.length,
      activeCount: active.length,
      active,
      spanSec,
      firstClose,
      lastCandle: mode === 'candles' ? candleData[candleData.length - 1] ?? null : null,
    }
  }, [candlesForChart, minCandlesForOhlc, isFastLive])

  useEffect(() => {
    firstCloseRef.current = plan.firstClose
    const showSeconds = isFastLive || plan.spanSec < 3600
    if (plan.mode === 'candles' && plan.lastCandle) {
      setOhlcHead(headFromCandle(plan.lastCandle, plan.firstClose, showSeconds))
    } else if (plan.lineData.length > 0) {
      const last = plan.lineData[plan.lineData.length - 1]!
      const chg =
        plan.firstClose != null && plan.firstClose > 0
          ? ((last.value - plan.firstClose) / plan.firstClose) * 100
          : null
      setOhlcHead({
        price: formatUsdCompact(last.value),
        changePct: chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : null,
        changeUp: chg != null ? chg >= 0 : null,
        o: null,
        h: null,
        l: null,
        c: formatUsdLabel(last.value),
        time: formatTimeLabel(last.time as number, showSeconds),
      })
    }
  }, [plan, isFastLive])

  const promotionMarker = useMemo((): SeriesMarker<Time> | null => {
    if (!promotedAt) return null
    const promotedSec = toUtcSeconds(promotedAt)
    if (promotedSec == null) return null

    let price = num(promotedPriceUsd)
    if (price == null) {
      price = priceAtBucket(candlesForChart, promotedSec as number, bucketSecs)
    }
    if (price == null) return null

    const label = tier === 'l' ? 'L' : tier === 'a' ? 'A' : 'P'
    const color = tier === 'l' ? TV.markerL : TV.markerA

    return {
      id: 'tier-promoted',
      time: promotedSec,
      position: 'belowBar',
      shape: 'circle',
      color,
      text: label,
    }
  }, [promotedAt, promotedPriceUsd, tier, candlesForChart, bucketSecs])

  const sMarkMarker = useMemo((): SeriesMarker<Time> | null => {
    if (!sMarkAt) return null
    const markSec = toUtcSeconds(sMarkAt)
    if (markSec == null) return null

    let price = num(sMarkPriceUsd)
    if (price == null) {
      price = priceAtBucket(candlesForChart, markSec as number, bucketSecs)
    }
    if (price == null) return null

    const reason =
      sMarkReason === 'profit_10x'
        ? '4×'
        : sMarkReason === 'downtrend_3'
          ? '↓3'
          : sMarkReason === 'drawdown_from_buy'
            ? '↓40'
            : sMarkReason === 'dex_badge_lost'
              ? 'DEX'
              : sMarkReason === 'tier_exit'
                ? 'exit'
                : sMarkReason === 'token_deleted'
                  ? 'del'
                  : sMarkReason === 'manual_sell'
                    ? 'you'
                    : 'S'

    return {
      id: 's-mark',
      time: markSec,
      position: 'aboveBar',
      shape: 'square',
      color: TV.markerS,
      text: reason,
    }
  }, [sMarkAt, sMarkPriceUsd, sMarkReason, candlesForChart, bucketSecs])

  const chartMarkers = useMemo(() => {
    const list: SeriesMarker<Time>[] = []
    if (promotionMarker) list.push(promotionMarker)
    if (sMarkMarker) list.push(sMarkMarker)
    return list
  }, [promotionMarker, sMarkMarker])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined

    const chart = createChart(el, {
      width: Math.max(el.clientWidth, 20),
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: TV.plotBg },
        textColor: TV.text,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        fontSize: isFastLive ? 11 : 12,
      },
      grid: {
        vertLines: { color: TV.grid, style: 1 },
        horzLines: { color: TV.grid, style: 1 },
      },
      rightPriceScale: {
        borderColor: TV.gridAccent,
        autoScale: true,
        scaleMargins: { top: 0.06, bottom: isFastLive ? 0.28 : 0.12 },
      },
      timeScale: {
        borderColor: TV.gridAccent,
        timeVisible: true,
        secondsVisible: isFastLive || live,
        rightOffset: isFastLive ? 8 : 6,
        minBarSpacing: isFastLive ? 2.5 : 2,
        barSpacing: isFastLive ? 6 : 8,
        fixRightEdge: isFastLive,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV.crosshair, width: 1, style: 2, labelBackgroundColor: '#363a45' },
        horzLine: { color: TV.crosshair, width: 1, style: 2, labelBackgroundColor: '#363a45' },
      },
      localization: { priceFormatter: formatUsdLabel },
    })

    chartRef.current = chart
    seriesRef.current = null
    volumeRef.current = null
    markersRef.current = null
    modeRef.current = 'line'

    const showSeconds = isFastLive || live
    const onCrosshair = (param: {
      time?: Time
      seriesData: Map<unknown, unknown>
    }) => {
      const series = seriesRef.current
      if (!series || !param.time) {
        if (plan.lastCandle) {
          setOhlcHead(headFromCandle(plan.lastCandle, firstCloseRef.current, showSeconds))
        }
        return
      }
      const raw = param.seriesData.get(series)
      if (!raw || typeof raw !== 'object') return
      if (plan.mode === 'candles' && 'open' in raw) {
        const bar = raw as CandlestickData<UTCTimestamp>
        setOhlcHead(headFromCandle(bar, firstCloseRef.current, showSeconds))
      } else if ('value' in raw) {
        const pt = raw as LineData<UTCTimestamp>
        const chg =
          firstCloseRef.current != null && firstCloseRef.current > 0
            ? ((pt.value - firstCloseRef.current) / firstCloseRef.current) * 100
            : null
        setOhlcHead({
          price: formatUsdCompact(pt.value),
          changePct: chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : null,
          changeUp: chg != null ? chg >= 0 : null,
          o: null,
          h: null,
          l: null,
          c: formatUsdLabel(pt.value),
          time: formatTimeLabel(param.time as number, showSeconds),
        })
      }
    }
    chart.subscribeCrosshairMove(onCrosshair)

    const ro = new ResizeObserver(() => {
      if (chartRef.current && el.clientWidth >= 20) {
        chartRef.current.applyOptions({ width: el.clientWidth })
      }
    })
    ro.observe(el)

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair)
      ro.disconnect()
      markersRef.current = null
      volumeRef.current = null
      seriesRef.current = null
      chart.remove()
      chartRef.current = null
    }
  }, [compact, live, isFastLive, chartHeight, plan.lastCandle])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || plan.activeCount === 0) return

    const vals =
      plan.mode === 'candles'
        ? plan.candleData.flatMap((d) => [d.open, d.high, d.low, d.close])
        : plan.lineData.map((d) => d.value)
    const priceFormat = priceFormatForValues(vals)

    if (volumeRef.current) {
      chart.removeSeries(volumeRef.current)
      volumeRef.current = null
    }

    if (seriesRef.current && modeRef.current !== plan.mode) {
      chart.removeSeries(seriesRef.current)
      seriesRef.current = null
      markersRef.current = null
    }

    if (!seriesRef.current) {
      if (plan.mode === 'candles') {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: TV.up,
          downColor: TV.down,
          borderVisible: true,
          borderUpColor: TV.upBorder,
          borderDownColor: TV.downBorder,
          wickVisible: true,
          wickUpColor: TV.up,
          wickDownColor: TV.down,
          priceFormat,
        })
        series.setData(plan.candleData)
        seriesRef.current = series

        if (isFastLive && plan.volumeData.length > 0) {
          const vol = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
          })
          chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.78, bottom: 0 },
            visible: false,
          })
          vol.setData(plan.volumeData)
          volumeRef.current = vol
        }
      } else {
        const series = chart.addSeries(LineSeries, {
          color: TV.line,
          lineWidth: 2,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          priceFormat,
        })
        series.setData(plan.lineData)
        seriesRef.current = series
      }
      modeRef.current = plan.mode
      markersRef.current = createSeriesMarkers(seriesRef.current, [])
    } else if (plan.mode === 'candles') {
      ;(seriesRef.current as ISeriesApi<'Candlestick'>).setData(plan.candleData)
      if (isFastLive && plan.volumeData.length > 0) {
        if (!volumeRef.current) {
          const vol = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
          })
          chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.78, bottom: 0 },
            visible: false,
          })
          vol.setData(plan.volumeData)
          volumeRef.current = vol
        } else {
          ;(volumeRef.current as ISeriesApi<'Histogram'>).setData(plan.volumeData)
        }
      }
    } else {
      ;(seriesRef.current as ISeriesApi<'Line'>).setData(plan.lineData)
    }

    if (!markersRef.current && seriesRef.current) {
      markersRef.current = createSeriesMarkers(seriesRef.current, chartMarkers)
    } else {
      markersRef.current?.setMarkers(chartMarkers)
    }

    const times = plan.active.map((d) => d.time as number)
    const markerSecs = chartMarkers.map((m) => m.time as number)
    const allTimes = markerSecs.length > 0 ? [...times, ...markerSecs] : times
    if (allTimes.length === 0) return

    const from = Math.min(...allTimes)
    const to = Math.max(...allTimes, ...markerSecs.map((t) => t + bucketSecs), ...times)
    const showSeconds = isFastLive || plan.spanSec < 3600

    chart.applyOptions({
      timeScale: {
        secondsVisible: showSeconds,
        timeVisible: true,
        barSpacing: isFastLive ? 6 : 8,
      },
    })

    const pad = Math.max(bucketSecs * 3, showSeconds ? 20 : 60)
    const windowSec = isFastLive ? TIER_A_LIVE_CHART_WINDOW_SECS : null
    const visibleFrom =
      windowSec != null && to - from > windowSec ? (to - windowSec) as UTCTimestamp : (from - pad) as UTCTimestamp

    chart.timeScale().setVisibleRange({
      from: visibleFrom,
      to: (to + pad) as UTCTimestamp,
    })
    if (live) {
      chart.timeScale().scrollToRealTime()
    }
  }, [plan, chartMarkers, live, bucketSecs, isFastLive])

  if (plan.activeCount === 0) {
    return (
      <div className="muted tvChartMuted" style={{ padding: 14 }}>
        {live
          ? `Waiting for tier_price — ${barLabel} candles appear after a few price ticks.`
          : 'Not enough price history yet — bars appear when tier_price writes token_prices.'}
      </div>
    )
  }

  const modeLabel =
    plan.mode === 'candles'
      ? `${barLabel} candles · ${plan.candleData.length} bars`
      : `${plan.lineData.length} points (line until ${minCandlesForOhlc}+ bars)`

  return (
    <div className={isFastLive ? 'tvChartPanel tvChartPanelFast' : 'tvChartPanel'}>
      <div className="tvChartHead">
        <div className="tvChartHeadLeft">
          <span className="tvChartBarBadge">{barLabel}</span>
          <span className="tvChartHeadPrice">{ohlcHead.price}</span>
          {ohlcHead.changePct != null ? (
            <span
              className={
                ohlcHead.changeUp === true
                  ? 'tvChartChg pos'
                  : ohlcHead.changeUp === false
                    ? 'tvChartChg neg'
                    : 'tvChartChg'
              }
            >
              {ohlcHead.changePct}
            </span>
          ) : null}
        </div>
        <div className="tvChartHeadRight">
          {ohlcHead.o != null ? (
            <span className="tvOhlcItem">
              <span className="tvOhlcK">O</span>
              <span className="tvOhlcV">{ohlcHead.o}</span>
            </span>
          ) : null}
          {ohlcHead.h != null ? (
            <span className="tvOhlcItem">
              <span className="tvOhlcK">H</span>
              <span className="tvOhlcV">{ohlcHead.h}</span>
            </span>
          ) : null}
          {ohlcHead.l != null ? (
            <span className="tvOhlcItem">
              <span className="tvOhlcK">L</span>
              <span className="tvOhlcV">{ohlcHead.l}</span>
            </span>
          ) : null}
          {ohlcHead.c != null ? (
            <span className="tvOhlcItem">
              <span className="tvOhlcK">C</span>
              <span className="tvOhlcV">{ohlcHead.c}</span>
            </span>
          ) : null}
          {ohlcHead.time ? <span className="tvChartHeadTime">{ohlcHead.time}</span> : null}
        </div>
      </div>

      <div className="tvChartMeta muted">
        {modeLabel}
        {live ? ` · refresh ${liveRefreshSecs}s` : ''}
        {promotionMarker ? ' · A circle below bar' : ''}
        {sMarkMarker ? ' · S square above bar' : ''}
      </div>

      <div
        ref={wrapRef}
        className={compact ? 'tvChartWrap tvChartWrapCompact' : 'tvChartWrap'}
        style={{ width: '100%', minHeight: chartHeight }}
      />
    </div>
  )
}
