import { type DateRange, DateRangeSelector } from '@humanlayer/ui/components/charts/date-range-selector'
import { type WeekRange, WeekRangeSelector } from '@humanlayer/ui/components/charts/week-range-selector'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { ActiveUsersChartsCard } from '@/components/metrics/ActiveUsersChartsCard'
import { DauChartCard } from '@/components/metrics/DauChartCard'
import { SessionsChartCard } from '@/components/metrics/SessionsChartCard'
import { SessionsPerWeekCard } from '@/components/metrics/SessionsPerWeekCard'
import { WauChartCard } from '@/components/metrics/WauChartCard'

export const Route = createFileRoute('/metrics')({
	component: MetricsPage,
})

function MetricsPage() {
	const [range, setRange] = useState<DateRange>('7d')
	const [weeks, setWeeks] = useState<WeekRange>(8)

	// Client-side admin check for UI purposes
	// Real authorization happens server-side in the API
	// TODO: Get admin status from API or context

	return (
		<div className="flex flex-col gap-6 p-6 min-h-0 grow overflow-auto">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Team Metrics</h1>
				<div className="flex flex-row flex-wrap items-center gap-6">
					<div className="flex items-center gap-3">
						<span className="text-sm text-muted-foreground whitespace-nowrap">Daily Charts</span>
						<DateRangeSelector value={range} onChange={setRange} />
					</div>
					<div className="flex items-center gap-3">
						<span className="text-sm text-muted-foreground whitespace-nowrap">Weekly Charts</span>
						<WeekRangeSelector value={weeks} onChange={setWeeks} />
					</div>
				</div>
			</div>

			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
				<WauChartCard weeks={weeks} />
				<SessionsPerWeekCard weeks={weeks} />
				<DauChartCard range={range} />
				<SessionsChartCard range={range} />
			</div>

			<ActiveUsersChartsCard weeks={weeks} />
		</div>
	)
}
