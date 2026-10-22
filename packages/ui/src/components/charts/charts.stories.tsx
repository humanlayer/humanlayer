import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { InteractiveLineChart } from './interactive-line-chart'
import { InteractiveAreaChart } from './interactive-area-chart'
import { VerticalBarChart } from './vertical-bar-chart'
import { HorizontalBarChart } from './horizontal-bar-chart'
import { StackedBarChart } from './stacked-bar-chart'
import { ScatterChart } from './scatter-chart'
import { DateRangeSelector, type DateRange } from './date-range-selector'
import type { ChartConfig } from '../chart'

const meta = {
  title: 'Shell Demos/Charts',
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// Generate mock data for the last 30 days
const generateDailyData = (days: number) => {
  const data = []
  const today = new Date()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // Generate realistic looking data with some randomness
    const baseValue = 100 + Math.sin(i / 5) * 20
    const sessions = Math.floor(baseValue + Math.random() * 50)
    const messages = Math.floor(sessions * (3 + Math.random() * 2))
    const users = Math.floor(sessions / (2 + Math.random()))

    data.push({
      date: dateStr,
      sessions,
      messages,
      users,
      sessionsPerUser: Math.round((sessions / users) * 100) / 10,
      messagesPerUser: Math.round((messages / users) * 100) / 10,
      activeUsers: isWeekend ? Math.floor(users * 0.6) : users,
      isWeekend,
    })
  }

  return data
}

const mockDailyData = generateDailyData(30)

// Demo-only median + Theil-Sen helpers. The production scatter now draws a
// least-squares line instead (`linearFit` in
// apps/riptide-cloud/src/components/metrics/scatterViews.ts, which this
// package cannot depend on); these stay as story-local demo math.
const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const theilSenOf = (points: Array<{ x: number; y: number }>) => {
  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x
      if (dx === 0) continue
      slopes.push((points[j].y - points[i].y) / dx)
    }
  }
  if (slopes.length === 0) return null
  const slope = medianOf(slopes)
  const intercept = medianOf(points.map((point) => point.y - slope * point.x))
  return { slope, intercept }
}

// Line Chart Story
export const LineChart: Story = {
  render: () => {
    const config: ChartConfig = {
      sessions: {
        label: "Total Sessions",
        color: "var(--chart-1)",
      },
      sessionsPerUser: {
        label: "Sessions Per user",
        color: "var(--chart-2)",
      },
    }

    return (
      <div className='grid grid-cols-2 gap-4'>
      <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Natural</h3>
        <InteractiveLineChart
          data={mockDailyData}
          xDataKey="date"
          yDataKeys={["sessions", "sessionsPerUser"]}
          config={config}
          showLegend={true}
          className='h-[300px] w-full'
        />
      </div>
            <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Step</h3>
        <InteractiveLineChart
          data={mockDailyData}
          xDataKey="date"
          yDataKeys={["sessions", "sessionsPerUser"]}
          config={config}
          showLegend={true}
          className='h-[300px] w-full'
          lineType={'step'}
        />
      </div>
            <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Linear</h3>
        <InteractiveLineChart
          data={mockDailyData}
          xDataKey="date"
          yDataKeys={["sessions", "sessionsPerUser"]}
          config={config}
          showLegend={true}
          className='h-[300px] w-full'
          lineType={'linear'}
        />
      </div>
                  <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Basis</h3>
        <InteractiveLineChart
          data={mockDailyData}
          xDataKey="date"
          yDataKeys={["sessions", "sessionsPerUser"]}
          config={config}
          showLegend={true}
          className='h-[300px] w-full'
          lineType={'basis'}
        />
      </div>
                        <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Bump</h3>
        <InteractiveLineChart
          data={mockDailyData}
          xDataKey="date"
          yDataKeys={["sessions", "sessionsPerUser"]}
          config={config}
          showLegend={true}
          className='h-[300px] w-full'
          lineType={'bump'}
        />
      </div>
      </div>
    )
  },
}

