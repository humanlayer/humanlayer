import type { ReactNode } from "react"
import {
  CartesianGrid,
  Cell,
  DefaultZIndexes,
  ReferenceLine,
  Scatter,
  ScatterChart as RechartsScatterChart,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZAxis,
  ZIndexLayer
} from "recharts"
import { ChartTooltip, ChartContainer } from "../chart"
import type { ChartConfig } from "../chart"
import { cn } from "@humanlayer/ui/lib/utils"

export interface ScatterDataPoint {
  x: number
  y: number
  label: string
  /** Stable identity for highlight matching (`highlightedId`); falls back to `label`. */
  id?: string
  [key: string]: unknown
}

/**
 * An outlier point the chart pins at a domain edge as a triangle; the tooltip
 * reports the real `y`. `edge` says which side the point's SELECTION rule
 * (e.g. an outlier fence) put it on — callers should set it, because the
 * point's real y is not always outside the plotted domain (a rounded-up
 * domain top can sit above a fence), so inferring the side from `yDomain`
 * alone can pin a high outlier at the bottom.
 */
export type ScatterEdgeMarker = ScatterDataPoint & { edge?: 'top' | 'bottom' }

export interface ScatterTrendLine {
  slope: number
  intercept: number
  label?: string
}

type TrendSegment = readonly [{ x: number; y: number }, { x: number; y: number }]

/**
 * Computes the two segments needed to render a trend line fit (y = slope * x
 * + intercept) over the plotted points:
 *
 * - `line`: the drawn segment. Its endpoints deliberately overshoot the data
 *   on both sides so that, clipped to the plot area (`ifOverflow="hidden"`),
 *   the line always spans the full chart width — the axis domains extend
 *   beyond the data (recharts "nice" ticks start numeric axes at 0 and round
 *   the max up), so segment endpoints at the data extremes leave gaps.
 * - `labelAnchor`: an invisible segment across the data's x-range with y
 *   clamped into the data's y-range, used only to position the label. Without
 *   it the label would anchor to the overshot (clipped-away) endpoints and
 *   float outside the visible chart.
 */
function computeTrendSegments(
  trendLine: ScatterTrendLine,
  data: ScatterDataPoint[]
): { line: TrendSegment; labelAnchor: TrendSegment } | null {
  if (data.length === 0) return null

  const xs = data.map((point) => point.x)
  const ys = data.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const yAt = (x: number) => trendLine.slope * x + trendLine.intercept

  // The default numeric domain is [0, niceCeil(dataMax)]; overshooting by a
  // couple of domain-widths comfortably covers it, and clipping trims the
  // excess exactly at the plot edges.
  const overshoot = 2 * Math.max(maxX - minX, Math.abs(maxX), Math.abs(minX), 1)
  const lineStartX = Math.min(minX, 0) - overshoot
  const lineEndX = maxX + overshoot

  const clampY = (y: number) => Math.min(Math.max(y, Math.min(minY, 0)), maxY)

  return {
    line: [
      { x: lineStartX, y: yAt(lineStartX) },
      { x: lineEndX, y: yAt(lineEndX) }
    ],
    labelAnchor: [
      { x: minX, y: clampY(yAt(minX)) },
      { x: maxX, y: clampY(yAt(maxX)) }
    ]
  }
}

