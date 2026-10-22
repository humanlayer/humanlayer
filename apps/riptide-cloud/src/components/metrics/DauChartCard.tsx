import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { ChartEmptyState, ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import type { DateRange } from '@humanlayer/ui/components/charts/date-range-selector'
import { HorizontalBarChart } from '@humanlayer/ui/components/charts/horizontal-bar-chart'
import { cn } from '@humanlayer/ui/lib/utils'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { useRiptideApi } from '@/api/client'

export interface DauChartCardProps {
	className?: string
	range: DateRange
}

export function DauChartCard({ className, range }: DauChartCardProps) {
	const { queryClient } = useRiptideApi()

	// Fetch only the active range — switching to an uncached range shows the
	// loading state; previously visited ranges return instantly from cache.
	const timezoneOffset = new Date().getTimezoneOffset()
	const {
		data: dauData,
		isLoading,
		error,
	} = useQuery(queryClient.metrics.dailyActiveUsers.queryOptions({ input: { range, timezoneOffset } }))

	if (error) {
		Sentry.captureException(error, {
			tags: { component: 'DauChartCard', error_code: isDefinedError(error) ? error.code : 'unknown' },
		})
		return (
			<Card className={cn('p-4', className)}>
				<CardHeader>
					<CardTitle>Daily Active Users</CardTitle>
					<CardDescription>Unable to load</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground">
						Something went wrong loading this chart. Please try again later.
					</p>
				</CardContent>
			</Card>
		)
	}

	const startDateFormatted = dauData?.startDate ? format(dauData.startDate, 'EEEE MMM do') : undefined
	const endDateFormatted = dauData?.endDate ? format(dauData.endDate, 'EEEE MMM do') : undefined
	const isEmpty = dauData?.data.length === 0
	const data = dauData?.data ?? []

	return (
		<Card className={cn('p-4', className)}>
			<CardHeader>
				<CardTitle>Daily Active Users</CardTitle>
				<CardDescription>
					{startDateFormatted && endDateFormatted
						? `${startDateFormatted} - ${endDateFormatted}`
						: 'Loading...'}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isEmpty ? (
					<ChartEmptyState />
				) : isLoading ? (
					<ChartLoadingState />
				) : (
					<HorizontalBarChart
						data={data}
						xDataKey="date"
						yDataKeys={['users']}
						roundedBars={false}
						barCategoryGap="5%"
						config={{
							users: {
								label: 'Active Users',
								color: 'var(--chart-4)',
							},
						}}
						showLegend={true}
						allowDecimals={false}
						yAxisHeadroom={0.2}
					/>
				)}
			</CardContent>
		</Card>
	)
}
