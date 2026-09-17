'use client'

import { useMemo, useRef, useState } from 'react'

export interface ChartPoint {
  x: number
  y: number
}

export interface ChartSeries {
  id: string
  label: string
  color: string
  points: ChartPoint[]
}

interface LineChartProps {
  series: ChartSeries[]
  formatX: (value: number) => string
  formatY: (value: number) => string
  /** Axis caption, e.g. "bytes". Kept out of the tick labels to reduce ink. */
  yCaption?: string
  emptyMessage?: string
}

const VIEW_W = 640
const VIEW_H = 220
const PAD = { top: 14, right: 18, bottom: 30, left: 56 }

const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom

/** Axis ticks land on clean numbers, never on the raw data extremes. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude

  const ticks: number[] = []
  for (let value = Math.floor(min / step) * step; value <= max + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(6)))
  }
  return ticks
}

export function LineChart({
  series,
  formatX,
  formatY,
  yCaption,
  emptyMessage = 'No samples yet.',
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)

  const model = useMemo(() => {
    const all = series.flatMap((entry) => entry.points)
    if (all.length < 2) return null

    const xs = all.map((point) => point.x)
    const ys = all.map((point) => point.y)

    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    const yMin = 0 // every measure here is a magnitude, so the baseline is zero
    const yMax = Math.max(...ys) || 1

    const yTicks = niceTicks(yMin, yMax)
    const yTop = Math.max(yMax, yTicks[yTicks.length - 1] ?? yMax)

    const scaleX = (value: number) =>
      PAD.left + (xMax === xMin ? PLOT_W / 2 : ((value - xMin) / (xMax - xMin)) * PLOT_W)
    const scaleY = (value: number) => PAD.top + PLOT_H - (value / yTop) * PLOT_H

    return { xMin, xMax, yTop, yTicks, scaleX, scaleY }
  }, [series])

  if (!model) {
    return <div className="chart-empty">{emptyMessage}</div>
  }

  const { xMin, xMax, yTicks, scaleX, scaleY } = model

  const paths = series.map((entry) => {
    const sorted = entry.points.slice().sort((a, b) => a.x - b.x)
    const d = sorted
      .map((point, index) => {
        const command = index === 0 ? 'M' : 'L'
        return `${command}${scaleX(point.x).toFixed(2)},${scaleY(point.y).toFixed(2)}`
      })
      .join(' ')
    return { entry, d, last: sorted[sorted.length - 1] }
  })

  const hovered =
    hoverX === null
      ? null
      : series
          .map((entry) => {
            let nearest: ChartPoint | null = null
            let bestDistance = Infinity
            for (const point of entry.points) {
              const distance = Math.abs(point.x - hoverX)
              if (distance < bestDistance) {
                bestDistance = distance
                nearest = point
              }
            }
            return nearest ? { entry, point: nearest } : null
          })
          .filter((item): item is { entry: ChartSeries; point: ChartPoint } => item !== null)

  const hoverAnchor = hovered?.[0]?.point ?? null

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    // The SVG scales to its container, so pointer pixels have to be mapped back
    // into viewBox units before they mean anything.
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW_W
    const ratio = (viewX - PAD.left) / PLOT_W
    if (ratio < -0.02 || ratio > 1.02) {
      setHoverX(null)
      return
    }
    setHoverX(xMin + Math.min(1, Math.max(0, ratio)) * (xMax - xMin))
  }

  const tooltipLeft = hoverAnchor
    ? `${((scaleX(hoverAnchor.x) / VIEW_W) * 100).toFixed(2)}%`
    : '0%'

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Line chart${yCaption ? ` of ${yCaption}` : ''}`}
        // Sizing lives in CSS, not in the width/height attributes: an SVG
        // attribute only accepts a length, so "auto" there is invalid markup.
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverX(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={scaleY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--ink-muted)"
              fontSize={11}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatY(tick)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
        />

        <text
          x={PAD.left}
          y={VIEW_H - 8}
          fill="var(--ink-muted)"
          fontSize={11}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatX(xMin)}
        </text>
        <text
          x={PAD.left + PLOT_W}
          y={VIEW_H - 8}
          textAnchor="end"
          fill="var(--ink-muted)"
          fontSize={11}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatX(xMax)}
        </text>

        {hoverAnchor && (
          <line
            x1={scaleX(hoverAnchor.x)}
            x2={scaleX(hoverAnchor.x)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--line-strong)"
            strokeWidth={1}
          />
        )}

        {paths.map(({ entry, d, last }) => (
          <g key={entry.id}>
            <path
              d={d}
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {last && (
              <circle
                cx={scaleX(last.x)}
                cy={scaleY(last.y)}
                r={4}
                fill={entry.color}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            )}
          </g>
        ))}

        {hovered?.map(({ entry, point }) => (
          <circle
            key={`hover-${entry.id}`}
            cx={scaleX(point.x)}
            cy={scaleY(point.y)}
            r={4}
            fill={entry.color}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}
      </svg>

      {hovered && hoverAnchor && (
        <div
          className="tooltip"
          style={{
            left: tooltipLeft,
            top: 46,
            transform:
              scaleX(hoverAnchor.x) > VIEW_W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <div className="tooltip__title">{formatX(hoverAnchor.x)}</div>
          {hovered.map(({ entry, point }) => (
            <div className="tooltip__row" key={`tip-${entry.id}`}>
              <span
                className="legend__key"
                style={{ background: entry.color, height: 2 }}
                aria-hidden
              />
              <span>{entry.label}</span>
              <strong>{formatY(point.y)}</strong>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null
  return (
    <div className="legend">
      {series.map((entry) => (
        <span className="legend__item" key={entry.id}>
          <span className="legend__key" style={{ background: entry.color }} aria-hidden />
          {entry.label}
        </span>
      ))}
    </div>
  )
}