interface ScatterChartProps {
  data: ScatterDataPoint[]
  config: ChartConfig
  showGrid?: boolean
  className?: string
  allowDecimals?: boolean
  /**
   * Key used to look up the point color from `config` (`--color-{seriesKey}`).
   */
  seriesKey?: string
  xLabel?: string
  yLabel?: string
  xFormatter?: (value: number) => string
  yFormatter?: (value: number) => string
  /**
   * Axis-tick-only formatters. Default to `xFormatter`/`yFormatter`; pass
   * these when ticks should be terser than the tooltip (e.g. "$1.5K" ticks,
   * "$1,532.18" tooltip).
   */
  xTickFormatter?: (value: number) => string
  yTickFormatter?: (value: number) => string
  /**
   * Point field mapped to symbol area (bubble size) via a ZAxis, so a third
   * variable can ride each dot. Missing/equal values render at `sizeRange`
   * minimum.
   */
  sizeKey?: string
  /** Symbol-area range (px²) used with `sizeKey`. */
  sizeRange?: [number, number]
  /**
   * Per-point fill override (e.g. muted gray for a zero-usage baseline
   * group); return undefined to keep the series color.
   */
  pointFill?: (point: ScatterDataPoint) => string | undefined
  /**
   * Explicit y-axis domain. Required for signed data (recharts' default
   * numeric domain starts at 0) and for clamped views paired with
   * `edgeMarkers`.
   */
  yDomain?: [number, number]
  /** Dashed rule at y = 0 for signed axes (net values). */
  showZeroLine?: boolean
  /**
   * Outlier points whose y falls outside `yDomain`. Each renders as a
   * triangle pinned at the crossed edge (pointing past it), keeping extreme
   * values visible without letting them stretch the axis; tooltips report
   * the real value. Ignored without `yDomain`.
   */
  edgeMarkers?: ScatterEdgeMarker[]
  /**
   * Render additional lines in the tooltip below the label/x/y rows, using
   * any extra fields passed through on the data point.
   */
  tooltipExtra?: (point: ScatterDataPoint) => ReactNode
  /**
   * Optional trend line fit (y = slope * x + intercept) drawn across the full
   * chart width (e.g. a Theil-Sen median line through the scatter).
   */
  trendLine?: ScatterTrendLine
  /**
   * Render `xLabel`/`yLabel` as axis titles (below the x ticks, rotated left
   * of the y ticks) in addition to their tooltip role.
   */
  showAxisTitles?: boolean
  /**
   * Direct-label each point with its `label`. Labels auto-hide once the chart
   * holds more than {@link MAX_POINT_LABELS} points — past that they collide
   * more than they inform, and identity falls back to the hover tooltip.
   */
  showPointLabels?: boolean
  /**
   * When set, the matching point (`id`, falling back to `label`) renders at
   * full opacity and every other point dims, so one entity can be followed
   * across sibling charts.
   */
  highlightedId?: string | null
  onPointClick?: (point: ScatterDataPoint) => void
  margin?: {
    left?: number
    right?: number
    top?: number
    bottom?: number
  }
  style?: React.CSSProperties
}

const MAX_POINT_LABELS = 16

const pointKey = (point: ScatterDataPoint) => point.id ?? point.label

/**
 * Custom recharts shape for edge markers: a triangle pointing past the edge
 * it crossed (up at the top of the domain, down at the bottom), with its body
 * inside the plot so pinning at the exact domain edge stays fully visible.
 */
const EDGE_TRIANGLE_HALF = 6

function EdgeTriangle(props: unknown) {
  const { cx, cy, fill, payload, clampedTo } = props as {
    cx?: number
    cy?: number
    fill?: string
    payload?: ScatterDataPoint
    clampedTo?: string
  }
  if (cx == null || cy == null) return <g />
  // Recharts spreads the datum onto the shape props AND nests it as payload,
  // depending on version — read whichever carries the flag.
  const up = (payload?.clampedTo ?? clampedTo) !== "bottom"
  const half = EDGE_TRIANGLE_HALF
  const d = up
    ? `M ${cx} ${cy} L ${cx + half} ${cy + 2 * half} L ${cx - half} ${cy + 2 * half} Z`
    : `M ${cx} ${cy} L ${cx + half} ${cy - 2 * half} L ${cx - half} ${cy - 2 * half} Z`
  return <path d={d} fill={fill} stroke="var(--color-card)" strokeWidth={1} />
}

const POINT_LABEL_FONT_SIZE = 11
/** Mono glyph advance at 11px, rounded up — measurement, not styling. */
const POINT_LABEL_CHAR_WIDTH = 6.8
const POINT_LABEL_MAX_CHARS = 18
/** Gap between a label's text box and the dot edge / a neighbouring label. */
const POINT_LABEL_GAP = 4
/** Descent allowance under the baseline at 11px. */
const POINT_LABEL_DESCENT = 3
/**
 * Below this plot width even a few point names cannot be kept apart, so
 * labels are skipped entirely and the tooltip carries identity — a label that
 * cannot be placed is dropped, not smeared over its neighbours. ~two
 * truncated mono labels side by side.
 */
