import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { StageSpendTrendInputSchema } from './stageSpendTrend'

export const ModeSpendTrendInputSchema = StageSpendTrendInputSchema

/**
 * Weekly token spend split by workflow mode — the companion decomposition to
 * stageSpendTrend over the same total: stages say WHICH PART of a workflow
 * the money bought, modes say WHICH KIND of workflow it ran in.
 *
 * Mode is the session's task's stored `workflow_type`, so this is measured,
 * not inferred. Spend on sessions with no task reports 'freeform' (it is by
 * definition outside any structured workflow). Modes come back as stored —
 * clients render whatever exists, including legacy 'rpi'.
 *
 * Rows are sparse — one per (bucket, mode) with spend; clients pivot and
 * densify. Bucket keys match stageSpendTrend's, so both cards' stacks top out at
 * the same per-bucket total.
 */
export const ModeSpendTrendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** First day of the bucket, 'YYYY-MM-DD' (a Monday when bucket is 'week'). */
			bucketStart: z.string(),
			/** `tasks.workflow_type` ('oneshot', 'outline_only', …) or 'freeform' for task-less spend. */
			mode: z.string(),
			costUsd: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const modeSpendTrendContract = contractBuilder
	.input(ModeSpendTrendInputSchema)
	.output(ModeSpendTrendOutputSchema)
