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

export interface SessionsPerWeekCardProps {
	className?: string
	weeks: WeekRange
}

export function SessionsPerWeekCard({ className, weeks }: SessionsPerWeekCardProps) {
	const { queryClient } = useRiptideApi()

	// Fetch only the active range — switching to an uncached range shows the
	// loading state; previously visited ranges return instantly from cache.
	const timezoneOffset = new Date().getTimezoneOffset()
	const {
		data: sessionsData,
		isLoading,
		error,
	} = useQuery(queryClient.metrics.sessionsPerWeek.queryOptions({ input: { weeks, timezoneOffset } }))

	if (error) {
		Sentry.captureException(error, {
			tags: { component: 'SessionsPerWeekCard', error_code: isDefinedError(error) ? error.code : 'unknown' },
		})
		return (
			<Card className={cn('p-4', className)}>
				<CardHeader>
					<CardTitle>Sessions per Week</CardTitle>
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

	const startDateFormatted = sessionsData?.startDate ? format(sessionsData.startDate, 'EEEE MMM do') : undefined
	const endDateFormatted = sessionsData?.endDate ? format(sessionsData.endDate, 'EEEE MMM do') : undefined
	const isEmpty = sessionsData?.data.length === 0
	const data = sessionsData?.data ?? []

	return (
		<Card className={cn('p-4', className)}>
			<CardHeader>
				<CardTitle>Sessions per Week</CardTitle>
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
						yDataKeys={['sessions']}
						roundedBars={false}
						barCategoryGap="10%"
						config={{
							sessions: {
								label: 'Sessions',
								color: 'var(--chart-3)',
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
