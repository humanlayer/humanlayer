import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const SessionsPerWeekInputSchema = z.object({
	weeks: z.number().int().min(4).max(12).default(8),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

export const SessionsPerWeekOutputSchema = z.object({
	data: z.array(
		z.object({
			weekStart: z.string(),
			sessions: z.number(),
		}),
	),
	total: z.number(),
	startDate: z.string(),
	endDate: z.string(),
})

export const sessionsPerWeekContract = contractBuilder
	.input(SessionsPerWeekInputSchema)
	.output(SessionsPerWeekOutputSchema)
