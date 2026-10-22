import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import type { ChartConfig } from '@humanlayer/ui/components/chart'
import { ChartEmptyState, ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import { InteractiveLineChart } from '@humanlayer/ui/components/charts/interactive-line-chart'
import type { WeekRange } from '@humanlayer/ui/components/charts/week-range-selector'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { cn } from '@humanlayer/ui/lib/utils'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Download } from 'lucide-react'

import { useRiptideApi } from '@/api/client'

// Max number of user lines drawn per chart. The legend below each chart is
// scrollable so it can hold every plotted user without bounding the card height.
const TOP_N = 10

type HeatmapUser = {
	userId: string
	displayName: string
	profilePictureUrl?: string
	values: number[]
	total: number
}

type MetricKey = 'sessions' | 'comments' | 'collaborationOutbound' | 'collaborationInbound'

type MetricData = {
	generatedAt: string
	weekStarts: string[]
	users: HeatmapUser[]
}

const METRICS: Array<{ key: MetricKey; title: string; description: string }> = [
	{ key: 'sessions', title: 'Sessions', description: 'Weekly sessions per user' },
	{ key: 'comments', title: 'Comments', description: 'Weekly comments per user' },
	{ key: 'collaborationOutbound', title: 'Collaboration (out)', description: 'Comments written on others’ docs' },
	{ key: 'collaborationInbound', title: 'Collaboration (in)', description: 'Comments received on your docs' },
]

// Cycle the theme's chart tokens so line colors track the active terminal theme.
const CHART_COLORS = 6
function lineColor(index: number): string {
	return `var(--chart-${(index % CHART_COLORS) + 1})`
}

