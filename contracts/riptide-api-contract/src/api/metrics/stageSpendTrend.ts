import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

/**
 * Sentinel `stage` value for spend on sessions that never invoked an RPI
 * skill — ad-hoc / freeform work. A real bucket, not an error state: the
 * charts render it (muted) so untracked spend stays visible instead of
 * silently vanishing from the stack.
 */
export const NO_STAGE_KEY = 'no_stage'

// No filters: like modelSpendTrend, this chart IS the breakdown, and the
// page scopes its model/agent/repo filters to the scatter.
export const StageSpendTrendInputSchema = metricsRangeInput()

/**
 * Weekly token spend split by RPI workflow stage — the second mix chart next
 * to modelSpendTrend: models say WHAT billed the money, stages say WHICH PART
 * OF THE WORKFLOW it was buying.
 *
 * A session's stage is its most-progressed RPI label (`sessions.labels`,
 * appended server-side from the literal Skill tool call), so this is measured
 * attribution, not a modelled split. Sessions with no RPI label report the
 * {@link NO_STAGE_KEY} sentinel.
 *
 * Rows are sparse — one per (bucket, stage) with spend; clients pivot and
 * densify. Bucket keys follow the request's `bucket` and match modelSpendTrend's,
 * so every card on the page shares one x-axis.
 */
export const StageSpendTrendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** First day of the bucket, 'YYYY-MM-DD' (a Monday when bucket is 'week'). */
			bucketStart: z.string(),
			/** RPI label name ('rpi:implementation', …) or {@link NO_STAGE_KEY}. */
			stage: z.string(),
			costUsd: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const stageSpendTrendContract = contractBuilder
	.input(StageSpendTrendInputSchema)
	.output(StageSpendTrendOutputSchema)
