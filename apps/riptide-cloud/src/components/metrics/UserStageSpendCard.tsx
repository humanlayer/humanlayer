import { useCallback, useMemo } from 'react'

import { useOrgMembers } from '@/hooks/useOrgMembers'

import { formatUsdCompact } from './kpis'
import { MetricCardShell } from './MetricCardShell'
import type { MetricsRange } from './range'
import { StackedShareBars } from './StackedShareBars'
import {
	NO_STAGE_LABEL,
	stageColorVar,
	stageDisplayName,
	STAGE_ORDER,
	stageSeriesKey,
	NO_STAGE_KEY,
} from './stageAttribution'
import { buildCrossTab, type CrossTabSeries, seriesCovering } from './userCrossTab'
import { useUserStageSpend } from './useUserCrossTab'

export interface UserStageSpendCardProps {
	className?: string
	range: MetricsRange
}

/**
 * Series in WORKFLOW PROGRESSION order, no-stage last, with the same fixed
 * colours the ranked stage card uses. Built from the canonical vocabulary
 * rather than from the data, so a segment keeps its position and its colour
 * whichever stages happen to have spend in the current range — the whole point
 * of a stacked bar is that the bands line up between one person and the next.
 */
const CANONICAL_STAGE_SERIES: CrossTabSeries[] = STAGE_ORDER.map((stage) => ({
	key: stageSeriesKey(stage),
	label: stageDisplayName(stage),
	color: stageColorVar(stage),
}))

/** Always last, after any legacy label — same rank the ranked card gives it. */
const NO_STAGE_SERIES: CrossTabSeries[] = [
	{ key: stageSeriesKey(NO_STAGE_KEY), label: NO_STAGE_LABEL, color: stageColorVar(NO_STAGE_KEY) },
]

/**
 * Which part of the workflow each person spends on — the cross-tab beneath the
 * stage ranking, and the reason that ranking is worth reading twice.
 *
 * The card above says ad-hoc is 47% of the org. This one says whether that is
 * everybody working the same way or one person at 97% dragging the average.
 * They are the same dollars: summing this card by stage reproduces the card
 * above exactly, which is asserted in the API tests.
 *
 * Bars are shares of the PERSON. See StackedShareBars for why.
 */
export function UserStageSpendCard({ className, range }: UserStageSpendCardProps) {
	const { data, isLoading, error } = useUserStageSpend(range)
	// Names come from a separate query, so its loading state folds into this
	// card's — otherwise rows paint raw `user_01H…` ids and then flip to names.
	const { memberFor, isLoading: membersLoading } = useOrgMembers()

	const nameFor = useCallback((userId: string) => memberFor(userId)?.displayName, [memberFor])

	const crossTab = useMemo(() => {
		const cells = data?.data ?? []
		// A stage outside the vocabulary (a legacy rpi:* label the SQL reports
		// rather than reporting nothing) gets its own muted segment instead of
		// having its dollars re-based across the stages that are named.
		const series = seriesCovering(
			CANONICAL_STAGE_SERIES,
			cells.map((cell) => ({
				key: stageSeriesKey(cell.stage),
				label: stageDisplayName(cell.stage),
				color: stageColorVar(cell.stage),
			})),
			NO_STAGE_SERIES,
		)
		return buildCrossTab(
			cells.map((cell) => ({
				userId: cell.userId,
				bucket: stageSeriesKey(cell.stage),
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
			title="Spend by person · stage"
			question="Which part of the workflow does each person spend on?"
			captionSuffix={crossTab.grandTotal > 0 ? ` · ${formatUsdCompact(crossTab.grandTotal)} total` : undefined}
			startDate={data?.startDate}
			endDate={data?.endDate}
			sentryComponent="UserStageSpendCard"
			error={error}
			isLoading={loading}
			isEmpty={!loading && crossTab.rows.length === 0}
			infoNotes={[
				'One bar per person, ordered by their total spend. Each bar is that person’s own mix, so it always fills the width — a light user and a heavy user can be compared directly.',
				'Because bars are shares of the person, they do NOT say who spends most. The ranking above answers that; this answers what each person spends it on.',
				'Segments follow workflow progression and keep the colours of the card above, so a stage is the same colour in both and stays that colour when the range changes.',
				`"${NO_STAGE_LABEL}" is spend on sessions that never invoked an RPI skill.`,
				'A segment under 0.5% of a bar is too small to see or hover, so it is left out of the drawing. Its dollars still count in the row total.',
				'Someone who has left the organization shows as their raw user id rather than dropping out of the total.',
			]}
		>
			<StackedShareBars crossTab={crossTab} bucketNoun="Stage" />
		</MetricCardShell>
	)
}