// Area Chart Story with Different Line Types
export const AreaChart: Story = {
  render: () => {
    const config: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-1)",
      },
      messages: {
        label: "Messages",
        color: "var(--chart-2)",
      },
    }

    return (
      <div className='grid grid-cols-2 gap-4'>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Natural (Default)</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="natural"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Linear</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="linear"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Step</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="step"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Basis</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="basis"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Monotone</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="monotone"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Bump</h3>
          <InteractiveAreaChart
            data={mockDailyData}
            xDataKey="date"
            yDataKeys={["sessions", "messages"]}
            config={config}
            className='h-[300px]'
            stacked={true}
            lineType="bump"
          />
        </div>
      </div>
    )
  },
}

// Area Chart Non-Stacked with Different Line Types
export const AreaChartNonStacked: Story = {
  render: () => {
    const config: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-1)",
      },
      users: {
        label: "Users",
        color: "var(--chart-3)",
      },
    }

    return (
      <div className='grid grid-cols-2 gap-4'>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Natural (Non-Stacked)</h3>
          <InteractiveAreaChart
            data={mockDailyData.slice(-14)}
            xDataKey="date"
            yDataKeys={["sessions", "users"]}
            config={config}
            className='h-[300px]'
            stacked={false}
            lineType="natural"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Linear (Non-Stacked)</h3>
          <InteractiveAreaChart
            data={mockDailyData.slice(-14)}
            xDataKey="date"
            yDataKeys={["sessions", "users"]}
            config={config}
            className='h-[300px]'
            stacked={false}
            lineType="linear"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Step (Non-Stacked)</h3>
          <InteractiveAreaChart
            data={mockDailyData.slice(-14)}
            xDataKey="date"
            yDataKeys={["sessions", "users"]}
            config={config}
            className='h-[300px]'
            stacked={false}
            lineType="step"
          />
        </div>
        <div className="w-full space-y-4">
          <h3 className="text-lg font-semibold">Monotone (Non-Stacked)</h3>
          <InteractiveAreaChart
            data={mockDailyData.slice(-14)}
            xDataKey="date"
            yDataKeys={["sessions", "users"]}
            config={config}
            className='h-[300px]'
            stacked={false}
            lineType="monotone"
          />
        </div>
      </div>
    )
  },
}

// Horizontal Bar Chart Story (bars go upward)
export const HorizontalBarChartDemo: Story = {
  render: () => {
    // Single bar config
    const singleBarConfig: ChartConfig = {
      users: {
        label: "Active Users",
        color: "var(--chart-3)",
      },
    }

    // Double bar config
    const doubleBarConfig: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-1)",
      },
      messages: {
        label: "Messages",
        color: "var(--chart-2)",
      },
    }

    // Use last 14 days of data
    const barData = mockDailyData.slice(-14)

    return (
      <div className='space-y-8'>
        <h2 className="text-2xl font-bold">Horizontal Bar Charts (Traditional)</h2>
        <div className='grid grid-cols-2 gap-4'>
          {/* Default spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Default Bar Spacing</h3>
            <HorizontalBarChart
              data={barData}
              xDataKey="date"
              yDataKeys={["users"]}
              roundedBars={false}
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Tight spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Tight Bar Spacing (5%)</h3>
            <HorizontalBarChart
              data={barData}
              xDataKey="date"
              yDataKeys={["users"]}
              roundedBars={false}
              barCategoryGap="5%"
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Wide spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Wide Bar Spacing (20%)</h3>
            <HorizontalBarChart
              data={barData}
              xDataKey="date"
              yDataKeys={["users"]}
              roundedBars={true}
              barCategoryGap="20%"
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Multiple bars */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Multiple Bars</h3>
            <HorizontalBarChart
              data={barData.slice(-7)}
              xDataKey="date"
              yDataKeys={["sessions", "messages"]}
              roundedBars={true}
              config={doubleBarConfig}
              className='h-[300px]'
              showLegend={true}
            />
          </div>
        </div>
      </div>
    )
  },
}

