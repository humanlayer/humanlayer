import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { ChartEmptyState, ChartLoadingState } from '@humanlayer/ui/components/charts/chart-states'
import { cn } from '@humanlayer/ui/lib/utils'
import * as Sentry from '@sentry/react'
import { format } from 'date-fns'
import { type ReactNode, useMemo } from 'react'
import { z } from 'zod'

import { useMountEffect } from '@/hooks/useMountEffect'

import { ChartInfoPopover } from './ChartInfoPopover'
import { parseLocalDay } from './clientBuckets'

/**
 * Explicit chart size for the metric cards. Both dimensions are set on
 * purpose: ChartContainer's base classes are `flex aspect-video
 * justify-center`, so with only a height the aspect ratio would derive a
 * narrow width and centre it, leaving the chart adrift in a wide card — and
 * with only `w-full` a full-width card would be ~9/16 of the page tall.
 *
 * `aspect-auto` is load-bearing: even overridden by w-full/h-*, the
 * aspect-video ratio still defines the element's INTRINSIC min-content
 * width (16/9 × height ≈ 533px), which any auto-sized ancestor track or
 * min-width:auto flex item will refuse to shrink below — on a phone that
 * pushes the whole card past the viewport.
 */
export const CHART_SIZE = 'aspect-auto w-full h-[300px]'

const errorCodeSchema = z.object({
	code: z.union([z.string(), z.number()]).transform((code) => `${code}`),
})

const parseErrorCode = (error: unknown): string => errorCodeSchema.safeParse(error).data?.code ?? 'unknown'

function MetricCardSentryErrorCapture({
	error,
	sentryComponent,
	errorCode,
}: {
	error: unknown
	sentryComponent: string
	errorCode: string
}) {
	useMountEffect(() => {
		Sentry.captureException(error, {
			tags: { component: sentryComponent, error_code: errorCode },
		})
	})

	return null
}

export interface MetricCardShellProps {
	className?: string
	title: string
	/** ⓘ popover lines (empty strings skipped) — the card's methodology notes. */
	infoNotes: string[]
	/** The question the chart answers, leading the caption. */
	question: string
	/** Trailing caption fragment after the date range (e.g. a pinned-lens note). */
	captionSuffix?: string
	/** 'YYYY-MM-DD' range bounds from the API; caption shows Loading… until both exist. */
	startDate?: string
	endDate?: string
	/** Sentry component tag for error capture. */
	sentryComponent: string
	error: unknown
	isLoading: boolean
	/** True when the loaded data has nothing to plot (never during loading). */
	isEmpty: boolean
	/** Rendered in the header's action slot (e.g. the scatter's filters). */
	headerAction?: ReactNode
	/** Rendered between the caption and the chart (e.g. the trend summary line). */
	preChart?: ReactNode
	children: ReactNode
}

/**
 * The shared shell of every Advanced Metrics card: title + ⓘ popover,
 * question + date-range caption, and the error / loading / empty states —
 * mechanics that were previously copy-pasted per card and had already begun
 * to drift. Cards contribute their chart and their judgement calls
 * (popover notes, captions); the shell owns everything that must stay
 * uniform.
 */
export function MetricCardShell({
	className,
	title,
	infoNotes,
	question,
	captionSuffix,
	startDate,
	endDate,
	sentryComponent,
	error,
	isLoading,
	isEmpty,
	headerAction,
	preChart,
	children,
}: MetricCardShellProps) {
	// Memoized: cards re-render frequently (tween frames, highlights) while
	// the range only changes when the data does. parseLocalDay keeps the
	// label on the written calendar day in every timezone (see clientBuckets).
	const range = useMemo(() => {
		const start = startDate ? parseLocalDay(startDate) : null
		const end = endDate ? parseLocalDay(endDate) : null
		return start && end ? `${format(start, 'MMM do')} - ${format(end, 'MMM do')}` : null
	}, [startDate, endDate])

	if (error) {
		const errorCode = parseErrorCode(error)
		return (
			<>
				<MetricCardSentryErrorCapture
					key={`${sentryComponent}:${errorCode}`}
					error={error}
					sentryComponent={sentryComponent}
					errorCode={errorCode}
				/>
				<Card className={cn('p-4', className)}>
					<CardHeader>
						<CardTitle>{title}</CardTitle>
						<CardDescription>Unable to load</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground">
							Something went wrong loading this chart. Please try again later.
						</p>
					</CardContent>
				</Card>
			</>
		)
	}

	return (
		<Card className={cn('p-4', className)}>
			{/* On phones the side-by-side action column crushes the title to a
			    word per line, so below `sm` the header collapses to one column
			    and the action drops onto its own row (auto-rows-min supplies
			    row 3). Viewport, not container, variants: an element cannot
			    answer its own @container query, and CardHeader is the container. */}
			{/* `!`: the base has-data-[slot=card-action]:grid-cols-[1fr_auto]
			    carries :has() specificity that a plain media-query class loses to. */}
			<CardHeader className="max-sm:grid-cols-1!">
				<div className="flex items-center gap-2">
					<CardTitle>{title}</CardTitle>
					<ChartInfoPopover notes={infoNotes} />
				</div>
				{headerAction ? (
					<CardAction className="max-sm:col-start-1 max-sm:row-start-3 max-sm:row-span-1 max-sm:justify-self-start max-sm:pt-2">
						{headerAction}
					</CardAction>
				) : null}
				<CardDescription>
					{question} {range ?? 'Loading...'}
					{captionSuffix}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{preChart}
				{isEmpty ? <ChartEmptyState /> : isLoading ? <ChartLoadingState /> : children}
			</CardContent>
		</Card>
	)
}
