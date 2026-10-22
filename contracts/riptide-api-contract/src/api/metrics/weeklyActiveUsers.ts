import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const WeeklyActiveUsersInputSchema = z.object({
	weeks: z.number().int().min(4).max(12).default(8),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

export const WeeklyActiveUsersOutputSchema = z.object({
	data: z.array(
		z.object({
			weekStart: z.string(),
			users: z.number(),
		}),
	),
	averageWeekly: z.number(),
	startDate: z.string(),
	endDate: z.string(),
})

export const weeklyActiveUsersContract = contractBuilder
	.input(WeeklyActiveUsersInputSchema)
	.output(WeeklyActiveUsersOutputSchema)