// Vertical Bar Chart Story (bars go sideways)
export const VerticalBarChartDemo: Story = {
  render: () => {
    // Single bar config
    const singleBarConfig: ChartConfig = {
      users: {
        label: "Active Users",
        color: "var(--chart-4)",
      },
    }

    // Double bar config
    const doubleBarConfig: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-5)",
      },
      messages: {
        label: "Messages",
        color: "var(--chart-1)",
      },
    }

    // Use last 7 days for vertical (looks better with fewer items)
    const barData = mockDailyData.slice(-7).map(d => ({
      ...d,
      label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }))

    return (
      <div className='space-y-8'>
        <h2 className="text-2xl font-bold">Vertical Bar Charts (Sideways)</h2>
        <div className='grid grid-cols-2 gap-4'>
          {/* Default spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Default Bar Spacing</h3>
            <VerticalBarChart
              data={barData}
              xDataKey="label"
              yDataKeys={["users"]}
              roundedBars={false}
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Tight spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Tight Bar Spacing (5%)</h3>
            <VerticalBarChart
              data={barData}
              xDataKey="label"
              yDataKeys={["users"]}
              roundedBars={false}
              barCategoryGap="5%"
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Wide spacing with rounded */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Wide Spacing (20%) + Rounded</h3>
            <VerticalBarChart
              data={barData}
              xDataKey="label"
              yDataKeys={["users"]}
              roundedBars={true}
              barCategoryGap="20%"
              config={singleBarConfig}
              className='h-[300px]'
              showLegend={false}
            />
          </div>

          {/* Multiple bars */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Multiple Bars</h3>
            <VerticalBarChart
              data={barData}
              xDataKey="label"
              yDataKeys={["sessions", "messages"]}
              roundedBars={true}
              config={doubleBarConfig}
              className='h-[300px]'
              showLegend={true}
            />
          </div>
        </div>
      </div>
    )
  },
}



