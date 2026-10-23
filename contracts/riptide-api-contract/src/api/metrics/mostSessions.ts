import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const MostSessionsInputSchema = z.object({
	range: z.enum(['7d', '30d', '90d']).default('30d'),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
})

export const MostSessionsOutputSchema = z.object({
	data: z.array(
		z.object({
			userId: z.string(),
			displayName: z.string(),
			profilePictureUrl: z.string().optional(),
			sessionsCreated: z.number(),
			sessionsContinued: z.number(),
			totalSessions: z.number(),
		}),
	),
	startDate: z.string(),
	endDate: z.string(),
})

export const mostSessionsContract = contractBuilder.input(MostSessionsInputSchema).output(MostSessionsOutputSchema)
