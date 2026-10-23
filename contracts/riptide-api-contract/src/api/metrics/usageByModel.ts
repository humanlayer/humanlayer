import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UsageByModelInputSchema = z.object({
	range: z.enum(['7d', '30d', '90d']).default('30d'),
	bucket: z.enum(['day', 'hour']).default('day'),
	/** Filter by session creator (WorkOS id): whose daemon spent the tokens. */
	userId: z.string().optional(),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

/**
 * Sparse rows — no zero-fill of the (bucket x model) cross product; clients pivot.
 * Mirrors the Anthropic Claude Code Analytics API shape.
 */
export const UsageByModelOutputSchema = z.object({
	data: z.array(
		z.object({
			/** 'YYYY-MM-DD' (day) or 'YYYY-MM-DDTHH:00' (hour). */
			bucket: z.string(),
			model: z.string(),
			inputTokens: z.number(),
			outputTokens: z.number(),
			cacheReadTokens: z.number(),
			cacheCreationTokens: z.number(),
			costUsd: z.number().nullable(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const usageByModelContract = contractBuilder.input(UsageByModelInputSchema).output(UsageByModelOutputSchema)
