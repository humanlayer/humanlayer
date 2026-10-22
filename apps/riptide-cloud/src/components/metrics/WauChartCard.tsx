import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { ChartEmptyState, ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import { HorizontalBarChart } from '@humanlayer/ui/components/charts/horizontal-bar-chart'
import type { WeekRange } from '@humanlayer/ui/components/charts/week-range-selector'
import { cn } from '@humanlayer/ui/lib/utils'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { useRiptideApi } from '@/api/client'

export interface WauChartCardProps {
	className?: string
	weeks: WeekRange
}

export function WauChartCard({ className, weeks }: WauChartCardProps) {
	const { queryClient } = useRiptideApi()

	// Fetch only the active range — switching to an uncached range shows the
	// loading state; previously visited ranges return instantly from cache.
	const timezoneOffset = new Date().getTimezoneOffset()
	const {
		data: wauData,
		isLoading,
		error,
	} = useQuery(queryClient.metrics.weeklyActiveUsers.queryOptions({ input: { weeks, timezoneOffset } }))

	if (error) {
		Sentry.captureException(error, {
			tags: { component: 'WauChartCard', error_code: isDefinedError(error) ? error.code : 'unknown' },
		})
		return (
			<Card className={cn('p-4', className)}>
				<CardHeader>
					<CardTitle>Weekly Active Users</CardTitle>
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

	const startDateFormatted = wauData?.startDate ? format(wauData.startDate, 'EEEE MMM do') : undefined
	const endDateFormatted = wauData?.endDate ? format(wauData.endDate, 'EEEE MMM do') : undefined
	const isEmpty = wauData?.data.length === 0
	const data = wauData?.data ?? []

	return (
		<Card className={cn('p-4', className)}>
			<CardHeader>
				<CardTitle>Weekly Active Users</CardTitle>
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
						xDataKey="weekStart"
						yDataKeys={['users']}
						roundedBars={false}
						barCategoryGap="10%"
						config={{
							users: {
								label: 'Active Users',
								color: 'var(--chart-1)',
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
