import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// No filters, for the same reason as its siblings.
export const UserModeSpendInputSchema = metricsRangeInput()

/**
 * Token spend cross-tabbed by person and workflow mode — the companion to
 * modeSpendTrend, and the mode-shaped twin of userStageSpend.
 *
 * NO BUCKET DIMENSION, for the same reason as userStageSpend: the card is a
 * 100% stacked bar per person, which has no time axis. `bucket` is still
 * accepted so the cache key lines up with the rest of the page.
 *
 * Mode comes from the session's task (`tasks.workflow_type`); usage on
 * task-less sessions counts as 'freeform'. The join goes through `sessions`
 * rather than the denormalized `session_usage_events.task_id`, so a session
 * reassigned to another task reports its CURRENT task's mode — matching
 * modeSpendTrend and the task page.
 */
export const UserModeSpendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** WorkOS user id ('user_…') whose daemon ran the session and spent the tokens. */
			userId: z.string(),
			/** `tasks.workflow_type`, or 'freeform' for task-less sessions. */
			mode: z.string(),
			costUsd: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const userModeSpendContract = contractBuilder.input(UserModeSpendInputSchema).output(UserModeSpendOutputSchema)
