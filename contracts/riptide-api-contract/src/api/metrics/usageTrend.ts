import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UsageTrendInputSchema = z.object({
	range: z.enum(['7d', '30d', '90d']).default('30d'),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

export const UsageTrendOutputSchema = z.object({
	data: z.array(
		z.object({
			date: z.string(),
			sessions: z.number(),
			messages: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const usageTrendContract = contractBuilder.input(UsageTrendInputSchema).output(UsageTrendOutputSchema)
