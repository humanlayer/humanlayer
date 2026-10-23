import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartContainer } from "../chart"
import type { ChartConfig } from "../chart"
import { cn } from "@humanlayer/ui/lib/utils"

interface HorizontalBarChartProps {
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
  roundedBars?: boolean
  barCategoryGap?: string | number
  maxBarSize?: number
  allowDecimals?: boolean
  yAxisHeadroom?: number
}

export function HorizontalBarChart({
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
  roundedBars = false,
  barCategoryGap = "10%",
  maxBarSize = 50,
  allowDecimals = true,
  yAxisHeadroom
}: HorizontalBarChartProps) {
  const radius: [number, number, number, number] = roundedBars ? [4, 4, 0, 0] : [0, 0, 0, 0]

  const maxValue = yAxisHeadroom
    ? Math.max(...data.flatMap(d => yDataKeys.map(k => d[k] || 0)))
    : undefined
  const yAxisDomain: [number, number] | undefined = yAxisHeadroom && maxValue
    ? [0, Math.ceil(maxValue * (1 + yAxisHeadroom))]
    : undefined

  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')}>
      <BarChart
        data={data}
        barCategoryGap={barCategoryGap}
        maxBarSize={maxBarSize}
        margin={{
          left: 12,
          right: 12,
          top: 20,
          bottom: 20
        }}
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
          tickFormatter={dateFormat}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={valueFormat}
          allowDecimals={allowDecimals}
          domain={yAxisDomain}
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

        {yDataKeys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`var(--color-${key})`}
            radius={radius}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}