// Escape a value for CSV: wrap in quotes when it contains a comma, quote, or
// newline, doubling any embedded quotes.
function csvCell(value: string | number): string {
	const str = String(value)
	return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function buildCsv(dataByMetric: Partial<Record<MetricKey, MetricData>>, weekStarts: string[]): string {
	const header = [
		'userId',
		'displayName',
		'weekStart',
		'sessions',
		'comments',
		'collaborationOutbound',
		'collaborationInbound',
	]
	const rows = [header.join(',')]
	const users = new Map<string, { displayName: string; metrics: Partial<Record<MetricKey, number[]>> }>()
	for (const metric of METRICS) {
		for (const u of dataByMetric[metric.key]?.users ?? []) {
			const entry = users.get(u.userId) ?? { displayName: u.displayName, metrics: {} }
			entry.metrics[metric.key] = u.values
			users.set(u.userId, entry)
		}
	}
	for (const [userId, u] of users) {
		weekStarts.forEach((week, i) => {
			rows.push(
				[
					csvCell(userId),
					csvCell(u.displayName),
					csvCell(week),
					u.metrics.sessions?.[i] ?? 0,
					u.metrics.comments?.[i] ?? 0,
					u.metrics.collaborationOutbound?.[i] ?? 0,
					u.metrics.collaborationInbound?.[i] ?? 0,
				].join(','),
			)
		})
	}
	return rows.join('\n')
}

function downloadCsv(
	dataByMetric: Partial<Record<MetricKey, MetricData>>,
	weekStarts: string[],
	weeks: WeekRange,
): void {
	const csv = buildCsv(dataByMetric, weekStarts)
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = `active-users-${weeks}w-${new Date().toISOString().slice(0, 10)}.csv`
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
	URL.revokeObjectURL(url)
}

function initialsOf(displayName: string): string {
	return displayName
		.split(' ')
		.map((n) => n[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

function formatShortDate(date: Date): string {
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatWeekPeriod(weekStarts: string[]): string {
	const firstWeek = weekStarts[0]
	const lastWeek = weekStarts.at(-1)
	if (!firstWeek || !lastWeek) return 'the weekly charts period'

	const start = new Date(`${firstWeek}T00:00:00`)
	const end = new Date(`${lastWeek}T00:00:00`)
	end.setDate(end.getDate() + 6)

	return `${formatShortDate(start)} - ${formatShortDate(end)}`
}

export interface ActiveUsersChartsCardProps {
	className?: string
	weeks: WeekRange
}

export function ActiveUsersChartsCard({ className, weeks }: ActiveUsersChartsCardProps) {
	const { queryClient } = useRiptideApi()
	const timezoneOffset = new Date().getTimezoneOffset()
	const commonInput = { weeks, timezoneOffset, limit: TOP_N }
	const sessionsQuery = useQuery(queryClient.metrics.activeUsersSessions.queryOptions({ input: commonInput }))
	const commentsQuery = useQuery(queryClient.metrics.activeUsersComments.queryOptions({ input: commonInput }))
	const outboundQuery = useQuery(
		queryClient.metrics.activeUsersCollaborationOutbound.queryOptions({ input: commonInput }),
	)
	const inboundQuery = useQuery(
		queryClient.metrics.activeUsersCollaborationInbound.queryOptions({ input: commonInput }),
	)

	const dataByMetric: Partial<Record<MetricKey, MetricData>> = {
		sessions: sessionsQuery.data as MetricData | undefined,
		comments: commentsQuery.data as MetricData | undefined,
		collaborationOutbound: outboundQuery.data as MetricData | undefined,
		collaborationInbound: inboundQuery.data as MetricData | undefined,
	}
	const loadingByMetric: Record<MetricKey, boolean> = {
		sessions: sessionsQuery.isLoading,
		comments: commentsQuery.isLoading,
		collaborationOutbound: outboundQuery.isLoading,
		collaborationInbound: inboundQuery.isLoading,
	}
	const weekStarts =
		dataByMetric.sessions?.weekStarts ??
		dataByMetric.comments?.weekStarts ??
		dataByMetric.collaborationOutbound?.weekStarts ??
		dataByMetric.collaborationInbound?.weekStarts ??
		[]
	const error = sessionsQuery.error ?? commentsQuery.error ?? outboundQuery.error ?? inboundQuery.error
	const isTopUsersLoading = sessionsQuery.isLoading || commentsQuery.isLoading

	if (error) {
		Sentry.captureException(error, {
			tags: {
				component: 'ActiveUsersChartsCard',
				error_code: 'unknown',
			},
		})
		return (
			<Card className={cn('p-4', className)}>
				<CardHeader>
					<CardTitle>Active Users</CardTitle>
					<CardDescription>Unable to load</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground">
						Something went wrong loading these charts. Please try again later.
					</p>
				</CardContent>
			</Card>
		)
	}

	const canDownload =
		Object.values(dataByMetric).some((data) => (data?.users.length ?? 0) > 0) && weekStarts.length > 0

	return (
		<div className={cn('flex flex-col gap-3', className)}>
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Active Users</h2>
				<Button
					variant="outline"
					size="sm"
					disabled={!canDownload}
					onClick={() => downloadCsv(dataByMetric, weekStarts, weeks)}
				>
					<Download />
					Download CSV
				</Button>
			</div>
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				<TopUsersTable
					sessionsUsers={dataByMetric.sessions?.users ?? []}
					commentsUsers={dataByMetric.comments?.users ?? []}
					weekStarts={dataByMetric.sessions?.weekStarts ?? []}
					isLoading={isTopUsersLoading}
					className="lg:row-span-2"
				/>
				{METRICS.map((metric) => (
					<MetricLineTile
						key={metric.key}
						title={metric.title}
						description={metric.description}
						metricKey={metric.key}
						data={dataByMetric[metric.key]}
						isLoading={loadingByMetric[metric.key]}
					/>
				))}
			</div>
		</div>
	)
}

interface MetricLineTileProps {
	title: string
	description: string
	metricKey: MetricKey
	data?: MetricData
	isLoading: boolean
}

function MetricLineTile({ title, description, data, isLoading }: MetricLineTileProps) {
	const topUsers = (data?.users ?? []).map((user, index) => ({ ...user, color: lineColor(index) }))
	const weekStarts = data?.weekStarts ?? []

	const isEmpty = topUsers.length === 0

	// One row per week; each plotted user contributes a series keyed by userId.
	const chartData = weekStarts.map((week, i) => {
		const row: Record<string, string | number> = { week }
		for (const u of topUsers) {
			row[u.userId] = u.values[i] ?? 0
		}
		return row
	})

	const config: ChartConfig = Object.fromEntries(
		topUsers.map((u) => [u.userId, { label: u.displayName, color: u.color }]),
	)

	return (
		<Card className="p-4">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<ChartLoadingState />
				) : isEmpty ? (
					<ChartEmptyState />
				) : (
					<>
						<InteractiveLineChart
							data={chartData}
							xDataKey="week"
							yDataKeys={topUsers.map((u) => u.userId)}
							config={config}
							showLegend={false}
							lineType="monotone"
							className="aspect-auto h-56 w-full"
						/>
						<div className="mt-3 max-h-32 space-y-1 overflow-y-auto pr-1">
							{topUsers.map((u) => (
								<div key={u.userId} className="flex items-center gap-2">
									<span
										className="h-0.5 w-4 shrink-0 rounded-full"
										style={{ backgroundColor: u.color }}
									/>
									<Avatar className="h-5 w-5 shrink-0">
										{u.profilePictureUrl && (
											<AvatarImage src={u.profilePictureUrl} alt={u.displayName} />
										)}
										<AvatarFallback className="text-[10px]">
											{initialsOf(u.displayName)}
										</AvatarFallback>
									</Avatar>
									<span className="truncate text-xs">{u.displayName}</span>
								</div>
							))}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	)
}

interface TopUsersTableProps {
	sessionsUsers: HeatmapUser[]
	commentsUsers: HeatmapUser[]
	weekStarts: string[]
	isLoading: boolean
	className?: string
}

// Ranked roster beside the metric charts: every active user, busiest first,
// with their session + comment totals over the visible window. Rows are
// clickable through to the admin users page.
function TopUsersTable({ sessionsUsers, commentsUsers, weekStarts, isLoading, className }: TopUsersTableProps) {
	const navigate = useNavigate()
	const commentsByUser = new Map(commentsUsers.map((u) => [u.userId, u.total]))
	const period = formatWeekPeriod(weekStarts)

	const ranked = sessionsUsers
		.map((u) => ({ user: u, sessions: u.total, comments: commentsByUser.get(u.userId) ?? 0 }))
		.filter((r) => r.sessions > 0 || r.comments > 0)

	const isEmpty = ranked.length === 0

	return (
		<Card className={cn('p-4', className)}>
			<CardHeader>
				<CardTitle>Top Users</CardTitle>
				<CardDescription>By sessions, {period}</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<ChartLoadingState />
				) : isEmpty ? (
					<ChartEmptyState />
				) : (
					<div className="max-h-[30rem] overflow-y-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>User</TableHead>
									<TableHead className="text-right">Sessions</TableHead>
									<TableHead className="text-right">Comments</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{ranked.map(({ user, sessions, comments }) => (
									<TableRow
										key={user.userId}
										className="cursor-pointer hover:bg-accent/10"
										onClick={() =>
											navigate({ to: '/admin/users', search: { userId: user.userId } })
										}
									>
										<TableCell>
											<div className="flex items-center gap-2">
												<Avatar className="h-6 w-6 shrink-0">
													{user.profilePictureUrl && (
														<AvatarImage
															src={user.profilePictureUrl}
															alt={user.displayName}
														/>
													)}
													<AvatarFallback className="text-[10px]">
														{initialsOf(user.displayName)}
													</AvatarFallback>
												</Avatar>
												<span className="truncate">{user.displayName}</span>
											</div>
										</TableCell>
										<TableCell className="text-right font-medium">{sessions}</TableCell>
										<TableCell className="text-right">{comments}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
