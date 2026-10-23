import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const SessionsPerDayInputSchema = z.object({
	range: z.enum(['7d', '30d', '90d']).default('7d'),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

export const SessionsPerDayOutputSchema = z.object({
	data: z.array(
		z.object({
			date: z.string(),
			sessions: z.number(),
			isWeekend: z.boolean(),
		}),
	),
	total: z.number(),
	startDate: z.string(),
	endDate: z.string(),
})

export const sessionsPerDayContract = contractBuilder
	.input(SessionsPerDayInputSchema)
	.output(SessionsPerDayOutputSchema)
