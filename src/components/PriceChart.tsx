import { useId, useMemo, useRef, useState } from 'react'

export type PricePoint = { ts: string; price_usd: number }

const SVG_W = 1000
const SVG_H = 380
/** Plot margins (TradingView-like: price ladder right, times bottom). */
const M = { l: 4, r: 78, t: 18, b: 40 }

/** TradingView-style palette (approximate dark theme). */
const TV = {
  plotBg: '#131722',
  grid: 'rgba(42, 46, 57, 0.9)',
  border: '#2a2e39',
  text: '#b2b5be',
  textMuted: '#787b86',
  line: '#2962ff',
  cross: '#9598a1',
}

function formatUsd(v: number) {
  if (v >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  if (v >= 1e-4) return `$${v.toFixed(6)}`
  return `$${v.toPrecision(6)}`
}

function formatUsdShort(v: number) {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (v >= 1) return v.toPrecision(6)
  if (v >= 1e-4) return v.toFixed(8)
  return v.toPrecision(4)
}

function asPrice(p: PricePoint): number | null {
  const v = typeof p.price_usd === 'number' ? p.price_usd : Number(p.price_usd)
  return Number.isFinite(v) ? v : null
}

function buildNicePriceTicks(lo: number, hi: number, maxTicks = 6): number[] {
  if (!(hi > lo)) return [lo]
  const span = hi - lo
  const rough = span / Math.max(maxTicks - 1, 1)
  const pow10 = 10 ** Math.floor(Math.log10(rough))
  const err = rough / pow10
  const nice = pow10 * (err <= 1 ? 1 : err <= 2 ? 2 : err <= 5 ? 5 : 10)
  const start = Math.ceil(lo / nice) * nice
  const ticks: number[] = []
  for (let x = start; x <= hi + nice * 0.001; x += nice) {
    ticks.push(Number(x.toPrecision(12)))
    if (ticks.length > 24) break
  }
  if (ticks.length < 2) {
    return [lo, (lo + hi) / 2, hi].filter(Number.isFinite)
  }
  return ticks
}

function formatTimeAxis(ms: number, longSpan: boolean): string {
  const d = new Date(ms)
  if (longSpan) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Client pixel → svg user space (matches viewBox). */
function svgPointFromClient(svg: SVGSVGElement, cx: number, cy: number) {
  const rect = svg.getBoundingClientRect()
  const x = ((cx - rect.left) / rect.width) * SVG_W
  const y = ((cy - rect.top) / rect.height) * SVG_H
  return { x, y }
}

export default function PriceChart(props: {
  points: PricePoint[]
  compact?: boolean
  /** When set, X-axis spans this window (e.g. user picked 24h but token is newer). */
  rangeStartMs?: number | null
  rangeEndMs?: number | null
}) {
  const { points, compact, rangeStartMs, rangeEndMs } = props
  const areaGradId = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement>(null)

  type Snap = {
    vx: number
    vy: number
    ms: number
    price: string
    dateStr: string
    /** Viewport coords for floating tooltip */
    cx: number
    cy: number
  }
  const [snap, setSnap] = useState<Snap | null>(null)

  const layout = useMemo(() => {
    const px0 = M.l
    const px1 = SVG_W - M.r
    const py0 = M.t
    const py1 = SVG_H - M.b
    const innerW = px1 - px0
    const innerH = py1 - py0

    const sorted = [...points]
      .map((p) => ({ ...p, _t: Date.parse(p.ts), _v: asPrice(p) }))
      .filter((p) => !Number.isNaN(p._t) && p._v != null)
      .sort((a, b) => a._t - b._t)

    if (sorted.length < 2) {
      return {
        empty: true as const,
        plotPoints: [] as { ts: string; price_usd: number }[],
      }
    }

    const vals = sorted.map((s) => s._v!)
    const dataTMin = sorted[0]!._t
    const dataTMax = sorted[sorted.length - 1]!._t
    const windowStart =
      rangeStartMs != null && Number.isFinite(rangeStartMs) ? rangeStartMs : dataTMin
    const windowEnd =
      rangeEndMs != null && Number.isFinite(rangeEndMs) ? rangeEndMs : dataTMax
    const tMin = Math.min(windowStart, dataTMin)
    const tMax = Math.max(windowEnd, dataTMax, tMin + 60_000)

    let vMin = Math.min(...vals)
    let vMax = Math.max(...vals)
    if (!(vMax > vMin)) {
      const mid = vMin
      const eps = Math.max(Math.abs(mid) * 0.06, mid === 0 ? 1e-12 : 0)
      vMin = mid - eps
      vMax = mid + eps
    } else {
      const pad = (vMax - vMin) * 0.06
      vMin -= pad
      vMax += pad
    }

    const xForMs = (ms: number) => {
      const span = Math.max(tMax - tMin, 1)
      return px0 + ((ms - tMin) / span) * innerW
    }

    const yForVal = (v: number) => {
      const span = Math.max(vMax - vMin, Number.EPSILON)
      return py0 + ((vMax - v) / span) * innerH
    }

    const nodes = sorted.map((s, i) => ({
      ts: s.ts,
      ms: s._t,
      val: vals[i]!,
      x: xForMs(s._t),
      y: yForVal(vals[i]!),
    }))

    const plotPoints = nodes.map((n) => ({ ts: n.ts, price_usd: n.val }))

    let lineD = `M ${nodes[0]!.x} ${nodes[0]!.y}`
    for (let i = 1; i < nodes.length; i++) {
      lineD += ` L ${nodes[i]!.x} ${nodes[i]!.y}`
    }

    const last = nodes[nodes.length - 1]!
    const bottomY = py1
    const areaD = `${lineD} L ${last.x} ${bottomY} L ${nodes[0]!.x} ${bottomY} Z`

    let priceTicks = buildNicePriceTicks(vMin, vMax, 6)
    priceTicks = priceTicks.filter((v) => v >= vMin - 1e-12 && v <= vMax + 1e-12)
    if (priceTicks.length < 2) {
      priceTicks = [vMin, (vMin + vMax) / 2, vMax]
    }

    const longSpan = tMax - tMin > 36 * 60 * 60 * 1000
    const xTickCount = Math.min(6, Math.max(2, nodes.length >= 48 ? 6 : 4))
    const xTicks: { x: number; ms: number; label: string }[] = []
    for (let i = 0; i < xTickCount; i++) {
      const idx = Math.round(((nodes.length - 1) * i) / Math.max(xTickCount - 1, 1))
      const n = nodes[Math.min(idx, nodes.length - 1)]!
      xTicks.push({ x: n.x, ms: n.ms, label: formatTimeAxis(n.ms, longSpan) })
    }

    return {
      empty: false as const,
      px0,
      px1,
      py0,
      py1,
      innerW,
      innerH,
      plotPoints,
      lineD,
      areaD,
      nodes,
      tMin,
      tMax,
      vMin,
      vMax,
      priceTicks,
      xTicks,
      xForMs,
      yForVal,
      lastPrice: formatUsd(last.val),
    }
  }, [points, rangeStartMs, rangeEndMs])

  if ('empty' in layout && layout.empty) {
    return <div className="muted tvChartMuted">Not enough price points yet.</div>
  }
  const L = layout as Exclude<typeof layout, { empty: true }>

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || L.nodes.length < 2) return
    const { x, y } = svgPointFromClient(svg, e.clientX, e.clientY)
    if (x < L.px0 || x > L.px1 || y < L.py0 || y > L.py1) {
      setSnap(null)
      return
    }

    const span = Math.max(L.tMax - L.tMin, 1)
    const tHover = L.tMin + ((x - L.px0) / L.innerW) * span

    for (let i = 1; i < L.nodes.length; i++) {
      const a = L.nodes[i - 1]!
      const b = L.nodes[i]!
      if (tHover <= b.ms) {
        const dt = Math.max(b.ms - a.ms, 1)
        const frac = Math.min(Math.max((tHover - a.ms) / dt, 0), 1)
        const interp = a.val + (b.val - a.val) * frac
        const vy = L.yForVal(interp)
        const ms = Math.round(a.ms + (b.ms - a.ms) * frac)
        setSnap({
          vx: x,
          vy,
          ms,
          price: formatUsd(interp),
          dateStr: formatTimeAxis(ms, L.tMax - L.tMin > 36 * 60 * 60 * 1000),
          cx: e.clientX,
          cy: e.clientY,
        })
        return
      }
    }

    const end = L.nodes[L.nodes.length - 1]!
    setSnap({
      vx: x,
      vy: end.y,
      ms: end.ms,
      price: formatUsd(end.val),
      dateStr: formatTimeAxis(end.ms, L.tMax - L.tMin > 36 * 60 * 60 * 1000),
      cx: e.clientX,
      cy: e.clientY,
    })
  }

  return (
    <div className={compact ? 'tvChartWrap tvChartWrapCompact' : 'tvChartWrap'}>
      <div className="tvLegend">
        <div className="tvLegendLab">Price USD</div>
        <div className="tvLegendVal">{L.lastPrice}</div>
      </div>

      {snap ? (
        <div
          className="tvTooltipFixed"
          style={{
            left: Math.max(
              10,
              Math.min(
                snap.cx + 16,
                (typeof window !== 'undefined' ? window.innerWidth : 2000) - 146,
              ),
            ),
            top: Math.max(
              10,
              Math.min(
                snap.cy - 76,
                (typeof window !== 'undefined' ? window.innerHeight : 1200) - 82,
              ),
            ),
          }}
        >
          <div className="tvTooltipPrice">{snap.price}</div>
          <div className="tvTooltipTime">{snap.dateStr}</div>
        </div>
      ) : null}

      <svg
        ref={svgRef}
        className="tvSvg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={compact ? undefined : SVG_H}
        preserveAspectRatio="xMidYMid meet"
        style={
          compact
            ? { height: 'auto', maxHeight: 'min(240px, 38vh)', display: 'block' }
            : undefined
        }
        onMouseLeave={() => setSnap(null)}
        onMouseMove={onMove}
        role="img"
        aria-label="Price chart"
      >
        <defs>
          <linearGradient
            id={areaGradId}
            gradientUnits="userSpaceOnUse"
            x1={L.px0}
            y1={L.py0}
            x2={L.px0}
            y2={L.py1}
          >
            <stop offset="0%" stopColor="rgba(41, 98, 255, 0.38)" />
            <stop offset="100%" stopColor="rgba(41, 98, 255, 0)" />
          </linearGradient>
        </defs>

        {/* Plot background */}
        <rect x={L.px0} y={L.py0} width={L.innerW} height={L.innerH} fill={TV.plotBg} />

        {/* Horizontal grid */}
        {L.priceTicks.map((tv) => {
          const gy = L.yForVal(tv)
          if (gy < L.py0 || gy > L.py1) return null
          return (
            <line
              key={`h-${tv}`}
              x1={L.px0}
              y1={gy}
              x2={L.px1}
              y2={gy}
              stroke={TV.grid}
              strokeWidth={1}
            />
          )
        })}

        {/* Vertical grid */}
        {L.xTicks.map((xt, idx) => (
          <line
            key={`v-${idx}`}
            x1={xt.x}
            y1={L.py0}
            x2={xt.x}
            y2={L.py1}
            stroke={TV.grid}
            strokeWidth={1}
          />
        ))}

        <rect x={L.px0} y={L.py0} width={L.innerW} height={L.innerH} stroke={TV.border} fill="none" strokeWidth={1} />

        <path d={L.areaD} fill={`url(#${areaGradId})`} />
        <path
          d={L.lineD}
          fill="none"
          stroke={TV.line}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Crosshair */}
        {snap ? (
          <g stroke={TV.cross} opacity={0.85}>
            <line x1={snap.vx} y1={L.py0} x2={snap.vx} y2={L.py1} strokeWidth={1} />
            <line x1={L.px0} y1={snap.vy} x2={L.px1} y2={snap.vy} strokeWidth={1} />
            <circle cx={snap.vx} cy={snap.vy} r={4} fill={TV.line} stroke="#fff" strokeWidth={1} />
          </g>
        ) : null}

        {/* Right price scale */}
        {L.priceTicks.map((tv) => {
          const gy = L.yForVal(tv)
          if (gy < L.py0 - 2 || gy > L.py1 + 2) return null
          return (
            <text
              key={`pl-${tv}`}
              x={L.px1 + 10}
              y={gy}
              dominantBaseline="middle"
              fill={TV.text}
              fontSize={12}
              fontFamily="Roboto, Helvetica, Arial, sans-serif"
            >
              {formatUsdShort(tv)}
            </text>
          )
        })}

        {/* Bottom time axis */}
        {L.xTicks.map((xt, idx) => (
          <text
            key={`tx-${idx}`}
            x={xt.x}
            y={SVG_H - 12}
            textAnchor="middle"
            fill={TV.textMuted}
            fontSize={11}
            fontFamily="Roboto, Helvetica, Arial, sans-serif"
          >
            {xt.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
