import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { metricsRangeInput } from './range'

// No filters: this chart IS the model breakdown, and the page scopes its
// model/agent/repo filters to the scatter (see unitCostTrend).
export const ModelSpendTrendInputSchema = metricsRangeInput()

/**
 * Weekly token spend split by model — the mix chart that explains the
 * unit-cost trend. When cost per kLOC climbs, this is where "because spend
 * shifted to a pricier model" becomes visible as a widening band.
 *
 * Pure spend, no denominators: each usage row carries its own `model`, so
 * unlike costPerKlocByModel's ratios there is NO session-dominance
 * approximation and NO coverage caveat here — every dollar lands under the
 * model that actually billed it.
 *
 * Rows are sparse — one per (bucket, model) with spend; clients pivot and
 * densify. Bucket keys follow the request's `bucket` and match unitCostTrend's,
 * so every card on the page shares one x-axis.
 */
export const ModelSpendTrendOutputSchema = z.object({
	data: z.array(
		z.object({
			/** First day of the bucket, 'YYYY-MM-DD' (a Monday when bucket is 'week'). */
			bucketStart: z.string(),
			model: z.string(),
			costUsd: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const modelSpendTrendContract = contractBuilder
	.input(ModelSpendTrendInputSchema)
	.output(ModelSpendTrendOutputSchema)
