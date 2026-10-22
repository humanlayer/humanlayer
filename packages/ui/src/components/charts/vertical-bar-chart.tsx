import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartContainer } from "../chart"
import type { ChartConfig } from "../chart"
import { cn } from "@humanlayer/ui/lib/utils"

interface VerticalBarChartProps {
  data: Array<Record<string, any>>
  xDataKey: string
  yDataKeys: string[]
  config: ChartConfig
  height?: number
  showGrid?: boolean
  showLegend?: boolean
  labelFormat?: (value: string) => string
  valueFormat?: (value: number) => string
  className?: string
  roundedBars?: boolean
  barCategoryGap?: string | number
  maxBarSize?: number
}

export function VerticalBarChart({
  data,
  xDataKey,
  yDataKeys,
  config,
  showGrid = true,
  showLegend = true,
  labelFormat = (value) => value,
  valueFormat = (value) => value.toLocaleString(),
  className,
  roundedBars = false,
  barCategoryGap = "10%",
  maxBarSize = 50
}: VerticalBarChartProps) {
  const radius: [number, number, number, number] = roundedBars ? [0, 4, 4, 0] : [0, 0, 0, 0]

  return (
    <ChartContainer config={config} className={cn(className, 'min-h-[100px]')}>
      <BarChart
        layout="vertical"
        data={data}
        barCategoryGap={barCategoryGap}
        maxBarSize={maxBarSize}
        margin={{
          left: 0,
          right: 12,
          top: 20,
          bottom: 20
        }}
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
          tickFormatter={valueFormat}
        />
        <YAxis
          type="category"
          dataKey={xDataKey}
          tickLine={false}
          axisLine={false}
          tickFormatter={labelFormat}
          width={120}
          tickMargin={10}
        />

        {/* valueFormat drives the tooltip as well as the axis: the two printing the same
            number in different formats reads as two different readings. */}
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="min-w-64"
              hideLabel={false}
              labelFormatter={(value) => labelFormat(String(value))}
              valueFormatter={valueFormat}
              indicator="dot"
            />
          }
        />
        {showLegend && <ChartLegend content={<ChartLegendContent payload={[]} />} />}

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