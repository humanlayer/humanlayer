import { useCallback, useMemo } from 'react'

import { useOrgMembers } from '@/hooks/useOrgMembers'

import { formatUsdCompact } from './kpis'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { StackedShareBars } from './StackedShareBars'
import { MODE_ORDER, modeColorVar, modeDisplayName, modeSeriesKey } from './stageAttribution'
import { buildCrossTab, type CrossTabSeries, seriesCovering } from './userCrossTab'
import { useUserModeSpend } from './useUserCrossTab'

export interface UserModeSpendCardProps {
	className?: string
	range: MetricsRange
}

/**
 * Modes in canonical ceremony order (most structured first), with the ranked
 * mode card's fixed colours. Built from the vocabulary, not the data, for the
 * same reason as the stage card: the bands have to line up across people. A
 * mode outside it is appended at draw time — see the card body.
 */
const CANONICAL_MODE_SERIES: CrossTabSeries[] = MODE_ORDER.map((mode) => ({
	key: modeSeriesKey(mode),
	label: modeDisplayName(mode),
	color: modeColorVar(mode),
}))

/**
 * Which kind of workflow each person runs — the cross-tab beneath the mode
 * ranking, and the twin of UserStageSpendCard over the same people.
 *
 * Five modes against eleven stages, so this is the card where the stacked bar
 * is at its best: the segments are large enough to read without a tooltip, and
 * the legend is short enough to scan.
 */
export function UserModeSpendCard({ className, range }: UserModeSpendCardProps) {
	const { data, isLoading, error } = useUserModeSpend(range)
	const { memberFor, isLoading: membersLoading } = useOrgMembers()

	const nameFor = useCallback((userId: string) => memberFor(userId)?.displayName, [memberFor])

	const crossTab = useMemo(() => {
		const cells = data?.data ?? []
		// Modes are an OPEN vocabulary on purpose — the API passes an unknown
		// tasks.workflow_type straight through so a new mode shows up rather
		// than vanishing. Cover it here too, or its dollars would be re-based
		// across the known modes while the ranked card above still drew it.
		const series = seriesCovering(
			CANONICAL_MODE_SERIES,
			cells.map((cell) => ({
				key: modeSeriesKey(cell.mode),
				label: modeDisplayName(cell.mode),
				color: modeColorVar(cell.mode),
			})),
			[],
		)
		return buildCrossTab(
			cells.map((cell) => ({
				userId: cell.userId,
				bucket: modeSeriesKey(cell.mode),
				costUsd: cell.costUsd,
			})),
			series,
			nameFor,
		)
	}, [data, nameFor])

	const loading = isLoading || membersLoading

	return (
		<MetricCardShell
			className={className}
			title="Spend by person · mode"
			question="Which kind of workflow does each person run?"
			captionSuffix={crossTab.grandTotal > 0 ? ` · ${formatUsdCompact(crossTab.grandTotal)} total` : undefined}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="UserModeSpendCard"
			error={error}
			isLoading={loading}
			isEmpty={!loading && crossTab.rows.length === 0}
			infoNotes={[
				'One bar per person, ordered by their total spend. Each bar is that person’s own mix, so it always fills the width — a light user and a heavy user can be compared directly.',
				'Because bars are shares of the person, they do NOT say who spends most. The ranking above answers that; this answers what each person spends it on.',
				'Rows are in the same order as the stage card beside this one, so the two can be read across without re-finding anyone.',
				'Mode is the stored workflow type on the task, so this is measured, not inferred. Spend on sessions without a task counts as freeform.',
				'A segment under 0.5% of a bar is too small to see or hover, so it is left out of the drawing. Its dollars still count in the row total.',
				'Someone who has left the organization shows as their raw user id rather than dropping out of the total.',
			]}
		>
			<StackedShareBars crossTab={crossTab} bucketNoun="Mode" />
		</MetricCardShell>
	)
}
