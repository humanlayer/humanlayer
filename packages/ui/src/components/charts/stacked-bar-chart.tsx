import type { ReactElement } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartContainer } from "../chart"
import type { ChartConfig } from "../chart"
import { cn } from "@humanlayer/ui/lib/utils"

interface StackedBarChartProps {
  data: Array<Record<string, any>>
  xDataKey: string
  yDataKeys: string[]
  config: ChartConfig
  height?: number
  showGrid?: boolean
  showLegend?: boolean
  labelFormat?: (value: string | React.ReactNode) => string
  valueFormat?: (value: number) => string
  /**
   * Axis-tick-only formatter. Defaults to `valueFormat`; pass this when ticks
   * should be terser than the tooltip (e.g. "$19.2K" ticks, "$19,155.83" tooltip).
   */
  tickFormat?: (value: number) => string
  className?: string
  barCategoryGap?: string | number
  maxBarSize?: number
  allowDecimals?: boolean
  yAxisHeadroom?: number
  /**
   * Chart orientation:
   * - "horizontal": bars grow upward (traditional bar chart, default)
   * - "vertical": bars grow sideways (horizontal bar chart)
   */
  orientation?: "horizontal" | "vertical"
  /**
   * Width of the Y-axis label area (only used in vertical orientation)
   */
  yAxisWidth?: number
  /**
   * Custom tick renderer for the category axis (Y-axis in vertical, X-axis in horizontal)
   * Receives tick props from Recharts
   */
  customTick?: (props: any) => ReactElement
  /**
   * Custom margins for the chart
   */
  margin?: {
    left?: number
    right?: number
    top?: number
    bottom?: number
  }
  /**
   * Custom tooltip content component
   */
  tooltipContent?: ReactElement
  /**
   * Inline style for the chart container
   */
  style?: React.CSSProperties
  /**
   * Minimum width for the tooltip
   */
  tooltipMinWidth?: string
  /**
   * How series share a category slot:
   * - true (default): segments stack, so a bar's full length is the category total
   * - false: one bar per series, side by side — every series sits on the shared
   *   baseline, which is what makes two series directly comparable by eye
   */
  stacked?: boolean
}

export function StackedBarChart({
  data,
  xDataKey,
  yDataKeys,
  config,
  showGrid = true,
  showLegend = true,
  labelFormat = (value) => String(value),
  valueFormat = (value) => value.toLocaleString(),
  tickFormat,
  className,
  barCategoryGap = "10%",
  maxBarSize = 50,
  allowDecimals = true,
  yAxisHeadroom,
  orientation = "horizontal",
  yAxisWidth = 120,
  customTick,
  margin,
  tooltipContent,
  style,
  tooltipMinWidth = "min-w-64",
  stacked = true
}: StackedBarChartProps) {
  const isVertical = orientation === "vertical"

  // Calculate the tallest bar for the axis domain: the category total when
  // stacked, the largest single series when grouped side by side.
  const maxValue = yAxisHeadroom
    ? Math.max(...data.map(d =>
        stacked
          ? yDataKeys.reduce((sum, k) => sum + (d[k] || 0), 0)
          : Math.max(...yDataKeys.map(k => d[k] || 0))
      ))
    : undefined
  const axisDomain: [number, number] | undefined = yAxisHeadroom && maxValue
    ? [0, Math.ceil(maxValue * (1 + yAxisHeadroom))]
    : undefined

  // Determine bar radius based on orientation and position in stack
  const getBarRadius = (index: number): [number, number, number, number] => {
    const isFirst = index === 0
    const isLast = index === yDataKeys.length - 1

    if (yDataKeys.length === 1) {
      return [4, 4, 4, 4] // Single bar: all corners rounded
    }

    // Grouped: every bar is its own bar, so each one rounds its own data end.
    if (!stacked) {
      return isVertical ? [0, 4, 4, 0] : [4, 4, 0, 0]
    }

    if (isVertical) {
      // Vertical orientation: bars grow to the right
      // First bar (left/start of stack): left corners rounded
      // Last bar (right/end of stack): right corners rounded
      if (isFirst) return [4, 0, 0, 4]
      if (isLast) return [0, 4, 4, 0]
      return [0, 0, 0, 0]
    }

    // Horizontal orientation: bars grow upward
    // First bar (bottom of stack): bottom corners rounded
    // Last bar (top of stack): top corners rounded
    if (isFirst) return [0, 0, 4, 4]
    if (isLast) return [4, 4, 0, 0]
    return [0, 0, 0, 0]
  }

  // Default tooltip content. valueFormat drives the tooltip as well as the axis: the two
  // printing the same number in different formats reads as two different readings.
  const defaultTooltipContent = (
    <ChartTooltipContent
      className={tooltipMinWidth}
      hideLabel={false}
      labelFormatter={labelFormat}
      valueFormatter={valueFormat}
      indicator="dot"
    />
  )

  if (isVertical) {
    // Vertical orientation: bars grow sideways (like VerticalBarChart)
    const defaultVerticalMargin = {
      left: customTick ? 150 : 0,
      right: 12,
      top: 20,
      bottom: 20
    }
    const chartMargin = margin ? { ...defaultVerticalMargin, ...margin } : defaultVerticalMargin

    return (
      <ChartContainer config={config} className={cn(className, 'min-h-[100px]')} style={style}>
        <BarChart
          layout="vertical"
          data={data}
          barCategoryGap={barCategoryGap}
          maxBarSize={maxBarSize}
          margin={chartMargin}
        >
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={true}
              horizontal={false}
            />
          )}

          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tickFormatter={tickFormat ?? valueFormat}
            allowDecimals={allowDecimals}
            domain={axisDomain}
          />
          <YAxis
            type="category"
            dataKey={xDataKey}
            tickLine={false}
            axisLine={false}
            tickFormatter={customTick ? undefined : labelFormat}
            width={yAxisWidth}
            tickMargin={10}
            tick={customTick}
            // Category rows must all be named: recharts' default interval
            // silently drops alternate labels when rows are short, which reads
            // as missing data rather than a crowded axis.
            interval={0}
          />

          <ChartTooltip content={tooltipContent ?? defaultTooltipContent} />
          {showLegend && <ChartLegend content={<ChartLegendContent payload={null}/>} />}

          {yDataKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              stackId={stacked ? "stack" : undefined}
              fill={`var(--color-${key})`}
              radius={getBarRadius(index)}
            />
          ))}
        </BarChart>
      </ChartContainer>
    )
  }

  // Horizontal orientation: bars grow upward (like HorizontalBarChart)
  const defaultHorizontalMargin = {
    left: 12,
    right: 12,
    top: 20,
    bottom: 20
  }
  const chartMargin = margin ? { ...defaultHorizontalMargin, ...margin } : defaultHorizontalMargin

  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')} style={style}>
      <BarChart
        data={data}
        barCategoryGap={barCategoryGap}
        maxBarSize={maxBarSize}
        margin={chartMargin}
      >
        {showGrid && (
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            horizontal={true}
            syncWithTicks={true}
          />
        )}

        <XAxis
          dataKey={xDataKey}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={32}
          tickFormatter={customTick ? undefined : labelFormat}
          tick={customTick}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={tickFormat ?? valueFormat}
          allowDecimals={allowDecimals}
          domain={axisDomain}
        />

        <ChartTooltip content={tooltipContent ?? defaultTooltipContent} />
        {showLegend && <ChartLegend content={<ChartLegendContent payload={[]} />} />}

        {yDataKeys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            stackId={stacked ? "stack" : undefined}
            fill={`var(--color-${key})`}
            radius={getBarRadius(index)}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
