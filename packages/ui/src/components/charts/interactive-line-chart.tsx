import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartContainer } from "../chart"
import type { ChartConfig } from "../chart"
import type { CurveType } from "recharts/types/shape/Curve"
import { cn } from "@humanlayer/ui/lib/utils"

interface MetricLineChartProps {
  data: Array<Record<string, any>>
  xDataKey: string
  yDataKeys: string[]
  config: ChartConfig
  height?: number
  showGrid?: boolean
  showLegend?: boolean
  dateFormat?: (value: string | React.ReactNode) => string
  valueFormat?: (value: number) => string
  className?: string
  labelKey?: string
  nameKey?: string
  lineType?: CurveType
  /** Render a dot at every data point — useful for short weekly series. */
  showDots?: boolean
}

export function InteractiveLineChart({
  data,
  xDataKey,
  yDataKeys,
  config,
  showGrid = true,
  showLegend = true,
  dateFormat = (value) => {
    const [year, month, day] = String(value).split('-').map(Number)
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  },
  valueFormat = (value) => value.toLocaleString(),
  className,
  lineType = 'natural',
  showDots = false
}: MetricLineChartProps) {
  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')}>
      <LineChart             
            data={data}
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
            tickFormatter={valueFormat}
            // Width follows the widest tick label. With the recharts default of
            // 60px a label like "$22,000.00" runs past the left edge of the svg
            // and loses its first characters.
            width="auto"
        />
        {/* valueFormat drives the tooltip as well as the axis: the two printing the same
            number differently ("$225.11" vs "225.106") reads as two different figures. */}
        <ChartTooltip content={<ChartTooltipContent className="min-w-64" hideLabel={false} labelFormatter={dateFormat} valueFormatter={valueFormat} indicator='dot'/>}/>
        {showLegend && <ChartLegend content={<ChartLegendContent payload={[]}/>} />}
        {yDataKeys.map((key, index) => {
        return (
          <Line
                key={key}
                type={lineType}
                dataKey={key}
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                dot={showDots ? { r: 3, strokeWidth: 0, fill: `var(--color-${key})` } : false}
          />
        )})}
      </LineChart>
    </ChartContainer>
  )
}