const POINT_LABEL_MIN_PLOT_WIDTH = 300
/** recharts' fixed symbol area (px²) when no ZAxis rides the chart. */
const DEFAULT_SYMBOL_AREA = 64

interface LabelRect {
  left: number
  right: number
  top: number
  bottom: number
}

const rectsIntersect = (a: LabelRect, b: LabelRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** Candidate slots per label, in preference order: near rows first. */
const POINT_LABEL_SLOTS: ReadonlyArray<{ above: boolean; row: number }> = [
  { above: true, row: 0 },
  { above: false, row: 0 },
  { above: true, row: 1 },
  { above: false, row: 1 }
]

/**
 * Direct labels for every scatter point, laid out in one pass with real
 * collision resolution — in the spirit of EdgeTriangle: a label that would
 * not fit is moved, and one that cannot be placed at all is dropped (the
 * hover tooltip still carries identity), never clipped or overprinted.
 *
 * Placement, per label in data order: centered on the dot, clamped so the
 * measured text stays inside the plot area (a dot at x=0 no longer bleeds
 * its name into the y-axis ticks), then the first of four slots — above the
 * dot, below it, or one row further out on either side — whose text box
 * clears the plot edges, every DOT (at its actual bubble radius, from the
 * same area scale the ZAxis uses), and every already-placed label.
 *
 * Ink is --color-foreground, not muted: 11px text on the dark card surface
 * needs it to clear the 4.5:1 small-text contrast floor (muted is 3.4:1).
 * The fill rides the STYLE, not the svg attribute — WebKit does not resolve
 * var() inside presentation attributes and falls back to black.
 */
function PointLabelsLayer({
  data,
  sizeKey,
  sizeRange,
  edgeMarkers
}: {
  data: ScatterDataPoint[]
  sizeKey?: string
  sizeRange: [number, number]
  edgeMarkers?: Array<ScatterDataPoint & { clampedTo?: "top" | "bottom" }>
}) {
  const plot = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  if (!plot || !xScale || !yScale) return null
  if (plot.width < POINT_LABEL_MIN_PLOT_WIDTH) return null

  // The z domain must aggregate BOTH scatters on the axis — the edge-marker
  // series carries the sizeKey fields too, and an outlier holding the
  // dataMin/dataMax changes every visible dot's rendered size.
  const zSources = edgeMarkers ? [...data, ...edgeMarkers] : data
  const zValues = sizeKey ? zSources.map((point) => Number(point[sizeKey])).filter(Number.isFinite) : []
  const zMin = zValues.length > 0 ? Math.min(...zValues) : 0
  const zMax = zValues.length > 0 ? Math.max(...zValues) : 0
  // Mirrors the ZAxis size scale (domain ["dataMin","dataMax"], range in
  // symbol AREA) so each obstacle rect hugs its dot's real rendered radius.
  const radiusFor = (point: ScatterDataPoint) => {
    let area = DEFAULT_SYMBOL_AREA
    if (sizeKey && zValues.length > 0) {
      const z = Number(point[sizeKey])
      if (!z || !Number.isFinite(z)) {
        // recharts renders falsy/missing z at the range minimum (`z || '-'`).
        area = sizeRange[0]
      } else {
        // d3 maps a degenerate (min === max) domain to the range MIDPOINT,
        // not the minimum — all-equal z values render mid-sized bubbles.
        const t = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0.5
        area = sizeRange[0] + t * (sizeRange[1] - sizeRange[0])
      }
    }
    // +2 for the surface-colored ring stroke around each dot.
    return Math.sqrt(area / Math.PI) + 2
  }

  const points = data.flatMap((point, index) => {
    const cx = xScale(point.x)
    const cy = yScale(point.y)
    if (cx == null || cy == null) return []
    return [{ point, index, cx, cy, r: radiusFor(point) }]
  })

  const dotRects: LabelRect[] = points.map(({ cx, cy, r }) => ({
    left: cx - r,
    right: cx + r,
    top: cy - r,
    bottom: cy + r
  }))
  // Pinned edge-marker triangles are obstacles too — they hug the exact
  // plot edges where top/bottom-edge labels get pushed.
  const triangleRects: LabelRect[] = (edgeMarkers ?? []).flatMap((marker) => {
    const cx = xScale(marker.x)
    const cy = yScale(marker.y)
    if (cx == null || cy == null) return []
    const up = marker.clampedTo !== "bottom"
    return [
      {
        left: cx - EDGE_TRIANGLE_HALF,
        right: cx + EDGE_TRIANGLE_HALF,
        top: up ? cy : cy - 2 * EDGE_TRIANGLE_HALF,
        bottom: up ? cy + 2 * EDGE_TRIANGLE_HALF : cy
      }
    ]
  })
  const obstacles = dotRects.concat(triangleRects)
  const placedRects: LabelRect[] = []
  // A row must clear the full text box (ascent + descent) plus breathing
  // room, or the row-1 slot always collides with a row-0 label at the same x.
  const rowStep = POINT_LABEL_FONT_SIZE + POINT_LABEL_DESCENT + 2

  const labels = points.flatMap(({ point, index, cx, cy, r }) => {
    const full = point.label
    if (full.length === 0) return []
    const text = full.length > POINT_LABEL_MAX_CHARS ? `${full.slice(0, POINT_LABEL_MAX_CHARS - 1)}…` : full
    const halfWidth = (text.length * POINT_LABEL_CHAR_WIDTH) / 2
    const x = Math.min(Math.max(cx, plot.x + halfWidth), plot.x + plot.width - halfWidth)

    for (const slot of POINT_LABEL_SLOTS) {
      const baseline = slot.above
        ? cy - r - POINT_LABEL_GAP - POINT_LABEL_DESCENT - slot.row * rowStep
        : cy + r + POINT_LABEL_GAP + POINT_LABEL_FONT_SIZE + slot.row * rowStep
      const rect: LabelRect = {
        left: x - halfWidth - POINT_LABEL_GAP / 2,
        right: x + halfWidth + POINT_LABEL_GAP / 2,
        top: baseline - POINT_LABEL_FONT_SIZE,
        bottom: baseline + POINT_LABEL_DESCENT
      }
      if (rect.top < plot.y || rect.bottom > plot.y + plot.height) continue
      if (obstacles.some((obstacle) => rectsIntersect(rect, obstacle))) continue
      if (placedRects.some((other) => rectsIntersect(rect, other))) continue
      placedRects.push(rect)
      return [{ key: `${pointKey(point)}-${index}`, x, y: baseline, text }]
    }
    return []
  })

  return (
    // Child order alone would still paint labels UNDER the dots and trend
    // line: recharts ≥3.4 renders Scatter (z 600) and ReferenceLine (z 400)
    // through z-index portals appended after the default layer. The label
    // portal (z 2000) is where the removed LabelList used to render.
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      {/* Labels are annotations: hover/tooltip hits stay on the dots. */}
      <g pointerEvents="none">
        {labels.map((label) => (
          <text
            key={label.key}
            x={label.x}
            y={label.y}
            textAnchor="middle"
            style={{ fill: "var(--color-foreground)" }}
            fontSize={POINT_LABEL_FONT_SIZE}
          >
            {label.text}
          </text>
        ))}
      </g>
    </ZIndexLayer>
  )
}

function ScatterTooltipContent({
  point,
  xLabel,
  yLabel,
  xFormatter,
  yFormatter,
  tooltipExtra
}: {
  point: ScatterDataPoint
  xLabel: string
  yLabel: string
  xFormatter: (value: number) => string
  yFormatter: (value: number) => string
  tooltipExtra?: (point: ScatterDataPoint) => ReactNode
}) {
  return (
    <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{point.label}</div>
      <div className="grid gap-1.5">
        <div className="flex w-full items-center justify-between gap-4">
          <span className="text-muted-foreground">{xLabel}</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{xFormatter(point.x)}</span>
        </div>
        <div className="flex w-full items-center justify-between gap-4">
          <span className="text-muted-foreground">{yLabel}</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {/* Edge markers plot pinned at the domain edge; report their real y. */}
            {yFormatter(typeof point.trueY === "number" ? point.trueY : point.y)}
          </span>
        </div>
      </div>
      {tooltipExtra ? <div className="grid gap-1.5">{tooltipExtra(point)}</div> : null}
    </div>
  )
}

export function ScatterChart({
  data,
  config,
  showGrid = true,
  className,
  allowDecimals = true,
  seriesKey = "points",
  xLabel = "x",
  yLabel = "y",
  xFormatter = (value) => value.toLocaleString(),
  yFormatter = (value) => value.toLocaleString(),
  xTickFormatter,
  yTickFormatter,
  sizeKey,
  sizeRange = [48, 360],
  pointFill,
  yDomain,
  showZeroLine = false,
  edgeMarkers,
  tooltipExtra,
  trendLine,
  showAxisTitles = false,
  showPointLabels = false,
  highlightedId,
  onPointClick,
  margin,
  style
}: ScatterChartProps) {
  const defaultMargin = {
    left: 12,
    // Labels clamp inside the plot either way; extra right margin just means
    // a max-x dot's name shifts less far off-center.
    right: showPointLabels ? 32 : 12,
    top: 20,
    // The x-axis title renders below the tick labels, so it needs extra room.
    bottom: showAxisTitles ? 36 : 20
  }
  const chartMargin = margin ? { ...defaultMargin, ...margin } : defaultMargin
  const trendSegments = trendLine ? computeTrendSegments(trendLine, data) : null
  const renderPointLabels = showPointLabels && data.length <= MAX_POINT_LABELS
  // Per-point Cells are needed for either the highlight dimming or a fill
  // override; without them the series-level fill covers every point.
  const renderCells = highlightedId != null || pointFill != null

  // Pin each marker at its crossed edge; the real value rides along as
  // `trueY` for the tooltip. The caller's `edge` wins — the domain comparison
  // is only a fallback, since a fence-selected outlier can sit INSIDE the
  // rounded plot domain (see ScatterEdgeMarker).
  const pinnedMarkers =
    yDomain && edgeMarkers && edgeMarkers.length > 0
      ? edgeMarkers.map((point) => {
          const edge = point.edge ?? (point.y > yDomain[1] ? "top" : "bottom")
          return {
            ...point,
            y: edge === "top" ? yDomain[1] : yDomain[0],
            trueY: point.y,
            clampedTo: edge
          }
        })
      : null

  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')} style={style}>
      <RechartsScatterChart margin={chartMargin}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" />}

        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tickFormatter={xTickFormatter ?? xFormatter}
          allowDecimals={allowDecimals}
          label={
            showAxisTitles
              ? {
                  value: xLabel,
                  position: "bottom",
                  offset: 24,
                  // style, not the fill prop: recharts forwards `fill` as an
                  // svg attribute, and WebKit does not resolve var() there —
                  // the title renders black in the native webview / Safari.
                  style: { fill: "var(--color-muted-foreground)" },
                  fontSize: 12
                }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          tickLine={false}
          axisLine={false}
          tickFormatter={yTickFormatter ?? yFormatter}
          allowDecimals={allowDecimals}
          domain={yDomain}
          width={showAxisTitles ? 76 : undefined}
          label={
            showAxisTitles
              ? {
                  value: yLabel,
                  angle: -90,
                  position: "insideLeft",
                  // fill lives in style for WebKit — see the x-axis label.
                  style: { textAnchor: "middle", fill: "var(--color-muted-foreground)" },
                  fontSize: 12
                }
              : undefined
          }
        />

        {/* domain=[dataMin, dataMax] normalizes the size scale to the
            DATASET: the smallest observed value always gets the smallest
            bubble and the largest the biggest, so the full sizeRange is used
            whatever variable rides the dots (recharts' default [0, auto]
            domain compresses variables whose minimum sits far from zero —
            commit counts of 40..120 would only ever use the top third). */}
        {sizeKey ? (
          <ZAxis type="number" dataKey={sizeKey} range={sizeRange} domain={["dataMin", "dataMax"]} />
        ) : null}

        {showZeroLine ? (
          <ReferenceLine
            y={0}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
        ) : null}

        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as ScatterDataPoint | undefined
            if (!active || !point) return null

            return (
              <ScatterTooltipContent
                point={point}
                xLabel={xLabel}
                yLabel={yLabel}
                xFormatter={xFormatter}
                yFormatter={yFormatter}
                tooltipExtra={tooltipExtra}
              />
            )
          }}
        />

        {trendLine && trendSegments ? (
          <ReferenceLine
            segment={trendSegments.line}
            ifOverflow="hidden"
            stroke={`var(--color-${seriesKey})`}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        ) : null}
        {trendLine?.label && trendSegments ? (
          // Invisible companion line whose only job is to place the label:
          // recharts positions inside-corner labels using the segment's pixel
          // bounding box, not the line geometry, so the label must anchor to a
          // segment bounded by the data (not the overshot drawn line). The
          // box's corners only sit on the line at its endpoints — the label
          // goes on the right-end corner (top-right for an upward trend,
          // bottom-right for a downward one) because scatter density usually
          // clusters at low x, so the right end is emptier.
          <ReferenceLine
            segment={trendSegments.labelAnchor}
            stroke="none"
            label={{
              value: trendLine.label,
              position: trendLine.slope >= 0 ? "insideTopRight" : "insideBottomRight",
              // Foreground, not muted: 12px annotation text on the card surface
              // fails the 4.5:1 small-text contrast floor in muted ink. In
              // style for WebKit — see the x-axis label.
              style: { fill: "var(--color-foreground)" },
              fontSize: 12
            }}
          />
        ) : null}

        <Scatter
          data={data}
          dataKey="y"
          fill={`var(--color-${seriesKey})`}
          // Surface-colored ring so overlapping points stay countable.
          stroke="var(--color-card)"
          strokeWidth={2}
          // Recharts replays the mount animation whenever the data array
          // identity changes (background refetches re-render the parent), and
          // PointLabelsLayer draws labels at final scale positions immediately
          // — animating dots would drift under fixed labels. A scatter gains
          // nothing from the animation, so drop it.
          isAnimationActive={false}
          className={onPointClick ? "cursor-pointer" : undefined}
          onClick={
            onPointClick
              ? (entry) => {
                  const point = (entry as { payload?: ScatterDataPoint }).payload
                  if (point) onPointClick(point)
                }
              : undefined
          }
        >
          {renderCells
            ? data.map((point) => (
                <Cell
                  key={pointKey(point)}
                  fill={pointFill?.(point) ?? `var(--color-${seriesKey})`}
                  fillOpacity={highlightedId == null || pointKey(point) === highlightedId ? 1 : 0.25}
                />
              ))
            : null}
        </Scatter>

        {pinnedMarkers ? (
          <Scatter
            data={pinnedMarkers}
            dataKey="y"
            fill={`var(--color-${seriesKey})`}
            shape={EdgeTriangle}
            isAnimationActive={false}
            className={onPointClick ? "cursor-pointer" : undefined}
            onClick={
              onPointClick
                ? (entry) => {
                    const point = (entry as { payload?: ScatterDataPoint }).payload
                    if (point) onPointClick(point)
                  }
                : undefined
            }
          >
            {renderCells
              ? pinnedMarkers.map((point) => (
                  <Cell
                    key={pointKey(point)}
                    fill={pointFill?.(point) ?? `var(--color-${seriesKey})`}
                    fillOpacity={highlightedId == null || pointKey(point) === highlightedId ? 1 : 0.25}
                  />
                ))
              : null}
          </Scatter>
        ) : null}

        {renderPointLabels ? (
          <PointLabelsLayer
            data={data}
            sizeKey={sizeKey}
            sizeRange={sizeRange}
            edgeMarkers={pinnedMarkers ?? undefined}
          />
        ) : null}
      </RechartsScatterChart>
    </ChartContainer>
  )
}