// Stacked Bar Chart Story - Horizontal (bars grow upward)
export const StackedBarChartHorizontal: Story = {
  render: () => {
    // Two data keys for stacking - blue and green
    const twoKeyConfig: ChartConfig = {
      desktop: {
        label: "Desktop",
        color: "var(--chart-4)", // blue
      },
      mobile: {
        label: "Mobile",
        color: "var(--chart-2)", // green
      },
    }

    // Three data keys for stacking - blue, green, yellow
    const threeKeyConfig: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-4)", // blue
      },
      messages: {
        label: "Messages",
        color: "var(--chart-2)", // green
      },
      users: {
        label: "Users",
        color: "var(--chart-3)", // yellow
      },
    }

    // Use last 14 days of data with desktop/mobile breakdown
    const stackedData = mockDailyData.slice(-14).map(d => ({
      ...d,
      desktop: Math.floor(d.sessions * 0.6),
      mobile: Math.floor(d.sessions * 0.4),
    }))

    return (
      <div className='space-y-8'>
        <h2 className="text-2xl font-bold">Stacked Bar Charts - Horizontal (Bars Grow Upward)</h2>
        <div className='grid grid-cols-2 gap-4'>
          {/* Two keys stacked */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Two Data Series (Desktop vs Mobile)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="date"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              orientation="horizontal"
            />
          </div>

          {/* Three keys stacked */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Three Data Series</h3>
            <StackedBarChart
              data={mockDailyData.slice(-14)}
              xDataKey="date"
              yDataKeys={["sessions", "messages", "users"]}
              config={threeKeyConfig}
              className='h-[300px]'
              showLegend={true}
              orientation="horizontal"
            />
          </div>

          {/* Tight spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Tight Spacing (5%)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="date"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              barCategoryGap="5%"
              orientation="horizontal"
            />
          </div>

          {/* Wide spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Wide Spacing (25%)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="date"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              barCategoryGap="25%"
              orientation="horizontal"
            />
          </div>
        </div>
      </div>
    )
  },
}

// Stacked Bar Chart Story - Vertical (bars grow sideways)
export const StackedBarChartVertical: Story = {
  render: () => {
    // Two data keys for stacking - blue and green
    const twoKeyConfig: ChartConfig = {
      desktop: {
        label: "Desktop",
        color: "var(--chart-4)", // blue
      },
      mobile: {
        label: "Mobile",
        color: "var(--chart-2)", // green
      },
    }

    // Three data keys for stacking - blue, green, yellow
    const threeKeyConfig: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-4)", // blue
      },
      messages: {
        label: "Messages",
        color: "var(--chart-2)", // green
      },
      users: {
        label: "Users",
        color: "var(--chart-3)", // yellow
      },
    }

    // Use last 7 days of data with labels for vertical orientation
    const stackedData = mockDailyData.slice(-7).map(d => ({
      ...d,
      label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      desktop: Math.floor(d.sessions * 0.6),
      mobile: Math.floor(d.sessions * 0.4),
    }))

    return (
      <div className='space-y-8'>
        <h2 className="text-2xl font-bold">Stacked Bar Charts - Vertical (Bars Grow Sideways)</h2>
        <div className='grid grid-cols-2 gap-4'>
          {/* Two keys stacked */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Two Data Series (Desktop vs Mobile)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="label"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              orientation="vertical"
            />
          </div>

          {/* Three keys stacked */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Three Data Series</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="label"
              yDataKeys={["sessions", "messages", "users"]}
              config={threeKeyConfig}
              className='h-[300px]'
              showLegend={true}
              orientation="vertical"
            />
          </div>

          {/* Tight spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Tight Spacing (5%)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="label"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              barCategoryGap="5%"
              orientation="vertical"
            />
          </div>

          {/* Wide spacing */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Wide Spacing (25%)</h3>
            <StackedBarChart
              data={stackedData}
              xDataKey="label"
              yDataKeys={["desktop", "mobile"]}
              config={twoKeyConfig}
              className='h-[300px]'
              showLegend={true}
              barCategoryGap="25%"
              orientation="vertical"
            />
          </div>
        </div>
      </div>
    )
  },
}

// Scatter Chart Story
export const ScatterChartDemo: Story = {
  render: () => {
    const config: ChartConfig = {
      points: {
        label: "Sessions",
        color: "var(--chart-1)",
      },
    }

    // Plot messages (x) against sessions (y) per day, carrying users as extra payload
    const scatterData = mockDailyData.map(d => ({
      x: d.messages,
      y: d.sessions,
      label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      users: d.users,
    }))

    const trendFit = theilSenOf(scatterData)

    return (
      <div className='space-y-8'>
        <h2 className="text-2xl font-bold">Scatter Chart</h2>
        <div className='grid grid-cols-2 gap-4'>
          {/* Default */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Default</h3>
            <ScatterChart
              data={scatterData}
              config={config}
              xLabel="Messages"
              yLabel="Sessions"
              className='h-[300px]'
            />
          </div>

          {/* Custom formatting + extra tooltip line */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Custom Formatting + Tooltip Extra</h3>
            <ScatterChart
              data={scatterData}
              config={config}
              xLabel="Messages"
              yLabel="Sessions"
              xFormatter={(value) => `${value.toLocaleString()} msgs`}
              yFormatter={(value) => `${value.toLocaleString()} sessions`}
              tooltipExtra={(point) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">Users</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">{String(point.users)}</span>
                </div>
              )}
              className='h-[300px]'
            />
          </div>

          {/* Median trend line */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">With Median Trend Line</h3>
            <ScatterChart
              data={scatterData}
              config={config}
              xLabel="Messages"
              yLabel="Sessions"
              trendLine={trendFit ? { ...trendFit, label: 'median' } : undefined}
              className='h-[300px]'
            />
          </div>

          {/* Point labels + axis titles + click-to-highlight */}
          <div className="w-full space-y-4">
            <h3 className="text-lg font-semibold">Labeled Points + Axis Titles + Click Highlight</h3>
            <InteractiveScatterDemo config={config} data={scatterData} />
          </div>
        </div>
      </div>
    )
  },
}

// Point labels auto-hide above 16 points, so this demo slices the data down;
// clicking a point toggles the highlight (the same wiring the efficiency
// dashboard uses across its two charts).
const InteractiveScatterDemo = ({
  config,
  data,
}: {
  config: ChartConfig
  data: Array<{ x: number; y: number; label: string; users: number }>
}) => {
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const labeledData = data.slice(-10).map((point) => ({ ...point, id: point.label }))
  const trendFit = theilSenOf(labeledData)

  return (
    <ScatterChart
      data={labeledData}
      config={config}
      xLabel="Messages"
      yLabel="Sessions"
      trendLine={trendFit ?? undefined}
      showAxisTitles
      showPointLabels
      highlightedId={highlightedId}
      onPointClick={(point) => {
        const id = point.id ?? point.label
        setHighlightedId((current) => (current === id ? null : id))
      }}
      className='h-[300px]'
    />
  )
}

// Date Range Selector Story
export const DateRangeSelectorDemo: Story = {
  render: () => {
    const DateRangeDemo = () => {
      const [range, setRange] = useState<DateRange>('30d')

      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Date Range Selector</h3>
          <DateRangeSelector value={range} onChange={setRange} />
          <p className="text-sm text-muted-foreground">
            Selected range: {range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : 'Last 90 days'}
          </p>
        </div>
      )
    }

    return <DateRangeDemo />
  },
}



// Combined Dashboard Example
export const DashboardExample: Story = {
  render: () => {
    const DashboardDemo = () => {
      const [range, setRange] = useState<DateRange>('30d')
      const [loading, setLoading] = useState(false)

      // Filter data based on selected range
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
      const filteredData = mockDailyData.slice(-days)

      const handleRangeChange = (newRange: DateRange) => {
        setLoading(true)
        setRange(newRange)
        // Simulate loading
        setTimeout(() => setLoading(false), 500)
      }

      const sessionsConfig: ChartConfig = {
        sessions: {
          label: "Sessions",
          color: "var(--chart-1)",
        },
        sessionsPerUser: {
          label: "Per User",
          color: "var(--chart-2)",
        },
      }

      const messagesConfig: ChartConfig = {
        messages: {
          label: "Messages",
          color: "var(--chart-3)",
        },
        messagesPerUser: {
          label: "Per User",
          color: "var(--chart-4)",
        },
      }

      const dauConfig: ChartConfig = {
        users: {
          label: "Active Users",
          color: "var(--chart-5)",
        },
      }

      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Team Metrics Dashboard</h2>
            <DateRangeSelector value={range} onChange={handleRangeChange} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Sessions Per Day */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Sessions Per Day</h3>

                <InteractiveLineChart
                  data={filteredData}
                  xDataKey="date"
                  yDataKeys={["sessions", "sessionsPerUser"]}
                  config={sessionsConfig}
                  className='h-[300px]'
                />
              
            </div>

            {/* Messages Per Day */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Messages Per Day</h3>

                <InteractiveLineChart
                  data={filteredData}
                  xDataKey="date"
                  yDataKeys={["messages", "messagesPerUser"]}
                  config={messagesConfig}
                  className='h-[300px]'
                />
              
            </div>

            {/* Daily Active Users */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Daily Active Users</h3>

                <HorizontalBarChart
                  data={filteredData.slice(-14)}
                  xDataKey="date"
                  yDataKeys={["users"]}
                  config={dauConfig}
                  className='h-[300px]'
                  roundedBars={true}
                  showLegend={false}
                />

            </div>

          </div>
        </div>
      )
    }

    return <DashboardDemo />
  },
}

// Chart with Custom Formatting
export const CustomFormatting: Story = {
  render: () => {
    const config: ChartConfig = {
      sessions: {
        label: "Total Sessions",
        color: "var(--chart-1)",
      },
      messages: {
        label: "Total Messages",
        color: "var(--chart-2)",
      },
    }

    return (
      <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">Custom Formatted Chart</h3>
        <InteractiveLineChart
          data={mockDailyData.slice(-7)}
          xDataKey="date"
          yDataKeys={["sessions", "messages"]}
          config={config}
          className='h-[300px]'
          dateFormat={(value) => {
            const date = new Date(value)
            return date.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric'
            })
          }}
          valueFormat={(value) => `${value.toLocaleString()} units`}
        />
      </div>
    )
  },
}

// Empty State
export const EmptyState: Story = {
  render: () => {
    const config: ChartConfig = {
      sessions: {
        label: "Sessions",
        color: "var(--chart-1)",
      },
    }

    return (
      <div className="w-full space-y-4">
        <h3 className="text-lg font-semibold">No Data Available</h3>
        <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
          <p>No metrics data available for the selected period.</p>
          <p className="text-sm mt-2">Try selecting a different date range or check back later.</p>
        </div>
      </div>
    )
  },
}