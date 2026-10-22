import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartContainer } from "../chart"

import type { ChartConfig } from "../chart"
import { cn } from "@humanlayer/ui/lib/utils"
import type { CurveType } from "recharts/types/shape/Curve"

interface MetricAreaChartProps {
  data: Array<Record<string, any>>
  xDataKey: string
  yDataKeys: string[]
  config: ChartConfig
  height?: number
  stacked?: boolean
  showGrid?: boolean
  showLegend?: boolean
  dateFormat?: (value: string | React.ReactNode) => string
  valueFormat?: (value: number) => string
  /**
   * Axis-tick-only formatter. Defaults to `valueFormat`; pass this when ticks
   * should be terser than the tooltip (e.g. "$19.2K" ticks, "$19,155.83" tooltip).
   */
  tickFormat?: (value: number) => string
  className?: string
  lineType?: CurveType
}

export function InteractiveAreaChart({
  data,
  xDataKey,
  yDataKeys,
  config,
  stacked = false,
  showGrid = true,
  showLegend = true,
  dateFormat = (value) => {
    const [year, month, day] = String(value).split('-').map(Number)
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  },
  valueFormat = (value) => value.toLocaleString(),
  tickFormat,
  className,
  lineType = 'natural'
}: MetricAreaChartProps) {
  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')}>
      <AreaChart             data={data}
            margin={{
              left: 12,
              right: 12,
            }}>
        {showGrid && <CartesianGrid vertical={false} strokeDasharray="3 3" />}
        <XAxis
          dataKey={xDataKey}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tickFormatter={dateFormat}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={tickFormat ?? valueFormat}
        />
        {/* valueFormat drives the tooltip as well as the axis: the two printing the same
            number in different formats reads as two different readings. */}
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="min-w-64"
              hideLabel={false}
              labelFormatter={dateFormat}
              valueFormatter={valueFormat}
              indicator="dot"
            />
          }
        />
        {showLegend && <ChartLegend content={<ChartLegendContent payload={[]}/>} />}
        {yDataKeys.map((key) => {
            return(
          <Area
            key={key}
            type={lineType}
            dataKey={key}
            stackId={stacked ? "1" : undefined}
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.6}
          />
        )})}
      </AreaChart>
    </ChartContainer>
  )
}