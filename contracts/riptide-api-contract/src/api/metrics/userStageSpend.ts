import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// No filters: like its siblings, this chart IS the breakdown, and the page
// scopes its model/agent/repo filters to the scatter.
export const UserStageSpendInputSchema = metricsRangeInput()

/**
 * Token spend cross-tabbed by person and RPI workflow stage — the companion to
 * stageSpendTrend, which gives the same total split one way instead of two.
 *
 * NO BUCKET DIMENSION. It aggregates over the range as a whole, because the
 * card it backs is a 100% stacked bar per person: there is no time axis for a
 * bucket to land on. It still takes `bucket` so its cache key matches its
 * siblings' and the page never shows one card from a range and another from a
 * different one — the same reason usersScatter takes it.
 *
 * Stage resolution is shared with stageSpendTrend — including its `no_stage`
 * sentinel for sessions that never invoked an RPI skill — so summing this by
 * stage reproduces that procedure's totals exactly.
 *
 * Only the user id travels. Names live in the org member list the client
 * already holds; someone who has left the org is not in it, and the client
 * falls back to the raw id rather than dropping their spend.
 */
export const UserStageSpendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** WorkOS user id ('user_…') whose daemon ran the session and spent the tokens. */
			userId: z.string(),
			/** RPI label name ('rpi:implementation', …) or the `no_stage` sentinel. */
			stage: z.string(),
			costUsd: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const userStageSpendContract = contractBuilder
	.input(UserStageSpendInputSchema)
	.output(UserStageSpendOutputSchema)
